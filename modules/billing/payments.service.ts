import "server-only";
import { runInTransaction } from "@/lib/db/transaction";
import { type IdempotencyRequest, type PropertyContext, auditActor } from "@/lib/http/context";
import { AppError, notFound } from "@/lib/http/errors";
import { type MoneyUnits, formatMoney, isMinorUnitAligned, parseMoney } from "@/lib/utils/money";
import type { Tx } from "@/lib/db/prisma";
import { recordAudit } from "@/modules/audit/audit.service";
import { recordEvent } from "@/modules/integrations/outbox.service";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { runIdempotent } from "@/modules/idempotency/idempotency.service";
import { allocateNumber } from "@/modules/properties/properties.service";
import { currencyMinorUnits } from "@/modules/rates/rates.service";
import { paymentProblem, refundProblem } from "./billing.policy";
import {
  type LockedFolio,
  findFolioRef,
  findPaymentLine,
  findPaymentMethod,
  findPaymentRef,
  findReasonCode,
  insertItem,
  insertPayment,
  insertRefund,
  ledgerBalance,
  lockFolios,
  lockPayment,
  updatePaymentVersioned,
} from "./billing.repository";
import type { PaymentInput, RefundInput, VoidPaymentInput } from "./billing.schema";
import type { PaymentResult } from "./billing.types";

/**
 * Payments, voids and refunds (docs/PMS_WORKFLOWS.md §11, §23).
 *
 * Phase 5 records payments taken at the desk — cash, card on the hotel's own
 * terminal, bank transfer — as CAPTURED immediately. No payment gateway is
 * called and nothing claims one was: card payments carry the terminal's
 * approval reference. Payments are in the folio currency only; any other
 * currency is refused (no FX conversion is invented).
 *
 * Lock order: business date → idempotency key → property sequence
 * (receipt) → folio → payment. The balance is recomputed from the ledger
 * under the folio lock before every decision.
 */

const money = (value: MoneyUnits) => formatMoney(value);

function rule(message: string, reason: string, details: Record<string, unknown> = {}) {
  return new AppError("BUSINESS_RULE_VIOLATION", message, { reason, ...details });
}

async function lockedFolio(tx: Tx, propertyId: string, folioId: string): Promise<LockedFolio> {
  const [folio] = await lockFolios(tx, propertyId, [folioId]);
  if (!folio) throw notFound("Folio");
  if (folio.status === "CLOSED") {
    throw rule("This window is closed", "FOLIO_CLOSED", { window: folio.window });
  }
  return folio;
}

async function verifiedBalance(tx: Tx, folio: LockedFolio): Promise<MoneyUnits> {
  const ledger = parseMoney(await ledgerBalance(tx, folio.id));
  if (ledger !== parseMoney(folio.balance)) {
    throw new Error(`Folio ${folio.id} balance does not match its ledger`);
  }
  return ledger;
}

async function stateAfter(tx: Tx, propertyId: string, folioId: string) {
  const [folio] = await lockFolios(tx, propertyId, [folioId]);
  return { balance: await verifiedBalance(tx, folio!), version: folio!.version };
}

function amountIn(value: string, minorUnits: number, field: string): MoneyUnits {
  const amount = parseMoney(value);
  if (!isMinorUnitAligned(amount, minorUnits)) {
    throw new AppError(
      "VALIDATION_FAILED",
      `Amounts in this currency have at most ${minorUnits} decimals`,
      { fields: { [field]: [`At most ${minorUnits} decimals`] } },
    );
  }
  return amount;
}

async function reasonOf(
  tx: Tx,
  propertyId: string,
  id: string | undefined,
  category: "VOID" | "REFUND",
) {
  if (!id) return null;
  const reason = await findReasonCode(tx, propertyId, id, category);
  if (!reason) {
    throw new AppError("VALIDATION_FAILED", "Choose a valid reason code", {
      fields: { reasonCodeId: ["Invalid reason"] },
    });
  }
  return reason;
}

/**
 * Takes a payment against one window (payments:create). The client sends
 * the window version it saw: if anything was posted since, the command is
 * refused with 409 so the cashier sees the new balance first. The amount may
 * not exceed the balance (over-payment is not supported).
 */
