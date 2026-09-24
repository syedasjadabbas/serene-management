import { z } from "zod";
import {
  PAGE_SIZE_MAX,
  currencyCodeSchema,
  cursorPageQuerySchema,
  idSchema,
  isoDateSchema,
} from "@/lib/validation/common";

/**
 * Billing API contracts (docs/API_CONVENTIONS.md). Clients send what the
 * cashier chose — code, quantity, unit price, method, amount — never totals,
 * taxes, balances, currency conversions or business dates: the server
 * derives all of them. Every schema is strict, so a smuggled "total" or
 * "tax" field is rejected rather than ignored.
 */

export const reservationRoomParamsSchema = z
  .object({ propertyId: idSchema, reservationRoomId: idSchema })
  .strict();
export const folioParamsSchema = z.object({ propertyId: idSchema, folioId: idSchema }).strict();
export const itemParamsSchema = z.object({ propertyId: idSchema, itemId: idSchema }).strict();
export const paymentParamsSchema = z.object({ propertyId: idSchema, paymentId: idSchema }).strict();

/** A positive decimal amount ("1250.00"); precision is checked against the folio currency. */
export const positiveAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,4})?$/, "Enter an amount like 1250.00")
  .refine((value) => /[1-9]/.test(value), "The amount must be greater than zero");

const version = z.number().int().positive();
const reference = z.string().trim().min(1).max(100).optional();
const comment = z.string().trim().max(500).optional();
const reasonText = z.string().trim().min(3, "A reason is required").max(1000);

export const FOLIO_VIEWS = ["in_house", "open_balance", "all"] as const;
export type FolioListView = (typeof FOLIO_VIEWS)[number];

export const folioListQuerySchema = cursorPageQuerySchema
  .extend({
    view: z.enum(FOLIO_VIEWS).default("in_house"),
    q: z.string().trim().max(100).optional(),
  })
  .strict();
export type FolioListQuery = z.infer<typeof folioListQuerySchema>;

export const ledgerQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(100),
  })
  .strict();
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

/** Opens the next billing window (window 1 first). The server numbers it. */
export const openWindowSchema = z.object({}).strict();

export const chargeSchema = z
  .object({
    transactionCodeId: idSchema,
    quantity: z.number().int().min(1).max(999).default(1),
    unitAmount: positiveAmountSchema,
    reference,
    comment,
  })
  .strict();
export type ChargeInput = z.infer<typeof chargeSchema>;

/** Posts the room (and package) charges of unposted nights up to `through` (default: business date). */
export const roomChargesSchema = z.object({ through: isoDateSchema.optional() }).strict();
export type RoomChargesInput = z.infer<typeof roomChargesSchema>;

export const paymentSchema = z
  .object({
    methodId: idSchema,
    amount: positiveAmountSchema,
    /** Window version the cashier saw; a changed balance returns 409 instead of paying blind. */
    version,
    /** Optional echo of the currency shown; anything but the folio currency is rejected. */
    currencyCode: currencyCodeSchema.optional(),
    reference,
    comment,
  })
  .strict();
export type PaymentInput = z.infer<typeof paymentSchema>;

export const reverseSchema = z
  .object({ reasonCodeId: idSchema.optional(), reason: reasonText })
  .strict();
export type ReverseInput = z.infer<typeof reverseSchema>;

/** Credits part or all of a charge; `amount` includes its taxes. */
export const adjustSchema = z
  .object({ amount: positiveAmountSchema, reasonCodeId: idSchema, reason: reasonText })
  .strict();
export type AdjustInput = z.infer<typeof adjustSchema>;

export const voidPaymentSchema = z
  .object({ reasonCodeId: idSchema.optional(), reason: reasonText })
  .strict();
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

export const refundSchema = z
  .object({ amount: positiveAmountSchema, reasonCodeId: idSchema, reason: reasonText, reference })
  .strict();
export type RefundInput = z.infer<typeof refundSchema>;

export const settleSchema = z.object({ version }).strict();
export type SettleInput = z.infer<typeof settleSchema>;
