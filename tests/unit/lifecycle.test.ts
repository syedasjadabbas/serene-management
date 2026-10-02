import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inFlightRequests,
  instanceId,
  isDraining,
  onShutdown,
  resetLifecycleForTests,
  shutdown,
  trackRequest,
} from "@/lib/lifecycle/shutdown";
import type { HubEvent, RealtimeHub } from "@/lib/realtime/hub";
import { openEventStream } from "@/lib/realtime/stream";

afterEach(() => {
  resetLifecycleForTests();
  vi.unstubAllEnvs();
});

const quiet = () => {};

describe("graceful shutdown sequence (scalability phase 9)", () => {
  it("drains, waits for in-flight requests, then closes, then exits 0", async () => {
    const order: string[] = [];
    onShutdown("worker", "drain", () => void order.push("drain:worker"));
    onShutdown("streams", "drain", () => void order.push("drain:streams"));
    onShutdown("pools", "close", () => void order.push("close:pools"));
    let finishRequest!: () => void;
    const request = trackRequest(
      () =>
        new Promise<void>((resolve) => {
          finishRequest = () => {
            order.push("request done");
            resolve();
          };
        }),
    );
    expect(inFlightRequests()).toBe(1);

    const exit = vi.fn();
    const done = shutdown("SIGTERM", {
      drainMs: 5,
      timeoutMs: 2_000,
      owner: true,
      log: quiet,
      exit,
    });
    expect(isDraining()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Draining has run, but nothing is closed while the request is in flight.
    expect(order).toEqual(["drain:worker", "drain:streams"]);
    expect(exit).not.toHaveBeenCalled();

    finishRequest();
    await Promise.all([request, done]);
    expect(order).toEqual(["drain:worker", "drain:streams", "request done", "close:pools"]);
    expect(inFlightRequests()).toBe(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("is bounded: a request that never finishes does not hold the process", async () => {
    void trackRequest(() => new Promise<void>(() => {}));
    const closed = vi.fn();
    onShutdown("pools", "close", closed);
    const exit = vi.fn();
    const log = vi.fn();
    const started = Date.now();
    await shutdown("SIGTERM", { drainMs: 0, timeoutMs: 100, owner: true, log, exit });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(closed).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(log.mock.calls.flat().join("\n")).toContain("timed out with 1 requests in flight");
  });

  it("runs once; later signals join the first, and a failing hook does not stop the rest", async () => {
    const closed = vi.fn();
    onShutdown("broken", "drain", () => {
      throw new Error("boom");
    });
    onShutdown("pools", "close", closed);
    onShutdown("pools", "close", closed); // same name: registered once
    const options = { drainMs: 0, timeoutMs: 1_000, owner: false, log: quiet };
    const first = shutdown("SIGTERM", options);
    expect(shutdown("SIGINT", options)).toBe(first);
    await first;
    expect(closed).toHaveBeenCalledOnce();
  });

  it("without ownership (plain next start) it cleans up but never exits", async () => {
    const exit = vi.fn();
    await shutdown("SIGTERM", { drainMs: 1_000, timeoutMs: 1_000, owner: false, log: quiet, exit });
    expect(exit).not.toHaveBeenCalled();
  });

  it("names the instance from INSTANCE_ID, else host-pid-random", () => {
    vi.stubEnv("INSTANCE_ID", "web-2");
    expect(instanceId()).toBe("web-2");
    resetLifecycleForTests();
    vi.stubEnv("INSTANCE_ID", "");
    expect(instanceId()).toMatch(new RegExp(`-${process.pid}-[0-9a-f]{4}$`));
  });
});

describe("event streams on shutdown", () => {
  it("tell the client to reconnect (reauth, reason shutdown) and end", async () => {
    const listeners: ((event: HubEvent) => void)[] = [];
    const hub = {
      live: true,
      subscribe(listener: (event: HubEvent) => void) {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    } as unknown as RealtimeHub;
    const response = openEventStream(
      hub,
      { propertyId: "p", organizationId: "o", userId: "u", sessionId: "s", topics: ["rooms"] },
      { signal: new AbortController().signal, endsAt: Date.now() + 60_000 },
    );
    for (const listener of [...listeners]) listener({ kind: "shutdown" });
    const text = await response.text();
    expect(text).toContain('event: ready\ndata: {"topics":["rooms"],"live":true}');
    expect(text.trimEnd().endsWith('event: reauth\ndata: {"reason":"shutdown"}')).toBe(true);
    expect(listeners).toHaveLength(0);
  });
});
