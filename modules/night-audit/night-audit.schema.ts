import { z } from "zod";
import { cursorPageQuerySchema, highRiskReasonSchema, idSchema } from "@/lib/validation/common";

export const nightAuditParamsSchema = z.object({ propertyId: idSchema }).strict();

export const nightAuditRunParamsSchema = z
  .object({ propertyId: idSchema, runId: idSchema })
  .strict();

/** Start: high-risk (nightaudit:run), reason required; Idempotency-Key header required. */
export const startNightAuditSchema = highRiskReasonSchema.strict();
export type StartNightAuditInput = z.infer<typeof startNightAuditSchema>;

/** Recover a stale RUNNING run: high-risk, reason required. */
export const recoverNightAuditSchema = highRiskReasonSchema.strict();
export type RecoverNightAuditInput = z.infer<typeof recoverNightAuditSchema>;

export const nightAuditRunsQuerySchema = cursorPageQuerySchema.strict();
export type NightAuditRunsQuery = z.infer<typeof nightAuditRunsQuerySchema>;