export async function postPayment(
  ctx: PropertyContext,
  folioId: string,
  input: PaymentInput,
  idempotency: IdempotencyRequest | null,
): Promise<PaymentResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const ref = await findFolioRef(tx, ctx.propertyId, folioId);
      if (!ref) throw notFound("Folio");
      const method = await findPaymentMethod(tx, ctx.propertyId, input.methodId);
      if (!method || method.status !== "ACTIVE") throw notFound("Payment method");
      if (
        method.transactionCode.group.type !== "PAYMENT" ||
        method.transactionCode.status !== "ACTIVE"
      ) {
        throw rule(`${method.name} is not configured with a payment code`, "METHOD_MISCONFIGURED");
      }
      if (method.requiresReference && !input.reference) {
        throw new AppError("VALIDATION_FAILED", `${method.name} needs a reference`, {
          fields: { reference: ["Required for this payment method"] },
        });
      }
      if (input.currencyCode && input.currencyCode !== ctx.currencyCode) {
        throw rule(
          `Payments are taken in ${ctx.currencyCode}. Foreign-currency payments are not supported yet.`,
          "CURRENCY_NOT_SUPPORTED",
          { currencyCode: ctx.currencyCode },
        );
      }
      const minorUnits = await currencyMinorUnits(tx, ctx.currencyCode);
      const amount = amountIn(input.amount, minorUnits, "amount");

      // Receipt number first (sequence lock precedes folio locks), then the folio.
      const receiptNumber = await allocateNumber(tx, ctx.propertyId, "receipt");
      const folio = await lockedFolio(tx, ctx.propertyId, folioId);
      if (folio.currency_code !== ctx.currencyCode) {
        throw rule("The folio currency differs from the property currency", "CURRENCY_MISMATCH");
      }
      const balance = await verifiedBalance(tx, folio);
      if (folio.version !== input.version) {
        throw new AppError(
          "CONFLICT",
          "The balance changed while you were entering the payment. Review the new balance and try again.",
          { reason: "BALANCE_CHANGED", balance: money(balance), version: folio.version },
        );
      }
      const problem = paymentProblem(amount, balance);
      if (problem) {
        throw rule(problem, "PAYMENT_EXCEEDS_BALANCE", { balance: money(balance) });
      }

      const payment = await insertPayment(tx, {
        propertyId: ctx.propertyId,
        kind: "PAYMENT",
        status: "CAPTURED",
        folioId: folio.id,
        methodId: method.id,
        amount: money(amount),
        currencyCode: folio.currency_code,
        businessDate: fromDateOnly(businessDate),
        reference: input.reference ?? null,
        receiptNumber,
        createdById: ctx.userId,
        capturedAt: new Date(),
      });
      const item = await insertItem(tx, {
        propertyId: ctx.propertyId,
        folioId: folio.id,
        kind: "PAYMENT",
        source: "MANUAL",
        transactionCodeId: method.transactionCodeId,
        businessDate: fromDateOnly(businessDate),
        quantity: 1,
        unitAmount: money(-amount),
        amount: money(-amount),
        currencyCode: folio.currency_code,
        description: `${method.name} · ${receiptNumber}`,
        reference: input.reference ?? null,
        comment: input.comment ?? null,
        paymentId: payment.id,
        originReservationRoomId: ref.reservationRoomId,
        postedById: ctx.userId,
      });
      const after = await stateAfter(tx, ctx.propertyId, folio.id);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "folio.payment",
          resourceType: "Folio",
          resourceId: folio.id,
          risk: "HIGH",
          before: { balance: money(balance) },
          after: {
            folioId: folio.id,
            window: folio.window,
            paymentId: payment.id,
            itemId: item.id,
            receiptNumber,
            method: method.code,
            amount: money(amount),
            currencyCode: folio.currency_code,
            reference: input.reference ?? null,
            balance: money(after.balance),
          },
          permission: "payments:create",
        },
      );
      await recordEvent(
        tx,
        { organizationId: ctx.organizationId, propertyId: ctx.propertyId },
        "payment.posted",
        {
          paymentId: payment.id,
          folioId: folio.id,
        },
      );
      return {
        folioId: folio.id,
        paymentId: payment.id,
        receiptNumber,
        itemId: item.id,
        amount: money(amount),
        balance: money(after.balance),
        version: after.version,
      } satisfies PaymentResult;
    });
    return result;
  });
}

