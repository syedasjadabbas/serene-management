import "server-only";
import type { JobHandler } from "@/modules/jobs/jobs.types";
import { nightAuditJob } from "@/modules/night-audit/night-audit.service";

/** Every job kind a worker can run (one handler per kind of modules/jobs/jobs.policy JOB_KINDS). */
export function jobHandlers(): JobHandler[] {
  return [nightAuditJob()];
}
