import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

/**
 * Process lifecycle for horizontal deployment (scalability phase 9,
 * docs/SCALABILITY.md §37, ARCHITECTURE D69): the instance identifier,
 * in-flight API requests, and the graceful shutdown sequence.
 *
 * On SIGTERM / SIGINT (systemd, Kubernetes, NSSM's Ctrl+C on Windows):
 *
 * 1. Draining: readiness answers 503 and new event streams are refused, so a
 *    health-aware load balancer stops sending traffic here.
 * 2. The job worker stops claiming; running jobs finish or keep their lease
 *    and are re-claimed elsewhere after it expires.
 * 3. Open event streams receive `reauth` (reason "shutdown") and end; their
 *    clients reconnect through the load balancer to another instance.
 * 4. After SHUTDOWN_DRAIN_MS (time for the load balancer to see the failed
 *    readiness), in-flight API requests are awaited, up to SHUTDOWN_TIMEOUT_MS.
 * 5. The LISTEN connection and the database pools are closed; the process
 *    exits.
 *
 * With NEXT_MANUAL_SIG_HANDLE=true (`npm start` sets it) this sequence owns
 * the exit. Without it (plain `next start`) Next.js closes the HTTP server at
 * once and this module only ends the streams and the worker, so that close is
 * not held open by 15-minute event streams.
 *
 * Everything here is per process and non-critical: sessions, rate limits,
 * jobs and notifications live in PostgreSQL.
 */

interface LifecycleState {
  instanceId: string;
  startedAt: number;
  draining: boolean;
  inFlight: number;
  idle: (() => void)[];
  shutdown: Promise<void> | null;
  hooks: { name: string; run: () => Promise<void> | void; phase: "drain" | "close" }[];
}

const holder = globalThis as unknown as { __sereneLifecycle?: LifecycleState };

function state(): LifecycleState {
  holder.__sereneLifecycle ??= {
    instanceId:
      process.env.INSTANCE_ID?.trim().slice(0, 64) ||
      `${hostname()}-${process.pid}-${randomUUID().slice(0, 4)}`,
    startedAt: Date.now(),
    draining: false,
    inFlight: 0,
    idle: [],
    shutdown: null,
    hooks: [],
  };
  return holder.__sereneLifecycle;
}

/** Identifies this process in observability output (INSTANCE_ID, or host-pid-random). */
export function instanceId(): string {
  return state().instanceId;
}

export function uptimeSeconds(): number {
  return Math.round((Date.now() - state().startedAt) / 1000);
}

/** True once a shutdown signal arrived: readiness fails, new streams are refused. */
export function isDraining(): boolean {
  return state().draining;
}

export function inFlightRequests(): number {
  return state().inFlight;
}

/** Counts an API request for the shutdown wait (lib/http/route.ts). */
export async function trackRequest<T>(work: () => Promise<T>): Promise<T> {
  const s = state();
  s.inFlight += 1;
  try {
    return await work();
  } finally {
    s.inFlight -= 1;
    if (s.inFlight === 0) for (const resolve of s.idle.splice(0)) resolve();
  }
}

/**
 * Registers cleanup. "drain" hooks run as soon as draining starts (stop
 * claiming jobs, end streams); "close" hooks run last (pools, LISTEN).
 */
export function onShutdown(
  name: string,
  phase: "drain" | "close",
  run: () => Promise<void> | void,
): void {
  const s = state();
  if (!s.hooks.some((hook) => hook.name === name)) s.hooks.push({ name, run, phase });
}

async function runHooks(phase: "drain" | "close", log: (message: string) => void) {
  await Promise.all(
    state()
      .hooks.filter((hook) => hook.phase === phase)
      .map(async (hook) => {
        try {
          await hook.run();
        } catch (error) {
          log(`${hook.name} failed: ${error instanceof Error ? error.name : "error"}`);
        }
      }),
  );
}

function waitForIdle(timeoutMs: number): Promise<boolean> {
  const s = state();
  if (s.inFlight === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    s.idle.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export interface ShutdownOptions {
  drainMs: number;
  timeoutMs: number;
  /** Whether this sequence exits the process (NEXT_MANUAL_SIG_HANDLE). */
  owner: boolean;
  log?: (message: string) => void;
  exit?: (code: number) => void;
}

/**
 * Runs the shutdown sequence once (later signals join the first). Returns
 * when cleanup is done; when `owner`, then exits the process.
 */
export function shutdown(signal: string, options: ShutdownOptions): Promise<void> {
  const s = state();
  if (s.shutdown) return s.shutdown;
  const log =
    options.log ?? ((message: string) => console.warn(`[shutdown ${s.instanceId}] ${message}`));
  s.draining = true;
  s.shutdown = (async () => {
    const started = Date.now();
    log(`${signal}: draining (readiness 503, no new streams or job claims)`);
    await runHooks("drain", log);
    if (options.owner) {
      // Let the load balancer see the failed readiness before going away.
      await new Promise((resolve) => setTimeout(resolve, options.drainMs));
      const remaining = Math.max(0, options.timeoutMs - (Date.now() - started));
      const idle = await waitForIdle(remaining);
      log(idle ? "in-flight requests finished" : `timed out with ${s.inFlight} requests in flight`);
    }
    await runHooks("close", log);
    log(`closed after ${Date.now() - started} ms`);
    if (options.owner) (options.exit ?? process.exit)(0);
  })();
  return s.shutdown;
}

/** Test seam: forget the shutdown state (never used by the application). */
export function resetLifecycleForTests(): void {
  holder.__sereneLifecycle = undefined;
}
