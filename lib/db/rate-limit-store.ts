import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/prisma";
import type { RateLimitStore } from "@/lib/http/rate-limit";

/** Longest stored key (rule name + ":" + key); longer keys are stored as a hash. */
const MAX_KEY_LENGTH = 400;

/**
 * Rate-limit windows shared by every application instance (scalability phase 2,
 * docs/SCALABILITY.md §26), in the `rate_limit_windows` table.
 *
 * One statement per hit: INSERT ... ON CONFLICT DO UPDATE takes the row lock, so
 * concurrent hits on the same key (from any instance) are serialised and each one
 * sees a distinct count; a window that has ended restarts at 1. Windows are
 * computed from the caller's clock (`now`), as before: instances run NTP, and a
 * skew of milliseconds does not matter to minute-long windows.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly db: Pick<Db, "$queryRaw" | "$executeRaw">) {}

  async hit(id: string, windowMs: number, now: number) {
    const key =
      id.length <= MAX_KEY_LENGTH ? id : `sha256:${createHash("sha256").update(id).digest("hex")}`;
    const at = new Date(now);
    const resetAt = new Date(now + windowMs);
    const rows = await this.db.$queryRaw<{ count: number; reset_at: Date }[]>`
      INSERT INTO "rate_limit_windows" AS w ("key", "count", "reset_at")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN w."reset_at" <= ${at} THEN 1 ELSE w."count" + 1 END,
        "reset_at" = CASE WHEN w."reset_at" <= ${at} THEN EXCLUDED."reset_at" ELSE w."reset_at" END
      RETURNING "count", "reset_at"`;
    const row = rows[0]!;
    return { count: row.count, resetAt: row.reset_at.getTime() };
  }

  async clear() {
    await this.db.$executeRaw`DELETE FROM "rate_limit_windows"`;
  }
}