async function lockPaymentWithFolio(tx: Tx, ctx: PropertyContext, paymentId: string) {
  const ref = await findPaymentRef(tx, ctx.propertyId, paymentId);
  if (!ref || !ref.folioId) throw notFound("Payment");
  const folio = await lockedFolio(tx, ctx.propertyId, ref.folioId);
  const payment = await lockPayment(tx, ctx.propertyId, paymentId);
  if (!payment) throw notFound("Payment");
  const line = await findPaymentLine(tx, paymentId);
  if (!line) throw notFound("Payment");
  const method = await findPaymentMethod(tx, ctx.propertyId, payment.method_id);
  return { folio, payment, line, method: method! };
}

/**
 * Voids a payment taken today by mistake (payments:void, HIGH): the payment
 * becomes VOIDED and an exact REVERSAL of its ledger line restores the
 * balance. Earlier payments, and payments already partly refunded, are
 * corrected by a refund instead.
 */
export async function voidPayment(
  ctx: PropertyContext,
  paymentId: string,
  input: VoidPaymentInput,
  idempotency: IdempotencyRequest | null,
): Promise<PaymentResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const { folio, payment, line, method } = await lockPaymentWithFolio(tx, ctx, paymentId);
      if (payment.status !== "CAPTURED") {
        throw rule("Only a captured payment can be voided", "NOT_VOIDABLE", {
          status: payment.status,
        });
      }
      if (toDateOnly(payment.business_date) !== businessDate) {
        throw rule(
          "Payments from earlier business dates are corrected with a refund",
          "NOT_VOIDABLE",
        );
      }
      if (parseMoney(payment.refunded_amount) !== 0n) {
        throw rule("A partly refunded payment cannot be voided", "NOT_VOIDABLE");
      }
      const reason = await reasonOf(tx, ctx.propertyId, input.reasonCodeId, "VOID");
      const before = await verifiedBalance(tx, folio);
      const amount = parseMoney(payment.amount);

      const reversal = await insertItem(tx, {
        propertyId: ctx.propertyId,
        folioId: folio.id,
        kind: "REVERSAL",
        source: "MANUAL",
        transactionCodeId: line.transactionCodeId,
        businessDate: fromDateOnly(businessDate),
        quantity: -1,
        unitAmount: line.amount,
        amount: line.amount.negated(),
        currencyCode: folio.currency_code,
        description: `Void · ${line.description}`,
        correctsItemId: line.id,
        paymentId: payment.id,
        reasonCodeId: reason?.id ?? null,
        comment: input.reason,
        postedById: ctx.userId,
      });
      const { count } = await updatePaymentVersioned(tx, payment.id, payment.version, {
        status: "VOIDED",
        voidedAt: new Date(),
        voidReasonId: reason?.id ?? null,
      });
      if (count !== 1) throw new AppError("CONFLICT", "The payment was changed by someone else");
      const after = await stateAfter(tx, ctx.propertyId, folio.id);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "folio.void_payment",
          resourceType: "Folio",
          resourceId: folio.id,
          risk: "HIGH",
          before: { paymentStatus: "CAPTURED", balance: money(before) },
          after: {
            folioId: folio.id,
            window: folio.window,
            paymentId: payment.id,
            receiptNumber: payment.receipt_number,
            method: method.code,
            amount: money(amount),
            currencyCode: folio.currency_code,
            itemId: reversal.id,
            paymentStatus: "VOIDED",
            balance: money(after.balance),
          },
          reason: input.reason,
          reasonCodeId: reason?.id ?? null,
          permission: "payments:void",
        },
      );
      await recordEvent(
        tx,
        { organizationId: ctx.organizationId, propertyId: ctx.propertyId },
        "payment.voided",
        {
          paymentId: payment.id,
          folioId: folio.id,
        },
      );
      return {
        folioId: folio.id,
        paymentId: payment.id,
        receiptNumber: payment.receipt_number,
        itemId: reversal.id,
        amount: money(amount),
        balance: money(after.balance),
        version: after.version,
      } satisfies PaymentResult;
    });
    return result;
  });
}

