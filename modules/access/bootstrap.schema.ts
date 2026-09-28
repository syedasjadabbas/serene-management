import { z } from "zod";
import { newPasswordSchema } from "@/modules/identity/identity.schema";

/** Input of the first-organization bootstrap (H1, docs/DEPLOYMENT.md). */
export const bootstrapSchema = z
  .object({
    organizationCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{1,19}$/, "2–20 letters or digits, starting with a letter"),
    organizationName: z.string().trim().min(2).max(200),
    organizationLegalName: z.string().trim().min(2).max(200).optional(),
    baseCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. PKR"),
    adminEmail: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    adminDisplayName: z.string().trim().min(2).max(120),
    adminPassword: newPasswordSchema,
  })
  .strict();

export type BootstrapInput = z.infer<typeof bootstrapSchema>;
