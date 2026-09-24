import { z } from "zod";

/**
 * Shared Zod primitives for API contracts and forms (docs/API_CONVENTIONS.md).
 * Domain contracts live in modules/<domain>/<domain>.schema.ts and compose these.
 */

export const idSchema = z.uuid();

/** Calendar / business date on the wire: "YYYY-MM-DD" (no time zone). */
export const isoDateSchema = z.iso.date();

/** Instant on the wire: ISO-8601 with offset, e.g. "2026-09-24T09:30:00.000Z". */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Local wall-clock time at the property, "HH:MM". */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Expected an ISO-4217 code");

/**
 * Money travels as a decimal string ("1250.00"), never a JS number, so no
 * precision is lost between PostgreSQL NUMERIC and the UI.
 */
export const moneyAmountSchema = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, "Expected a decimal amount with up to 4 fraction digits");

export const moneySchema = z.object({
  amount: moneyAmountSchema,
  currency: currencyCodeSchema,
});

export const PAGE_SIZE_MAX = 200;

/** Cursor pagination for operational lists (stable under inserts). */
export const cursorPageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
});

/** Offset pagination for reports and admin tables that show "page x of y". */
export const offsetPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(50),
});

/** `sort=arrivalDate,-lastName` → [{ field, direction }], restricted to an allow-list. */
export function sortQuerySchema<const F extends readonly [string, ...string[]]>(fields: F) {
  const field = z.enum(fields);
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return [];
      return raw.split(",").map((token) => {
        const direction = token.startsWith("-") ? ("desc" as const) : ("asc" as const);
        const parsed = field.safeParse(token.replace(/^-/, ""));
        if (!parsed.success) {
          ctx.addIssue({ code: "custom", message: `Unsupported sort field "${token}"` });
          return z.NEVER;
        }
        return { field: parsed.data, direction };
      });
    });
}

/** Mandatory on high-risk commands (cancel, refund, adjust ...). */
export const reasonSchema = z.object({
  reasonCodeId: idSchema,
  comment: z.string().trim().max(1000).optional(),
});

/** Optimistic concurrency: clients echo the version they edited. */
export const versionSchema = z.object({ version: z.number().int().positive() });
