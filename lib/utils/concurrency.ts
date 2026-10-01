/**
 * Maps items with at most `limit` calls in flight, keeping input order.
 * Organization-wide reads fan out per property through the existing
 * per-property services; the cap keeps one request from monopolizing the
 * database pool (D38).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}

/**
 * Counting semaphore with a bounded wait (first come, first served). `run`
 * resolves to `{ ran: false }` when no slot freed up within `maxWaitMs`, so
 * the caller can answer "busy" instead of queueing without end.
 */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  get inUse(): number {
    return this.active;
  }

  get queued(): number {
    return this.waiting.length;
  }

  async run<T>(
    maxWaitMs: number,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }> {
    if (this.active >= this.limit) {
      const granted = await new Promise<boolean>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          resolve(true);
        };
        const timer = setTimeout(() => {
          const index = this.waiting.indexOf(wake);
          if (index !== -1) this.waiting.splice(index, 1);
          resolve(false);
        }, maxWaitMs);
        this.waiting.push(wake);
      });
      if (!granted) return { ran: false };
    } else {
      this.active += 1;
    }
    try {
      return { ran: true, value: await fn() };
    } finally {
      // Hand the slot straight to the next waiter (active stays the same).
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}
