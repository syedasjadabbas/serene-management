import "server-only";
import type { HubEvent, RealtimeHub } from "./hub";
import type { RealtimeTopic } from "./topics";

/**
 * One server-sent event stream for one signed-in user at one property
 * (docs/SCALABILITY.md §31). It forwards only change notifications of that
 * property, only for topics the user may read there, and only topic names:
 * no record, amount or name ever travels on it. The client refetches through
 * the normal API, which authorizes every request again.
 *
 * Events:
 * - `ready`   {topics, live}: subscribed; `live` false while this instance
 *              cannot receive notifications (the client keeps polling).
 * - `change`  {t: topics, x: transaction id}: data of these topics changed.
 * - `degraded` / `live`: notifications stopped / resumed on this instance.
 * - `reauth`: the stream ends (session, user, role or property access
 *              changed, the access token expires, or this instance shuts
 *              down); the client reconnects and is authenticated again.
 */

export interface StreamScope {
  propertyId: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  topics: RealtimeTopic[];
}

const HEARTBEAT_MS = 25_000;
/** Notifications of one burst (a check-in touches several tables) are merged. */
const MERGE_MS = 200;
/** A stream never outlives this, so access is re-checked at least this often. */
export const STREAM_MAX_MS = 15 * 60_000;

function accessAffects(event: Extract<HubEvent, { kind: "access" }>, scope: StreamScope) {
  return (
    event.all === true ||
    event.sessionId === scope.sessionId ||
    event.userId === scope.userId ||
    event.organizationId === scope.organizationId ||
    event.propertyId === scope.propertyId
  );
}

export function openEventStream(
  hub: RealtimeHub,
  scope: StreamScope,
  options: { signal: AbortSignal; endsAt: number },
): Response {
  const encoder = new TextEncoder();
  const allowed = new Set<RealtimeTopic>(scope.topics);
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const pending = new Set<RealtimeTopic>();
      let lastTx = "";
      let mergeTimer: ReturnType<typeof setTimeout> | null = null;

      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const event = (name: string, data: unknown) =>
        send(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
      const flush = () => {
        mergeTimer = null;
        if (pending.size === 0) return;
        event("change", { t: [...pending], x: lastTx });
        pending.clear();
      };

      const unsubscribe = hub.subscribe((hubEvent) => {
        switch (hubEvent.kind) {
          case "change": {
            if (hubEvent.propertyId !== scope.propertyId) return;
            const topics = hubEvent.topics.filter((topic) => allowed.has(topic));
            if (topics.length === 0) return;
            for (const topic of topics) pending.add(topic);
            lastTx = hubEvent.tx;
            mergeTimer ??= setTimeout(flush, MERGE_MS);
            return;
          }
          case "access":
            if (accessAffects(hubEvent, scope)) {
              event("reauth", { reason: "access" });
              close();
            }
            return;
          case "degraded":
            event("degraded", {});
            return;
          case "live":
            event("live", {});
            return;
          case "shutdown":
            // Reconnect now: the load balancer sends the new stream elsewhere.
            event("reauth", { reason: "shutdown" });
            close();
            return;
        }
      });

      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      const lifetime = setTimeout(
        () => {
          event("reauth", { reason: "expired" });
          close();
        },
        Math.max(1_000, Math.min(STREAM_MAX_MS, options.endsAt - Date.now())),
      );

      function close() {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        if (mergeTimer) clearTimeout(mergeTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      }
      cleanup = close;
      options.signal.addEventListener("abort", close, { once: true });

      // The client retries on its own schedule (with backoff); `retry` only
      // guides plain EventSource clients.
      send("retry: 5000\n\n");
      event("ready", { topics: scope.topics, live: hub.live });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform: compression would buffer the stream.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
