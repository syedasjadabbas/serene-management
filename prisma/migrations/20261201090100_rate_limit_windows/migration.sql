-- Scalability phase 2 (docs/SCALABILITY.md §26): shared rate-limit windows.
--
-- Rate limits were counted in each application process's memory, so N instances
-- behind a load balancer allowed N times every limit (login attempts per account,
-- password changes, the write flood guard). One row per (rule, key) fixed window,
-- shared by every instance; lib/db/rate-limit-store.ts increments it atomically with
-- INSERT ... ON CONFLICT DO UPDATE (the row lock serialises concurrent hits).
--
-- UNLOGGED (not expressible in the Prisma schema, see docs/DATABASE_DESIGN.md §5):
-- counters are short-lived (at most one window) and written on every rate-limited
-- request, so they skip the write-ahead log. Consequences, accepted: the table is
-- emptied after a database crash and is not copied to physical replicas, so a
-- crash or failover starts every window afresh. Expired rows are removed by
-- `npm run ops:maintenance` (retention target rateLimitWindows).

CREATE UNLOGGED TABLE "rate_limit_windows" (
    "key" VARCHAR(400) NOT NULL,
    "count" INTEGER NOT NULL,
    "reset_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_windows_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_windows_reset_at_idx" ON "rate_limit_windows"("reset_at");
