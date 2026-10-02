import "server-only";
import pg from "pg";
import { serverEnv } from "@/lib/env";
import { pgPoolConfig } from "@/lib/db/pool-config";
import { logServerError } from "@/lib/http/log";
import { counter } from "@/lib/observability/metrics";
import { type RealtimeTopic, isRealtimeTopic } from "./topics";

/**
 * Change notifications for this process (docs/SCALABILITY.md §31). One
 * dedicated connection LISTENs to the channels the database triggers notify
 * (migration 20261215090000_realtime_notifications); every instance holds its
 * own, so a change committed through any instance, job or script reaches the
 * streams of all of them. Nothing is kept in memory but the open streams of
 * this process.
 *
 * NOTIFY is not stored: while this connection is down, changes are missed.
 * Streams are told ("degraded"), their clients fall back to polling, and when
 * the connection is back ("live") clients refetch what may have changed.
 */

export type HubEvent =
  | { kind: "change"; propertyId: string; topics: RealtimeTopic[]; tx: string }
  | {
      kind: "access";
      sessionId?: string;
      userId?: string;
      organizationId?: string;
      propertyId?: string;
      all?: boolean;
    }
  | { kind: "degraded" }
  | { kind: "live" }
  /** This instance is shutting down: streams end so clients reconnect elsewhere. */
  | { kind: "shutdown" };

type Listener = (event: HubEvent) => void;

const CHANGES = "serene_changes";
const ACCESS = "serene_access";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/**
 * The LISTEN connection is checked with a query this often. A connection the
 * network silently drops (no reset: a partition, a stalled proxy) would
 * otherwise look healthy while no notification arrives; an unanswered check
 * counts as lost: streams get `degraded` and the hub reconnects. Measured
 * with a black-holing proxy (docs/SCALABILITY.md §38).
 */
const PING_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;

const uuidOrUndefined = (value: unknown) =>
  typeof value === "string" && UUID.test(value) ? value : undefined;

/** A notification payload as a hub event; null for anything malformed. */
export function parseNotification(channel: string, payload: string | undefined): HubEvent | null {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload ?? "") as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  if (channel === CHANGES) {
    const propertyId = uuidOrUndefined(data.p);
    const topics = typeof data.t === "string" ? data.t.split(",").filter(isRealtimeTopic) : [];
    const tx = typeof data.x === "string" && /^\d{1,20}$/.test(data.x) ? data.x : null;
    if (!propertyId || topics.length === 0 || !tx) return null;
    return { kind: "change", propertyId, topics, tx };
  }
  if (channel === ACCESS) {
    const event: HubEvent = {
      kind: "access",
      sessionId: uuidOrUndefined(data.s),
      userId: uuidOrUndefined(data.u),
      organizationId: uuidOrUndefined(data.o),
      propertyId: uuidOrUndefined(data.p),
      all: data.all === true,
    };
    return event.sessionId || event.userId || event.organizationId || event.propertyId || event.all
      ? event
      : null;
  }
  return null;
}

export class RealtimeHub {
  private readonly listeners = new Set<Listener>();
  private client: pg.Client | null = null;
  private connecting = false;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly connectionString: () => string) {}

  /** Whether change notifications are being received right now. */
  get live(): boolean {
    return this.client !== null;
  }

  get subscribers(): number {
    return this.listeners.size;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.ensureConnected();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Ends every open stream with `reauth` (graceful shutdown, before stop()). */
  endStreams(): void {
    this.emit({ kind: "shutdown" });
  }

  /** Closes the connection for good (tests, shutdown). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  private emit(event: HubEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logServerError("realtime listener", error);
      }
    }
  }

  private ensureConnected() {
    if (this.stopped || this.client || this.connecting || this.retryTimer) return;
    this.connecting = true;
    void this.connect();
  }

  private async connect() {
    // Always a direct session connection (REALTIME_DATABASE_URL behind a
    // transaction pooler), so the session settings are sent as usual.
    const settings = pgPoolConfig({
      ...serverEnv(),
      DATABASE_URL: this.connectionString(),
      DATABASE_POOLER: "none",
    });
    const client = new pg.Client({
      connectionString: settings.connectionString,
      connectionTimeoutMillis: settings.connectionTimeoutMillis,
      application_name: "serene-management-realtime",
      options: settings.options,
      keepAlive: true,
    });
    const lost = () => {
      if (this.client !== client) return;
      this.client = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      counter(
        "realtime_listener_lost_total",
        "LISTEN connection losses; streams are degraded (clients poll) until it is back",
      ).inc();
      this.emit({ kind: "degraded" });
      this.scheduleRetry();
    };
    client.on("error", (error) => {
      logServerError("realtime connection", error);
      lost();
      void client.end().catch(() => undefined);
    });
    client.on("end", lost);
    client.on("notification", (message) => {
      const event = parseNotification(message.channel, message.payload);
      if (event) {
        counter("realtime_notifications_total", "Notifications received, by kind").inc({
          kind: event.kind,
        });
        this.emit(event);
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANGES}`);
      await client.query(`LISTEN ${ACCESS}`);
      if (this.stopped) {
        await client.end();
        return;
      }
      this.client = client;
      this.retryMs = RETRY_MIN_MS;
      this.pingTimer = setInterval(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const unanswered = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("LISTEN connection check timed out")),
            PING_TIMEOUT_MS,
          );
        });
        Promise.race([client.query("SELECT 1"), unanswered])
          .catch(() => {
            lost();
            // A silent connection may never close by itself.
            (
              client as unknown as { connection?: { stream?: { destroy(): void } } }
            ).connection?.stream?.destroy();
            void client.end().catch(() => undefined);
          })
          .finally(() => clearTimeout(timer));
      }, PING_INTERVAL_MS);
      this.pingTimer.unref?.();
      this.emit({ kind: "live" });
    } catch (error) {
      logServerError("realtime connect", error);
      await client.end().catch(() => undefined);
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleRetry() {
    if (this.stopped || this.retryTimer) return;
    // Exponential backoff with jitter, so instances do not reconnect in step.
    const delay = Math.round(this.retryMs * (0.75 + Math.random() * 0.5));
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size > 0) this.ensureConnected();
    }, delay);
  }
}

const holder = globalThis as unknown as { __sereneRealtimeHub?: RealtimeHub };

/** The hub if this process created one (shutdown must not open a connection). */
export function existingRealtimeHub(): RealtimeHub | undefined {
  return holder.__sereneRealtimeHub;
}

/** The process-wide hub (one LISTEN connection per application instance). */
export function realtimeHub(): RealtimeHub {
  holder.__sereneRealtimeHub ??= new RealtimeHub(() => {
    const env = serverEnv();
    return env.REALTIME_DATABASE_URL ?? env.DATABASE_URL;
  });
  return holder.__sereneRealtimeHub;
}
