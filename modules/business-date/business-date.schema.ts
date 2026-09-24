import type { z } from "zod";
import { highRiskReasonSchema, isoDateSchema } from "@/lib/validation/common";

export const initializeBusinessDateSchema = highRiskReasonSchema
  .extend({ date: isoDateSchema })
  .strict();

export type InitializeBusinessDateInput = z.infer<typeof initializeBusinessDateSchema>;
