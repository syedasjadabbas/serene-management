import type { Server } from "node:http";
import { serverEnv } from "@/config/env";
import { onShutdown, shutdown } from "./shutdown";

/**
 * Installs the graceful shutdown of an application process
 * (index.ts; lib/lifecycle/shutdown.ts describes the sequence).
 * Idempotent. The cleanup only touches what this process actually created.
 */
export function registerShutdown(server?: Server): void {
  const holder = globalThis as unknown as { __sereneShutdownRegistered?: boolean };
  if (holder.__sereneShutdownRegistered) return;
  holder.__sereneShutdownRegistered = true;
  const env = serverEnv();

  let workerStopped: Promise<void> | undefined;
  onShutdown("job worker", "drain", async () => {
    const { inlineWorker } = await import("@/lib/jobs/inline");
    // Stops claiming at once; running jobs get the rest of the shutdown time.
    workerStopped = inlineWorker()?.stop(Math.max(1_000, env.SHUTDOWN_TIMEOUT_MS - 2_000));
  });
  onShutdown("event streams", "drain", async () => {
    const { existingRealtimeHub } = await import("@/lib/realtime/hub");
    existingRealtimeHub()?.endStreams();
  });
  onShutdown("job worker", "close", async () => {
    await workerStopped;
  });
  onShutdown("realtime listener", "close", async () => {
    const { existingRealtimeHub } = await import("@/lib/realtime/hub");
    await existingRealtimeHub()?.stop();
  });
  // Each PrismaClient closes its own pool (lib/db/prisma.ts); the replica pool is per process.
  onShutdown("read replica pool", "close", async () => {
    const { configureReadReplica } = await import("@/lib/db/read-replica");
    await configureReadReplica(null);
  });

  // The HTTP server stops accepting once in-flight requests are done.
  if (server) {
    onShutdown("http server", "close", () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    });
  }

  const handle = (signal: NodeJS.Signals) => {
    // This process owns the exit. Bounded: whatever happens, it is gone shortly after the timeout.
    setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS + 5_000).unref();
    void shutdown(signal, {
      drainMs: env.SHUTDOWN_DRAIN_MS,
      timeoutMs: env.SHUTDOWN_TIMEOUT_MS,
      owner: true,
    });
  };
  // SIGTERM: Linux service managers and orchestrators. SIGINT: Ctrl+C.
  // SIGBREAK: Ctrl+Break, deliverable to a Windows console process.
  const signals: NodeJS.Signals[] =
    process.platform === "win32" ? ["SIGTERM", "SIGINT", "SIGBREAK"] : ["SIGTERM", "SIGINT"];
  for (const signal of signals) process.on(signal, () => handle(signal));
}
