import { describe, expect, it } from "vitest";
import { Semaphore } from "@/lib/utils/concurrency";

/** The heavy-report gate (docs/SCALABILITY.md §33). */
describe("Semaphore", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it("runs at most `limit` at once and hands slots over in arrival order", async () => {
    const gate = new Semaphore(2);
    const order: string[] = [];
    const a = deferred();
    const b = deferred();
    const first = gate.run(1_000, async () => {
      order.push("a");
      await a.promise;
    });
    const second = gate.run(1_000, async () => {
      order.push("b");
      await b.promise;
    });
    const third = gate.run(1_000, async () => {
      order.push("c");
    });
    const fourth = gate.run(1_000, async () => {
      order.push("d");
    });
    await Promise.resolve();
    expect(order).toEqual(["a", "b"]);
    expect(gate.inUse).toBe(2);
    expect(gate.queued).toBe(2);
    b.resolve();
    await second;
    await third;
    expect(order).toEqual(["a", "b", "c", "d"]);
    a.resolve();
    await Promise.all([first, fourth]);
    expect(gate.inUse).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it("gives up after the wait without losing a slot, and releases on errors", async () => {
    const gate = new Semaphore(1);
    const hold = deferred();
    const holder = gate.run(1_000, () => hold.promise);
    expect(await gate.run(20, async () => "late")).toEqual({ ran: false });
    expect(gate.queued).toBe(0);
    hold.resolve();
    await holder;
    await expect(
      gate.run(10, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(gate.inUse).toBe(0);
    expect(await gate.run(10, async () => 7)).toEqual({ ran: true, value: 7 });
  });
});
