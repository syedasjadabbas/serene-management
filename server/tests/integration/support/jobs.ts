import { JobWorker, type WorkerOptions } from "@/lib/jobs/worker";
import type { JobHandler } from "@/modules/jobs/jobs.types";
import { type NightAuditHooks, nightAuditJob } from "@/modules/night-audit/night-audit.service";

/**
 * A worker limited to one property's jobs: test files run in parallel against
 * one database, and each drains only what it queued.
 */
export function testWorker(
  propertyId: string,
  handlers: JobHandler[] = [nightAuditJob()],
  options: Partial<WorkerOptions> = {},
): JobWorker {
  return new JobWorker(handlers, {
    concurrency: 1,
    pollIntervalMs: 60_000,
    leaseMs: 30_000,
    listenUrl: null,
    propertyId,
    ...options,
  });
}

/** Runs every due job of the property (the background part of a request) until none is left. */
export function drainJobs(propertyId: string, hooks?: NightAuditHooks): Promise<number> {
  return testWorker(propertyId, [nightAuditJob({ hooks })]).runDue();
}