/**
 * Refunds part or all of a captured payment (payments:refund, HIGH): a
 * Refund row referencing the payment, the payment's refunded amount raised
 * (never above the payment, database check), and a ledger debit on the same
 * window. The original payment line is never changed.
 */
export async function refundPayment(
  ctx: PropertyContext,
  paymentId: string,
  input: RefundInput,
  idempotency: IdempotencyRequest | null,
): Promise<PaymentResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const { folio, payment, method } = await lockPaymentWithFolio(tx, ctx, paymentId);
      const reason = await reasonOf(tx, ctx.propertyId, input.reasonCodeId, "REFUND");
      if (!reason) {
        throw new AppError("VALIDATION_FAILED", "Choose a refund reason", {
          fields: { reasonCodeId: ["Required"] },
        });
      }
      const minorUnits = await currencyMinorUnits(tx, folio.currency_code);
      const amount = amountIn(input.amount, minorUnits, "amount");
      const paid = parseMoney(payment.amount);
      const refunded = parseMoney(payment.refunded_amount);
      const problem = refundProblem(amount, { status: payment.status, amount: paid, refunded });
      if (problem) {
        throw rule(problem, "REFUND_NOT_ALLOWED", { refundable: money(paid - refunded) });
      }
      const before = await verifiedBalance(tx, folio);

      const refund = await insertRefund(tx, {
        propertyId: ctx.propertyId,
        paymentId: payment.id,
        amount: money(amount),
        currencyCode: payment.currency_code,
        status: "SUCCEEDED",
        reasonCodeId: reason.id,
        comment: input.reason,
        businessDate: fromDateOnly(businessDate),
        gatewayReference: null,
        createdById: ctx.userId,
        completedAt: new Date(),
      });
      const { count } = await updatePaymentVersioned(tx, payment.id, payment.version, {
        refundedAmount: money(refunded + amount),
      });
      if (count !== 1) throw new AppError("CONFLICT", "The payment was changed by someone else");
      const item = await insertItem(tx, {
        propertyId: ctx.propertyId,
        folioId: folio.id,
        kind: "PAYMENT",
        source: "MANUAL",
        transactionCodeId: method.transactionCodeId,
        businessDate: fromDateOnly(businessDate),
        quantity: 1,
        unitAmount: money(amount),
        amount: money(amount),
        currencyCode: folio.currency_code,
        description: `Refund · ${method.name}${payment.receipt_number ? ` · ${payment.receipt_number}` : ""}`,
        reference: input.reference ?? null,
        comment: input.reason,
        paymentId: payment.id,
        refundId: refund.id,
        reasonCodeId: reason.id,
        postedById: ctx.userId,
      });
      const after = await stateAfter(tx, ctx.propertyId, folio.id);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "folio.refund",
          resourceType: "Folio",
          resourceId: folio.id,
          risk: "HIGH",
          before: { refunded: money(refunded), balance: money(before) },
          after: {
            folioId: folio.id,
            window: folio.window,
            paymentId: payment.id,
            refundId: refund.id,
            itemId: item.id,
            receiptNumber: payment.receipt_number,
            method: method.code,
            amount: money(amount),
            currencyCode: folio.currency_code,
            refunded: money(refunded + amount),
            reference: input.reference ?? null,
            balance: money(after.balance),
          },
          reason: input.reason,
          reasonCodeId: reason.id,
          permission: "payments:refund",
        },
      );
      await recordEvent(
        tx,
        { organizationId: ctx.organizationId, propertyId: ctx.propertyId },
        "payment.refunded",
        {
          paymentId: payment.id,
          refundId: refund.id,
          folioId: folio.id,
        },
      );
      return {
        folioId: folio.id,
        paymentId: payment.id,
        receiptNumber: payment.receipt_number,
        itemId: item.id,
        amount: money(amount),
        balance: money(after.balance),
        version: after.version,
      } satisfies PaymentResult;
    });
    return result;
  });
}
