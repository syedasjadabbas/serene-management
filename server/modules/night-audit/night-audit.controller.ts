import { handleProperty, withMeta } from "@/lib/controller";
import * as service from "./night-audit.service";

/** Night-audit run history, newest first. */
export const listRuns = handleProperty(async (req, res) => {
  const { items, meta } = await service.listRuns(req.ctx, res.locals.query);
  return withMeta(items, meta);
});

/**
 * Starts night audit for the current business date. 202: the run is RUNNING and a
 * background job executes it; follow it with GET .../:runId.
 */
export const start = handleProperty(
  (req) => service.startNightAudit(req.ctx, req.body, req.idempotency),
  { status: 202 },
);

/** The pre-audit checklist for the current business date (read-only). */
export const readiness = handleProperty((req) => service.getReadiness(req.ctx));

/** One run with its steps and summary. */
export const getRun = handleProperty((req) => service.getRun(req.ctx, req.params.runId));

/** Recovers a run left RUNNING by an interruption. */
export const recover = handleProperty((req) =>
  service.recoverRun(req.ctx, req.params.runId, req.body),
);
