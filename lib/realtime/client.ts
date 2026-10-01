import { type RealtimeTopic, isRealtimeTopic } from "./topics";

/**
 * Browser side of a live-update stream (docs/SCALABILITY.md §31), read with
 * fetch instead of EventSource so the status of a refused connection is
 * known: 401 (refresh the session, then reconnect), 403 (no access: stop)
 * and 204 (live updates switched off: stop) must not be retried blindly.
 */

export type StreamEnd =
  | "reauth" // the server ended the stream (token expiry, access change): reconnect now
  | "unauthenticated" // 401: refresh the session, then reconnect
  | "forbidden" // 403: no access to the property: do not reconnect
  | "disabled" // 204: live updates are switched off: do not reconnect
  | "error"; // network or server failure: reconnect with backoff

export interface StreamHandlers {
  ready(data: { topics: RealtimeTopic[]; live: boolean }): void;
  change(data: { topics: RealtimeTopic[]; tx: string }): void;
  /** Notifications on the server stopped (degraded) or resumed (live). */
  serverState(live: boolean): void;
  end(reason: StreamEnd): void;
}

interface RawEvent {
  event: string;
  data: string;
}

/** Splits a server-sent event block into its event name and data. */
export function parseEventBlock(block: string): RawEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

function topicsOf(value: unknown): RealtimeTopic[] {
  return Array.isArray(value)
    ? value.filter((t): t is RealtimeTopic => typeof t === "string" && isRealtimeTopic(t))
    : [];
}

/** Opens the stream; returns a function that closes it (no `end` is reported then). */
export function openEventStream(url: string, handlers: StreamHandlers): () => void {
  const controller = new AbortController();
  let finished = false;
  const finish = (reason: StreamEnd) => {
    if (finished || controller.signal.aborted) return;
    finished = true;
    handlers.end(reason);
  };

  void (async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch {
      finish("error");
      return;
    }
    if (response.status === 204) return finish("disabled");
    if (response.status === 401) return finish("unauthenticated");
    if (response.status === 403) return finish("forbidden");
    if (!response.ok || !response.body) return finish("error");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reauth = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const parsed = parseEventBlock(block);
          if (!parsed) continue;
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(parsed.data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (parsed.event === "ready") {
            handlers.ready({ topics: topicsOf(data.topics), live: data.live === true });
          } else if (parsed.event === "change") {
            const topics = topicsOf(data.t);
            if (topics.length) handlers.change({ topics, tx: String(data.x ?? "") });
          } else if (parsed.event === "live") {
            handlers.serverState(true);
          } else if (parsed.event === "degraded") {
            handlers.serverState(false);
          } else if (parsed.event === "reauth") {
            reauth = true;
          }
        }
      }
    } catch {
      // Network failure or abort: reported below (abort reports nothing).
    }
    finish(reauth ? "reauth" : "error");
  })();

  return () => controller.abort();
}
