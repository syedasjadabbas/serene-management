-- Background jobs (scalability phase 6, docs/SCALABILITY.md §33, ARCHITECTURE D65).
--
-- Work too long for an HTTP request (the night audit: 11-33 s measured, up to the
-- 300 s commit limit) is written here, in the requesting transaction, and executed
-- by workers in any application instance or in the separate worker process
-- (`npm run worker`). PostgreSQL is the queue: no broker. Workers claim with
-- FOR UPDATE SKIP LOCKED under a lease and fence every later write on
-- (locked_by, attempts); see modules/jobs/jobs.repository.ts.

-- CreateEnum
CREATE TYPE "background_job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "property_id" UUID,
    "kind" VARCHAR(60) NOT NULL,
    "dedupe_key" VARCHAR(200),
    "status" "background_job_status" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "progress" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "run_after" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by" VARCHAR(120),
    "locked_until" TIMESTAMPTZ(3),
    "heartbeat_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "error_code" VARCHAR(60),
    "error_message" VARCHAR(500),
    "last_error" VARCHAR(2000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "background_jobs_queued_idx" ON "background_jobs"("run_after", "id") WHERE (status = 'QUEUED');

-- CreateIndex
CREATE INDEX "background_jobs_running_idx" ON "background_jobs"("locked_until") WHERE (status = 'RUNNING');

-- CreateIndex
CREATE INDEX "background_jobs_property_id_created_at_idx" ON "background_jobs"("property_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "background_jobs_finished_idx" ON "background_jobs"("finished_at") WHERE (finished_at IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_active_dedupe_key" ON "background_jobs"("dedupe_key") WHERE (status IN ('QUEUED', 'RUNNING') AND dedupe_key IS NOT NULL);

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (docs/DATABASE_DESIGN.md §5): rules Prisma cannot express.

-- A RUNNING job always has a lease; other states never keep one.
ALTER TABLE "background_jobs"
  ADD CONSTRAINT "background_jobs_attempts_check"
    CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempts" <= "max_attempts"),
  ADD CONSTRAINT "background_jobs_lease_check"
    CHECK (("status" = 'RUNNING') = ("locked_by" IS NOT NULL AND "locked_until" IS NOT NULL)),
  ADD CONSTRAINT "background_jobs_finished_check"
    CHECK (("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = ("finished_at" IS NOT NULL));

-- Wake idle workers at once (they also poll, so a missed notification only
-- delays a job by the poll interval). NOTIFY is transactional: a job whose
-- request rolled back never announces itself. The payload is the kind only.
CREATE OR REPLACE FUNCTION serene_notify_job() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('serene_jobs', NEW.kind);
  RETURN NULL;
END;
$$;

CREATE TRIGGER "background_jobs_notify"
  AFTER INSERT ON "background_jobs"
  FOR EACH ROW EXECUTE FUNCTION serene_notify_job();
