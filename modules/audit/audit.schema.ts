import { z } from "zod";
import { cursorPageQuerySchema } from "@/lib/validation/common";

export const auditLogQuerySchema = cursorPageQuerySchema
  .extend({
    risk: z.enum(["LOW", "STANDARD", "HIGH"]).optional(),
    resourceType: z.string().trim().min(1).max(60).optional(),
    resourceId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
