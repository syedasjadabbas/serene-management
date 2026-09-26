import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { type IdempotencyRequest, type PropertyContext, auditActor } from "@/lib/http/context";
import { AppError, forbidden, notFound, staleVersion } from "@/lib/http/errors";
import type { Permission } from "@/lib/permissions/catalog";
import { hasPermission } from "@/lib/permissions/evaluate";
import { decodeCursor, encodeCursor } from "@/lib/utils/cursor";
import {
  type MoneyUnits,
  formatMoney,
  isMinorUnitAligned,
  parseMoney,
  roundToMinorUnits,
} from "@/lib/utils/money";
import {
  type ResourceHistoryEntry,
  recordAudit,
  resourceHistory,
} from "@/modules/audit/audit.service";
import type { AuditActor } from "@/modules/audit/audit.types";
import { addDays, fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { requireOpenBusinessDate } from "@/modules/business-date/business-date.service";
import { normalizeName } from "@/modules/guests/guests.policy";
import { runIdempotent } from "@/modules/idempotency/idempotency.service";
import { billingRules } from "@/modules/properties/properties.service";
import { currencyMinorUnits } from "@/modules/rates/rates.service";
import {
  type LockedReservationRoom,
  lockReservationRoomById,
  markNightPosting,
  nightsForRoomCharges,
} from "@/modules/reservations/reservations.service";
import {
  type ChargeBreakdown,
  type FolioStatus,
  type PackageComponentInput,
  type TaxRuleInput,
  calculateCharge,
  packageLinesForNight,
  packagePostingKey,
  proportionalCredit,
  reversalProblem,
  roomLineAmount,
  roomPostingKey,
  settleProblem,
} from "./billing.policy";
import {
  type FinancialReasonCategory,
  type LockedFolio,
  countWindows,
  findAccountHeader,
  findFinancialReasonCodes,
  findFolioListPage,
  findFolioRef,
  findItemForCorrection,
  findLedgerPage,
  findManualChargeCodes,
  findPaymentMethods,
  findPostingKeys,
  findReasonCode,
  findTaxRules,
  findTransactionCode,
  findTransactionCodes,
  findWindowRef,
  findWindows,
  insertFolio,
  insertItem,
  ledgerBalance,
  lockFolios,
  lockReservationRoomFolios,
  updateFolioVersioned,
} from "./billing.repository";
import type {
  AdjustInput,
  ChargeInput,
  FolioListQuery,
  LedgerQuery,
  ReverseInput,
  RoomChargesInput,
  SettleInput,
} from "./billing.schema";
import type {
  BillingOptions,
  ChargePreview,
  FolioAccountView,
  FolioListRow,
  FolioSummary,
  LedgerItemView,
  LedgerPage,
  PostingResult,
  RoomChargesResult,
  StayChargeEstimate,
} from "./billing.types";

/**
 * Folios and postings (docs/PMS_WORKFLOWS.md §7, §22; docs/DOMAIN_MODEL.md §5.4).
 *
 * Every financial command runs in one transaction:
 *   business date (FOR SHARE, 423 while night audit runs) → idempotency key →
 *   reservation room (FOR UPDATE, room-charge posting only) → property
 *   sequence (receipts) → folios (FOR UPDATE, id order) → payment (FOR UPDATE)
 * then recomputes the balance from the ledger, validates, appends ledger
 * rows (the database trigger maintains folio totals) and audits.
 * Amounts, taxes, currency and business date are always derived here.
 */

// --- Helpers ------------------------------------------------------------------------

function can(ctx: PropertyContext, permission: Permission): boolean {
  return hasPermission(ctx.access, ctx.propertyId, permission);
}

function requirePermission(ctx: PropertyContext, permission: Permission) {
  if (!can(ctx, permission)) throw forbidden(permission);
}

function units(value: Prisma.Decimal | string): MoneyUnits {
  return parseMoney(typeof value === "string" ? value : value.toFixed(4));
}

const money = (value: MoneyUnits) => formatMoney(value);

function rule(message: string, reason: string, details: Record<string, unknown> = {}) {
  return new AppError("BUSINESS_RULE_VIOLATION", message, { reason, ...details });
}

function requireLiveBusinessDate(ctx: PropertyContext): string {
  if (!ctx.businessDate) {
    throw rule("The property business date has not been initialized", "NO_BUSINESS_DATE");
  }
  return ctx.businessDate;
}

/** A client amount in the folio currency: no precision beyond the minor unit. */
function amountInCurrency(value: string, minorUnits: number, field: string): MoneyUnits {
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

function assertOpenForPosting(folio: LockedFolio) {
  if (folio.status === "CLOSED") {
    throw rule("This window is closed; no further postings are allowed", "FOLIO_CLOSED", {
      window: folio.window,
    });
  }
}

/**
 * Recomputes a window's balance from its ledger and checks the stored total
 * (maintained by the trigger) against it. A mismatch means the ledger was
 * tampered with outside the application: refuse to continue.
 */
async function verifiedBalance(
  tx: Tx,
  folio: { id: string; balance: string },
): Promise<MoneyUnits> {
  const ledger = parseMoney(await ledgerBalance(tx, folio.id));
  if (ledger !== parseMoney(folio.balance)) {
    throw new Error(`Folio ${folio.id} balance does not match its ledger`);
  }
  return ledger;
}

async function folioState(tx: Tx, propertyId: string, folioId: string) {
  const [folio] = await lockFolios(tx, propertyId, [folioId]);
  return folio!;
}

async function requireReason(
  tx: Tx,
  propertyId: string,
  id: string | undefined,
  category: FinancialReasonCategory,
  required: boolean,
) {
  if (!id) {
    if (required) {
      throw new AppError("VALIDATION_FAILED", "Choose a reason code", {
        fields: { reasonCodeId: ["Required"] },
      });
    }
    return null;
  }
  const reason = await findReasonCode(tx, propertyId, id, category);
  if (!reason) {
    throw new AppError("VALIDATION_FAILED", "Choose a valid reason code", {
      fields: { reasonCodeId: ["Invalid reason"] },
    });
  }
  return reason;
}

type CodeRow = NonNullable<Awaited<ReturnType<typeof findTransactionCode>>>;

async function taxRulesByCode(
  tx: Tx,
  propertyId: string,
  codeIds: string[],
  businessDate: string,
): Promise<Map<string, TaxRuleInput[]>> {
  const rows = await findTaxRules(
    tx,
    propertyId,
    [...new Set(codeIds)],
    fromDateOnly(businessDate),
  );
  const byCode = new Map<string, TaxRuleInput[]>();
  for (const row of rows) {
    const list = byCode.get(row.transactionCodeId) ?? [];
    list.push({
      id: row.taxRule.id,
      code: row.taxRule.code,
      name: row.taxRule.name,
      calculation: row.taxRule.calculation,
      basis: row.taxRule.basis,
      rate: units(row.taxRule.rate),
      sequence: row.sequence,
      transactionCodeId: row.taxRule.transactionCodeId,
    });
    byCode.set(row.transactionCodeId, list);
  }
  return byCode;
}

function requireManualCode(code: CodeRow | null): CodeRow {
  if (!code || code.status !== "ACTIVE") throw notFound("Charge code");
  if (
    !code.isManualPostAllowed ||
    code.group.type !== "REVENUE" ||
    code.bucket === "TAX" ||
    code.bucket === "PAYMENT"
  ) {
    throw rule(`${code.code} ${code.name} cannot be posted manually`, "CODE_NOT_POSTABLE");
  }
  if (code.isPaidOut) {
    throw rule("Paid-outs need cashiering, which is not available yet", "PAID_OUT_NOT_SUPPORTED");
  }
  return code;
}

function assertCodeLimits(code: CodeRow, unitAmount: MoneyUnits) {
  if (code.minAmount && unitAmount < units(code.minAmount)) {
    throw new AppError(
      "VALIDATION_FAILED",
      `The minimum price for ${code.code} is ${code.minAmount.toFixed(2)}`,
      {
        fields: { unitAmount: ["Below the minimum"] },
      },
    );
  }
  if (code.maxAmount && unitAmount > units(code.maxAmount)) {
    throw new AppError(
      "VALIDATION_FAILED",
      `The maximum price for ${code.code} is ${code.maxAmount.toFixed(2)}`,
      {
        fields: { unitAmount: ["Above the maximum"] },
      },
    );
  }
}

interface ChargeLines {
  folio: LockedFolio;
  code: { id: string; name: string };
  source: "MANUAL" | "SYSTEM" | "PACKAGE" | "NIGHT_AUDIT";
  businessDate: string;
  revenueDate: string | null;
  quantity: number;
  unitAmount: MoneyUnits;
  breakdown: ChargeBreakdown;
  description: string;
  reference?: string | null;
  comment?: string | null;
  postingKey?: string | null;
  reservationRoomId: string | null;
  roomId: string | null;
  packageComponentId?: string | null;
}

/** Appends a charge line and its generated tax lines (parent_item_id). */
async function insertChargeLines(tx: Tx, ctx: PropertyContext, lines: ChargeLines) {
  const common = {
    propertyId: ctx.propertyId,
    folioId: lines.folio.id,
    source: lines.source,
    businessDate: fromDateOnly(lines.businessDate),
    revenueDate: lines.revenueDate ? fromDateOnly(lines.revenueDate) : null,
    currencyCode: lines.folio.currency_code,
    originReservationRoomId: lines.reservationRoomId,
    roomId: lines.roomId,
    postedById: ctx.userId,
  };
  const charge = await insertItem(tx, {
    ...common,
    kind: "CHARGE",
    transactionCodeId: lines.code.id,
    quantity: lines.quantity,
    unitAmount: money(lines.unitAmount),
    amount: money(lines.breakdown.net),
    description: lines.description,
    reference: lines.reference ?? null,
    comment: lines.comment ?? null,
    postingKey: lines.postingKey ?? null,
    packageComponentId: lines.packageComponentId ?? null,
  });
  const ids = [charge.id];
  for (const tax of lines.breakdown.taxes) {
    if (tax.amount === 0n) continue;
    const row = await insertItem(tx, {
      ...common,
      kind: "TAX",
      transactionCodeId: tax.rule.transactionCodeId,
      quantity: 1,
      unitAmount: money(tax.amount),
      amount: money(tax.amount),
      description: tax.rule.name,
      parentItemId: charge.id,
    });
    ids.push(row.id);
  }
  return ids;
}

/** Stored totals after the trigger ran, re-verified against the ledger. */
async function totalsAfter(tx: Tx, propertyId: string, folioId: string) {
  const folio = await folioState(tx, propertyId, folioId);
  const balance = await verifiedBalance(tx, folio);
  return { balance, version: folio.version, status: folio.status };
}

function folioAudit(
  folio: { id: string; window: number; currency_code: string },
  extra: Record<string, unknown>,
) {
  return { folioId: folio.id, window: folio.window, currencyCode: folio.currency_code, ...extra };
}

// --- Folio windows ------------------------------------------------------------------

/**
 * Opens a reservation room's billing window inside the caller's
 * transaction (check-in opens window 1). The currency is the property's;
 * the payee is the primary guest. Returns the existing window when open.
 */
export async function ensureGuestFolioInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  reservationRoom: { id: string; primaryGuestId: string },
  window = 1,
): Promise<string> {
  const existing = await findWindowRef(tx, ctx.propertyId, reservationRoom.id, window);
  if (existing) return existing.id;
  const folio = await insertFolio(tx, {
    propertyId: ctx.propertyId,
    ownerType: "GUEST",
    window,
    reservationRoomId: reservationRoom.id,
    payeeGuestId: reservationRoom.primaryGuestId,
    status: "OPEN",
    currencyCode: ctx.currencyCode,
    openedById: ctx.userId,
  });
  await recordAudit(
    tx,
    { ...auditActor(ctx), businessDate },
    {
      action: "folio.open",
      resourceType: "Folio",
      resourceId: folio.id,
      after: { window, reservationRoomId: reservationRoom.id, currencyCode: ctx.currencyCode },
      permission: window === 1 ? "billing:post" : "billing:transfer",
    },
  );
  return folio.id;
}

/** Opens the next window of a stay (window 1 first; later windows need billing:transfer). */
export async function openWindow(
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<FolioAccountView> {
  await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const room = await lockReservationRoomById(tx, ctx, reservationRoomId);
    if (room.status !== "IN_HOUSE" && room.status !== "CHECKED_OUT") {
      throw rule("Folios open at check-in", "NOT_CHECKED_IN");
    }
    const count = await countWindows(tx, ctx.propertyId, reservationRoomId);
    if (count > 0) requirePermission(ctx, "billing:transfer");
    const { maxFolioWindows } = await billingRules(tx, ctx.propertyId);
    if (count >= maxFolioWindows) {
      throw rule(`This property allows ${maxFolioWindows} windows per stay`, "MAX_WINDOWS");
    }
    await ensureGuestFolioInTx(tx, ctx, businessDate, room, count + 1);
  });
  return getFolioAccount(ctx, reservationRoomId);
}

// --- Charges ------------------------------------------------------------------------

async function chargeInputs(
  tx: Tx,
  ctx: PropertyContext,
  folioId: string,
  input: ChargeInput,
  businessDate: string,
) {
  const ref = await findFolioRef(tx, ctx.propertyId, folioId);
  if (!ref) throw notFound("Folio");
  const code = requireManualCode(
    await findTransactionCode(tx, ctx.propertyId, input.transactionCodeId),
  );
  const minorUnits = await currencyMinorUnits(tx, ctx.currencyCode);
  const unitAmount = amountInCurrency(input.unitAmount, minorUnits, "unitAmount");
  assertCodeLimits(code, unitAmount);
  const rules =
    (await taxRulesByCode(tx, ctx.propertyId, [code.id], businessDate)).get(code.id) ?? [];
  const breakdown = calculateCharge({
    amount: unitAmount * BigInt(input.quantity),
    quantity: input.quantity,
    inclusive: code.isTaxInclusive,
    rules,
    minorUnits,
  });
  return { ref, code, unitAmount, breakdown };
}

/** What a manual charge will post (server-calculated taxes), without posting it. */
export async function previewCharge(
  ctx: PropertyContext,
  folioId: string,
  input: ChargeInput,
): Promise<ChargePreview> {
  const businessDate = requireLiveBusinessDate(ctx);
  const { ref, code, unitAmount, breakdown } = await chargeInputs(
    prisma,
    ctx,
    folioId,
    input,
    businessDate,
  );
  const balance = units(
    (await findWindows(prisma, ctx.propertyId, ref.reservationRoomId!)).find(
      (w) => w.id === ref.id,
    )!.balance,
  );
  return {
    currencyCode: ctx.currencyCode,
    quantity: input.quantity,
    unitAmount: money(unitAmount),
    inclusive: code.isTaxInclusive,
    net: money(breakdown.net),
    taxes: breakdown.taxes
      .filter((tax) => tax.amount !== 0n)
      .map((tax) => ({ code: tax.rule.code, name: tax.rule.name, amount: money(tax.amount) })),
    total: money(breakdown.total),
    balanceBefore: money(balance),
    balanceAfter: money(balance + breakdown.total),
  };
}

/** Manual posting of a charge code (billing:post). Idempotent by Idempotency-Key. */
export async function postCharge(
  ctx: PropertyContext,
  folioId: string,
  input: ChargeInput,
  idempotency: IdempotencyRequest | null,
): Promise<PostingResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const { ref, code, unitAmount, breakdown } = await chargeInputs(
        tx,
        ctx,
        folioId,
        input,
        businessDate,
      );
      const header = await findAccountHeader(tx, ctx.propertyId, ref.reservationRoomId!);
      const folio = await folioState(tx, ctx.propertyId, folioId);
      assertOpenForPosting(folio);
      const before = await verifiedBalance(tx, folio);

      const itemIds = await insertChargeLines(tx, ctx, {
        folio,
        code,
        source: "MANUAL",
        businessDate,
        revenueDate: null,
        quantity: input.quantity,
        unitAmount,
        breakdown,
        description: code.name,
        reference: input.reference,
        comment: input.comment,
        reservationRoomId: ref.reservationRoomId,
        roomId: header?.room?.id ?? null,
      });
      const after = await totalsAfter(tx, ctx.propertyId, folio.id);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "folio.post_charge",
          resourceType: "Folio",
          resourceId: folio.id,
          before: { balance: money(before) },
          after: folioAudit(folio, {
            itemIds,
            code: code.code,
            quantity: input.quantity,
            unitAmount: money(unitAmount),
            net: money(breakdown.net),
            taxes: breakdown.taxes.map((t) => ({ code: t.rule.code, amount: money(t.amount) })),
            total: money(breakdown.total),
            reference: input.reference ?? null,
            balance: money(after.balance),
          }),
          permission: "billing:post",
        },
      );
      return {
        folioId: folio.id,
        itemIds,
        total: money(breakdown.total),
        balance: money(after.balance),
        version: after.version,
      } satisfies PostingResult;
    });
    return result;
  });
}

// --- Room and package charges -------------------------------------------------------------

function packageComponentsFor(
  night: { stayDate: string },
  ratePlanPackages: PackageRows,
  reservationPackages: ReservationPackageRows,
): PackageComponentInput[] {
  const components: PackageComponentInput[] = [];
  const add = (
    pkg: PackageRows[number],
    packageQuantity: number,
    override: Prisma.Decimal | null,
    addOn: boolean,
  ) => {
    if (pkg.status !== "ACTIVE") return;
    // A package booked on the reservation is sold on top of the rate: it was
    // never part of it, so an "included" package posts as its own line
    // instead of being carved out of the room charge.
    const postingType =
      addOn && pkg.postingType === "INCLUDED_IN_RATE" ? "SEPARATE_LINE" : pkg.postingType;
    for (const component of pkg.components) {
      const seasonal = component.prices.find(
        (price) =>
          toDateOnly(price.startDate) <= night.stayDate &&
          toDateOnly(price.endDate) >= night.stayDate,
      );
      // A reservation override prices a single-component package.
      const price =
        override && pkg.components.length === 1
          ? override
          : (seasonal?.unitPrice ?? component.unitPrice);
      components.push({
        componentId: component.id,
        name: component.name,
        transactionCodeId: component.transactionCodeId,
        postingType,
        calculation: component.calculation,
        rhythm: component.postingRhythm,
        daysOfWeek: component.daysOfWeek,
        unitPrice: units(price),
        packageQuantity,
        isAllowance: component.isAllowance,
      });
    }
  };
  for (const pkg of ratePlanPackages) add(pkg, 1, null, false);
  for (const booked of reservationPackages) {
    const from = toDateOnly(booked.startDate);
    const to = toDateOnly(booked.endDate);
    if (night.stayDate >= from && night.stayDate <= to) {
      add(booked.package, booked.quantity, booked.unitPriceOverride, true);
    }
  }
  return components;
}

const packageSelect = {
  id: true,
  code: true,
  status: true,
  postingType: true,
  components: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      transactionCodeId: true,
      calculation: true,
      postingRhythm: true,
      daysOfWeek: true,
      unitPrice: true,
      isAllowance: true,
      prices: { select: { startDate: true, endDate: true, unitPrice: true } },
    },
  },
} as const satisfies Prisma.PackageSelect;

type PackageRows = Prisma.PackageGetPayload<{ select: typeof packageSelect }>[];
type ReservationPackageRows = {
  quantity: number;
  startDate: Date;
  endDate: Date;
  unitPriceOverride: Prisma.Decimal | null;
  package: PackageRows[number];
}[];

/** One line a stay night generates: a package component or the room line. */
interface NightLine {
  base: string;
  key: (generation: number) => string;
  codeId: string;
  quantity: number;
  unit: MoneyUnits;
  amount: MoneyUnits;
  inclusive: boolean;
  source: "PACKAGE" | "SYSTEM";
  description: string;
  componentId: string | null;
}

/**
 * The room and package lines of each night, before taxes: the single
 * definition of what a stay night charges, used by room-charge posting and
 * by the reservation's charge estimate. Included components are carved out
 * of the nightly rate, combined ones are added to it, separate ones post on
 * their own; each line carries its deterministic posting key base.
 */
async function planNightLines(
  tx: Tx,
  propertyId: string,
  reservationRoomId: string,
  nights: Awaited<ReturnType<typeof nightsForRoomCharges>>,
  stay: {
    arrival: string;
    departure: string;
    minorUnits: number;
    currencyCode: string;
    businessDate: string;
  },
) {
  const { arrival, departure, minorUnits } = stay;
  const ratePlanIds = [...new Set(nights.map((n) => n.ratePlanId))];
  const ratePlans = await tx.ratePlan.findMany({
    where: { propertyId: propertyId, id: { in: ratePlanIds } },
    select: {
      id: true,
      code: true,
      taxInclusive: true,
      roomTransactionCodeId: true,
      packages: { select: { package: { select: packageSelect } } },
    },
  });
  const reservationPackages = await tx.reservationPackage.findMany({
    where: { propertyId: propertyId, reservationRoomId },
    select: {
      quantity: true,
      startDate: true,
      endDate: true,
      unitPriceOverride: true,
      package: { select: packageSelect },
    },
  });

  const plannedCodeIds = new Set<string>();
  for (const plan of ratePlans) {
    plannedCodeIds.add(plan.roomTransactionCodeId);
    for (const { package: pkg } of plan.packages)
      pkg.components.forEach((c) => plannedCodeIds.add(c.transactionCodeId));
  }
  reservationPackages.forEach((rp) =>
    rp.package.components.forEach((c) => plannedCodeIds.add(c.transactionCodeId)),
  );
  const codes = new Map(
    (await findTransactionCodes(tx, propertyId, [...plannedCodeIds])).map((c) => [c.id, c]),
  );
  const rules = await taxRulesByCode(tx, propertyId, [...plannedCodeIds], stay.businessDate);

  const byNight = new Map<string, NightLine[]>();
  for (const night of nights) {
    if (night.currencyCode !== stay.currencyCode) {
      throw rule(
        `The night of ${night.stayDate} is priced in ${night.currencyCode}; this folio is in ${stay.currencyCode}. Currency conversion is not supported.`,
        "CURRENCY_MISMATCH",
      );
    }
    const plan = ratePlans.find((p) => p.id === night.ratePlanId)!;
    const packages = packageLinesForNight(
      packageComponentsFor(
        night,
        plan.packages.map((p) => p.package),
        reservationPackages,
      ),
      {
        night: night.stayDate,
        arrival,
        departure,
        adults: night.adults,
        children: night.children,
      },
    );
    const rate = roundToMinorUnits(parseMoney(night.rateAmount), minorUnits);
    let roomAmount: MoneyUnits;
    try {
      roomAmount = roomLineAmount(rate, packages);
    } catch {
      throw rule(
        `Included packages exceed the room rate on ${night.stayDate}`,
        "PACKAGE_EXCEEDS_RATE",
      );
    }

    const lines: NightLine[] = [
      ...packages
        .filter((line) => line.postingType !== "COMBINED_WITH_ROOM")
        .map((line) => ({
          base: packagePostingKey(reservationRoomId, night.stayDate, line.componentId, 0).replace(
            /:0$/,
            "",
          ),
          key: (generation: number) =>
            packagePostingKey(reservationRoomId, night.stayDate, line.componentId, generation),
          codeId: line.transactionCodeId,
          quantity: line.quantity,
          unit: line.unitPrice,
          amount: line.amount,
          // Included components are carved out of a tax-inclusive rate: they stay inclusive.
          inclusive:
            line.postingType === "INCLUDED_IN_RATE"
              ? plan.taxInclusive || codes.get(line.transactionCodeId)!.isTaxInclusive
              : codes.get(line.transactionCodeId)!.isTaxInclusive,
          source: "PACKAGE" as const,
          description: line.name,
          componentId: line.componentId,
        })),
      {
        base: roomPostingKey(reservationRoomId, night.stayDate, 0).replace(/:0$/, ""),
        key: (generation: number) => roomPostingKey(reservationRoomId, night.stayDate, generation),
        codeId: plan.roomTransactionCodeId,
        quantity: 1,
        unit: roomAmount,
        amount: roomAmount,
        inclusive: plan.taxInclusive || codes.get(plan.roomTransactionCodeId)!.isTaxInclusive,
        source: "SYSTEM" as const,
        description: `${codes.get(plan.roomTransactionCodeId)!.name} · ${night.stayDate}`,
        componentId: null,
      },
    ];

    byNight.set(night.stayDate, lines);
  }
  return { codes, rules, byNight };
}

/**
 * What the stay's nights will charge (room, packages, taxes), computed with
 * the posting engine itself — for the reservation screen. Nothing is posted.
 */
export async function estimateStayCharges(
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<StayChargeEstimate> {
  const room = await findRoomDatesForEstimate(ctx.propertyId, reservationRoomId);
  if (!room) throw notFound("Reservation");
  const businessDate = requireLiveBusinessDate(ctx);
  const nights = await nightsForRoomCharges(prisma, ctx.propertyId, reservationRoomId);
  const minorUnits = await currencyMinorUnits(prisma, ctx.currencyCode);
  const planned = await planNightLines(prisma, ctx.propertyId, reservationRoomId, nights, {
    arrival: toDateOnly(room.arrivalDate),
    departure: toDateOnly(room.departureDate),
    minorUnits,
    currencyCode: ctx.currencyCode,
    businessDate,
  });
  let grand = 0n;
  const result = nights.map((night) => {
    const lines = (planned.byNight.get(night.stayDate) ?? [])
      .filter((line) => line.amount !== 0n)
      .map((line) => {
        const breakdown = calculateCharge({
          amount: roundToMinorUnits(line.amount, minorUnits),
          quantity: line.quantity,
          inclusive: line.inclusive,
          rules: planned.rules.get(line.codeId) ?? [],
          minorUnits,
        });
        return {
          description: line.componentId ? line.description : planned.codes.get(line.codeId)!.name,
          code: planned.codes.get(line.codeId)!.code,
          kind: line.componentId ? ("PACKAGE" as const) : ("ROOM" as const),
          quantity: line.quantity,
          net: money(breakdown.net),
          taxes: money(breakdown.taxes.reduce((sum, t) => sum + t.amount, 0n)),
          total: breakdown.total,
        };
      });
    const total = lines.reduce((sum, line) => sum + line.total, 0n);
    grand += total;
    return {
      date: night.stayDate,
      rate: money(parseMoney(night.rateAmount)),
      posted: night.posted,
      lines: lines.map((line) => ({ ...line, total: money(line.total) })),
      total: money(total),
    };
  });
  return { currencyCode: ctx.currencyCode, minorUnits, nights: result, total: money(grand) };
}

function findRoomDatesForEstimate(propertyId: string, reservationRoomId: string) {
  return prisma.reservationRoom.findFirst({
    where: { id: reservationRoomId, propertyId },
    select: { arrivalDate: true, departureDate: true },
  });
}

/**
 * Posts the room charge (and package lines) of every stay night before the
 * business date that has no live posting yet — the manual stand-in for the
 * night audit's room-and-tax run. Tonight's charge belongs to night audit.
 *
 * Deterministic: each line carries a posting key (room night / component,
 * generation), and the unique index on it makes a repeated run a no-op; a
 * reversed night gets the next generation.
 */
export async function postRoomCharges(
  ctx: PropertyContext,
  reservationRoomId: string,
  input: RoomChargesInput,
  idempotency: IdempotencyRequest | null,
): Promise<RoomChargesResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const lastNight = addDays(businessDate, -1);
      if (input.through && input.through > lastNight) {
        throw rule(
          "Room charges post for nights before the business date; tonight's charge is posted by night audit",
          "NIGHT_NOT_OVER",
          { through: input.through, lastPostable: lastNight },
        );
      }
      const through = input.through ?? lastNight;
      const room = await lockReservationRoomById(tx, ctx, reservationRoomId);
      if (room.status !== "IN_HOUSE" && room.status !== "CHECKED_OUT") {
        throw rule("Room charges post for checked-in stays", "NOT_CHECKED_IN");
      }
      const posted = await postNightsInTx(tx, ctx, businessDate, room, through, {
        source: "SYSTEM",
        actor: auditActor(ctx),
        permission: "billing:post",
      });
      if (posted.postedNights.length === 0) {
        throw rule("There are no unposted room nights up to this date", "NOTHING_TO_POST", {
          through,
        });
      }
      return {
        reservationRoomId,
        postedNights: posted.postedNights,
        itemIds: posted.itemIds,
        total: money(posted.total),
      } satisfies RoomChargesResult;
    });
    return result;
  });
}

/** What one reservation room's posting run produced. */
export interface NightPostingResult {
  folioId: string | null;
  postedNights: string[];
  itemIds: string[];
  /** Charges and taxes posted (gross). */
  total: MoneyUnits;
  taxes: MoneyUnits;
}

/**
 * Posts the room charge and package lines of every stay night up to
 * `through` that has no live posting yet, inside the caller's transaction
 * (which holds the business date and the reservation room lock). The one
 * posting engine for the manual "Post room charges" command and for night
 * audit's POST_ROOM_AND_TAX step (D23, D30).
 *
 * Deterministic: each line carries a posting key (room night / component,
 * generation), and the unique index on it makes a repeated run a no-op; a
 * reversed night gets the next generation. Nothing is audited when nothing
 * was posted.
 */
export async function postNightsInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  room: LockedReservationRoom,
  through: string,
  options: {
    /** Source of the room line (package lines are PACKAGE). */
    source: "SYSTEM" | "NIGHT_AUDIT";
    actor: AuditActor;
    permission: Permission;
  },
): Promise<NightPostingResult> {
  const reservationRoomId = room.id;
  const nights = (await nightsForRoomCharges(tx, ctx.propertyId, reservationRoomId)).filter(
    (night) => night.stayDate <= through,
  );
  if (nights.length === 0 || nights.every((night) => night.posted)) {
    // A reversed night clears its `posted` flag, so a stay whose nights are
    // all flagged has no line left to post.
    return { folioId: null, postedNights: [], itemIds: [], total: 0n, taxes: 0n };
  }
  const folioId = await ensureGuestFolioInTx(tx, ctx, businessDate, room, 1);
  const folio = await folioState(tx, ctx.propertyId, folioId);
  assertOpenForPosting(folio);
  const before = await verifiedBalance(tx, folio);

  const arrival = toDateOnly(room.arrivalDate);
  const departure = toDateOnly(room.departureDate);
  const minorUnits = await currencyMinorUnits(tx, folio.currency_code);

  // Existing keys: generation count and whether a live (unreversed) posting exists.
  const keys = await findPostingKeys(tx, ctx.propertyId, reservationRoomId);
  const byBase = new Map<string, { generations: number; live: boolean }>();
  for (const key of keys) {
    const base = key.posting_key.slice(0, key.posting_key.lastIndexOf(":"));
    const entry = byBase.get(base) ?? { generations: 0, live: false };
    entry.generations += 1;
    entry.live ||= !key.reversed;
    byBase.set(base, entry);
  }

  const planned = await planNightLines(tx, ctx.propertyId, reservationRoomId, nights, {
    arrival,
    departure,
    minorUnits,
    currencyCode: folio.currency_code,
    businessDate,
  });
  const { codes, rules } = planned;

  const postedNights: string[] = [];
  const itemIds: string[] = [];
  let total = 0n;
  let taxes = 0n;
  for (const night of nights) {
    const lines = planned.byNight.get(night.stayDate)!;

    let postedAny = false;
    for (const line of lines) {
      const existing = byBase.get(line.base);
      if (existing?.live) continue;
      if (line.amount === 0n) continue;
      const code = codes.get(line.codeId);
      if (!code || code.status !== "ACTIVE") {
        throw rule(`Transaction code for ${line.description} is not active`, "CODE_INACTIVE");
      }
      const breakdown = calculateCharge({
        amount: roundToMinorUnits(line.amount, minorUnits),
        quantity: line.quantity,
        inclusive: line.inclusive,
        rules: rules.get(line.codeId) ?? [],
        minorUnits,
      });
      const ids = await insertChargeLines(tx, ctx, {
        folio,
        code,
        source: line.source === "SYSTEM" ? options.source : line.source,
        businessDate,
        revenueDate: night.stayDate,
        quantity: line.quantity,
        unitAmount: line.unit,
        breakdown,
        description: line.description,
        postingKey: line.key((existing?.generations ?? 0) + 1),
        reservationRoomId,
        roomId: room.roomId,
        packageComponentId: line.componentId,
      });
      itemIds.push(...ids);
      total += breakdown.total;
      taxes += breakdown.taxes.reduce((sum, tax) => sum + tax.amount, 0n);
      postedAny = true;
    }
    if (!night.posted) await markNightPosting(tx, reservationRoomId, night.stayDate, true);
    if (postedAny || !night.posted) postedNights.push(night.stayDate);
  }

  if (postedNights.length > 0) {
    const after = await totalsAfter(tx, ctx.propertyId, folio.id);
    await recordAudit(
      tx,
      { ...options.actor, businessDate },
      {
        action: "folio.post_room_charges",
        resourceType: "Folio",
        resourceId: folio.id,
        before: { balance: money(before) },
        after: folioAudit(folio, {
          reservationRoomId,
          nights: postedNights,
          itemIds,
          total: money(total),
          balance: money(after.balance),
          source: options.source,
        }),
        permission: options.permission,
      },
    );
  }
  return { folioId: folio.id, postedNights, itemIds, total, taxes };
}

/**
 * Night audit: the no-show fee of a guaranteed reservation (PMS_WORKFLOWS
 * §15) — the arrival night's rate with the fee code's taxes, on the
 * reservation room's window 1 (folios attach to reservation rooms, D6).
 * Keyed `NOSHOW:<reservation room>:1`, so it can never post twice.
 */
export async function postNoShowFeeInTx(
  tx: Tx,
  ctx: PropertyContext,
  businessDate: string,
  room: LockedReservationRoom,
  transactionCodeId: string,
  actor: AuditActor,
): Promise<{ itemIds: string[]; total: MoneyUnits; taxes: MoneyUnits } | null> {
  const postingKey = `NOSHOW:${room.id}:1`;
  const existing = await tx.folioItem.findFirst({
    where: { propertyId: ctx.propertyId, postingKey },
    select: { id: true },
  });
  if (existing) return null;
  const nights = await nightsForRoomCharges(tx, ctx.propertyId, room.id);
  const first = nights[0];
  if (!first) return null;
  const [code] = await findTransactionCodes(tx, ctx.propertyId, [transactionCodeId]);
  if (!code || code.status !== "ACTIVE") {
    throw rule("The no-show fee transaction code is not active", "CODE_INACTIVE");
  }
  const plan = await tx.ratePlan.findFirst({
    where: { propertyId: ctx.propertyId, id: first.ratePlanId },
    select: { taxInclusive: true },
  });
  const folioId = await ensureGuestFolioInTx(tx, ctx, businessDate, room, 1);
  const folio = await folioState(tx, ctx.propertyId, folioId);
  assertOpenForPosting(folio);
  const minorUnits = await currencyMinorUnits(tx, folio.currency_code);
  const rules = await taxRulesByCode(tx, ctx.propertyId, [code.id], businessDate);
  const amount = roundToMinorUnits(parseMoney(first.rateAmount), minorUnits);
  if (amount === 0n) return null;
  const breakdown = calculateCharge({
    amount,
    quantity: 1,
    inclusive: (plan?.taxInclusive ?? false) || code.isTaxInclusive,
    rules: rules.get(code.id) ?? [],
    minorUnits,
  });
  const itemIds = await insertChargeLines(tx, ctx, {
    folio,
    code,
    source: "NIGHT_AUDIT",
    businessDate,
    revenueDate: businessDate,
    quantity: 1,
    unitAmount: amount,
    breakdown,
    description: `${code.name} · ${first.stayDate}`,
    postingKey,
    reservationRoomId: room.id,
    roomId: null,
  });
  const taxes = breakdown.taxes.reduce((sum, tax) => sum + tax.amount, 0n);
  const after = await totalsAfter(tx, ctx.propertyId, folio.id);
  await recordAudit(
    tx,
    { ...actor, businessDate },
    {
      action: "folio.post_no_show_fee",
      resourceType: "Folio",
      resourceId: folio.id,
      risk: "HIGH",
      after: folioAudit(folio, {
        reservationRoomId: room.id,
        itemIds,
        total: money(breakdown.total),
        balance: money(after.balance),
      }),
      permission: "nightaudit:run",
    },
  );
  return { itemIds, total: breakdown.total, taxes };
}

// --- Corrections ------------------------------------------------------------------------

const isReversed = (item: { corrections: { kind: string }[] }) =>
  item.corrections.some((c) => c.kind === "REVERSAL");
const adjustedTotal = (item: { corrections: { kind: string; amount: Prisma.Decimal }[] }) =>
  item.corrections
    .filter((c) => c.kind === "ADJUSTMENT")
    .reduce((sum, c) => sum + units(c.amount), 0n);

async function requireCorrectable(tx: Tx, ctx: PropertyContext, itemId: string) {
  const item = await findItemForCorrection(tx, ctx.propertyId, itemId);
  if (!item) throw notFound("Posting");
  if (item.kind !== "CHARGE") {
    throw rule(
      item.kind === "PAYMENT"
        ? "Payments are corrected with a void or a refund"
        : "Only charges can be corrected; taxes follow their charge",
      "NOT_A_CHARGE",
    );
  }
  const folio = await folioState(tx, ctx.propertyId, item.folioId);
  assertOpenForPosting(folio);
  return { item, folio };
}

function nightOfRoomKey(key: string | null): string | null {
  return key?.startsWith("ROOM:") ? (key.split(":")[2] ?? null) : null;
}

/**
 * Same-day correction: an exact negating REVERSAL of a charge and each of its
 * taxes (billing:adjust, HIGH). A reversed room night can be posted again.
 */
export async function reverseItem(
  ctx: PropertyContext,
  itemId: string,
  input: ReverseInput,
  idempotency: IdempotencyRequest | null,
): Promise<PostingResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const { item, folio } = await requireCorrectable(tx, ctx, itemId);
      const problem = reversalProblem(
        {
          kind: item.kind,
          businessDate: toDateOnly(item.businessDate),
          reversed: isReversed(item),
          adjusted: adjustedTotal(item) !== 0n,
        },
        businessDate,
      );
      if (problem) throw rule(problem, "NOT_REVERSIBLE");
      const reason = await requireReason(tx, ctx.propertyId, input.reasonCodeId, "VOID", false);
      const before = await verifiedBalance(tx, folio);

      const common = {
        propertyId: ctx.propertyId,
        folioId: folio.id,
        kind: "REVERSAL" as const,
        source: "MANUAL" as const,
        businessDate: fromDateOnly(businessDate),
        revenueDate: item.revenueDate,
        currencyCode: item.currencyCode,
        originReservationRoomId: item.originReservationRoomId,
        roomId: item.roomId,
        reasonCodeId: reason?.id ?? null,
        comment: input.reason,
        postedById: ctx.userId,
      };
      const reversal = await insertItem(tx, {
        ...common,
        transactionCodeId: item.transactionCodeId,
        quantity: item.quantity.negated(),
        unitAmount: item.unitAmount,
        amount: item.amount.negated(),
        description: `Reversal · ${item.description}`,
        correctsItemId: item.id,
      });
      const itemIds = [reversal.id];
      let total = -units(item.amount);
      for (const tax of item.generatedItems) {
        if (isReversed(tax) || units(tax.amount) === 0n) continue;
        const row = await insertItem(tx, {
          ...common,
          transactionCodeId: tax.transactionCodeId,
          quantity: -1,
          unitAmount: tax.amount,
          amount: tax.amount.negated(),
          description: `Reversal · ${tax.description}`,
          correctsItemId: tax.id,
          parentItemId: reversal.id,
        });
        itemIds.push(row.id);
        total -= units(tax.amount);
      }
      const night = nightOfRoomKey(item.postingKey);
      if (night && item.originReservationRoomId) {
        await markNightPosting(tx, item.originReservationRoomId, night, false);
      }
      const after = await totalsAfter(tx, ctx.propertyId, folio.id);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "folio.reverse",
          resourceType: "Folio",
          resourceId: folio.id,
          risk: "HIGH",
          before: {
            itemId: item.id,
            code: item.transactionCode.code,
            amount: money(units(item.amount)),
            businessDate: toDateOnly(item.businessDate),
            balance: money(before),
          },
          after: folioAudit(folio, {
            itemIds,
            total: money(total),
            roomNightReopened: night,
            balance: money(after.balance),
          }),
          reason: input.reason,
          reasonCodeId: reason?.id ?? null,
          permission: "billing:adjust",
        },
      );
      return {
        folioId: folio.id,
        itemIds,
        total: money(total),
        balance: money(after.balance),
        version: after.version,
      } satisfies PostingResult;
    });
    return result;
  });
}

/**
 * Credits part or all of a charge (any business date): ADJUSTMENT lines on
 * the charge and, proportionally, on its taxes (billing:adjust, HIGH). The
 * original lines are never changed.
 */
export async function adjustItem(
  ctx: PropertyContext,
  itemId: string,
  input: AdjustInput,
  idempotency: IdempotencyRequest | null,
): Promise<PostingResult> {
  return runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const { result } = await runIdempotent(tx, ctx.userId, idempotency, async () => {
      const { item, folio } = await requireCorrectable(tx, ctx, itemId);
      if (isReversed(item)) throw rule("This charge has been reversed", "NOT_ADJUSTABLE");
      const reason = await requireReason(
        tx,
        ctx.propertyId,
        input.reasonCodeId,
        "ADJUSTMENT",
        true,
      );
      const minorUnits = await currencyMinorUnits(tx, folio.currency_code);
      const amount = amountInCurrency(input.amount, minorUnits, "amount");

      const lines = [
        { id: item.id, remaining: units(item.amount) + adjustedTotal(item) },
        ...item.generatedItems
          .filter((tax) => !isReversed(tax))
          .map((tax) => ({ id: tax.id, remaining: units(tax.amount) + adjustedTotal(tax) })),
      ];
      const available = lines.reduce((sum, line) => sum + line.remaining, 0n);
      if (amount > available) {
        throw rule(
          `At most ${formatMoney(available, minorUnits)} of this charge can still be credited`,
          "ADJUSTMENT_EXCEEDS_CHARGE",
          { available: money(available) },
        );
      }
      const parts = proportionalCredit(lines, amount, minorUnits);
      const before = await verifiedBalance(tx, folio);

      const common = {
        propertyId: ctx.propertyId,
        folioId: folio.id,
        kind: "ADJUSTMENT" as const,
        source: "MANUAL" as const,
        businessDate: fromDateOnly(businessDate),
        revenueDate: item.revenueDate,
        currencyCode: item.currencyCode,
        originReservationRoomId: item.originReservationRoomId,
        roomId: item.roomId,
        reasonCodeId: reason!.id,
        comment: input.reason,
        postedById: ctx.userId,
        quantity: 1,
      };
      const itemIds: string[] = [];
      let parentId: string | null = null;
      for (const part of parts) {
        if (part.amount === 0n) continue;
        const isCharge = part.id === item.id;
        const tax = item.generatedItems.find((t) => t.id === part.id);
        const row = await insertItem(tx, {
          ...common,
          transactionCodeId: isCharge
            ? (item.transactionCode.adjustmentCodeId ?? item.transactionCodeId)
            : tax!.transactionCodeId,
          unitAmount: money(-part.amount),
          amount: money(-part.amount),
          description: `Adjustment · ${isCharge ? item.description : tax!.description}`,
          correctsItemId: part.id,
          parentItemId: isCharge ? null : parentId,
        });
        if (isCharge) parentId = row.id;
        itemIds.push(row.id);
      }
      const after = await totalsAfter(tx, ctx.propertyId, folio.id);
      await recordAudit(
        tx,
        { ...auditActor(ctx), businessDate },
        {
          action: "folio.adjust",
          resourceType: "Folio",
          resourceId: folio.id,
          risk: "HIGH",
          before: {
            itemId: item.id,
            code: item.transactionCode.code,
            remaining: money(available),
            balance: money(before),
          },
          after: folioAudit(folio, {
            itemIds,
            credited: money(amount),
            parts: parts.map((p) => ({ itemId: p.id, amount: money(-p.amount) })),
            balance: money(after.balance),
          }),
          reason: input.reason,
          reasonCodeId: reason!.id,
          permission: "billing:adjust",
        },
      );
      return {
        folioId: folio.id,
        itemIds,
        total: money(-amount),
        balance: money(after.balance),
        version: after.version,
      } satisfies PostingResult;
    });
    return result;
  });
}

// --- Settlement ---------------------------------------------------------------------------

/** Confirms a zero-balance window as SETTLED (a later posting reopens it). */
export async function settleFolio(
  ctx: PropertyContext,
  folioId: string,
  input: SettleInput,
): Promise<FolioAccountView> {
  const reservationRoomId = await runInTransaction(async (tx) => {
    const businessDate = await requireOpenBusinessDate(tx, ctx.propertyId);
    const ref = await findFolioRef(tx, ctx.propertyId, folioId);
    if (!ref) throw notFound("Folio");
    const folio = await folioState(tx, ctx.propertyId, folioId);
    if (folio.version !== input.version) throw staleVersion("Folio");
    const balance = await verifiedBalance(tx, folio);
    const problem = settleProblem(folio.status, balance);
    if (problem) throw rule(problem, "NOT_SETTLEABLE", { balance: money(balance) });
    const { count } = await updateFolioVersioned(tx, folio.id, folio.version, {
      status: "SETTLED",
      settledAt: new Date(),
      settledById: ctx.userId,
    });
    if (count !== 1) throw staleVersion("Folio");
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate },
      {
        action: "folio.settle",
        resourceType: "Folio",
        resourceId: folio.id,
        before: { status: folio.status, balance: money(balance) },
        after: folioAudit(folio, { status: "SETTLED" }),
        permission: "payments:create",
      },
    );
    return ref.reservationRoomId!;
  });
  return getFolioAccount(ctx, reservationRoomId);
}

/**
 * Financial side of check-out (called by the front desk inside its
 * transaction, after its room locks): locks every window, recomputes each
 * balance from the ledger and, when the property requires it, refuses the
 * check-out while any window is not zero. Zero windows become SETTLED.
 */
export async function settleForCheckoutInTx(
  tx: Tx,
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<{ windows: number; balance: string; settled: number[] }> {
  const folios = await lockReservationRoomFolios(tx, ctx.propertyId, reservationRoomId);
  const { requireZeroBalanceCheckout } = await billingRules(tx, ctx.propertyId);
  const balances = [];
  for (const folio of folios) balances.push({ folio, balance: await verifiedBalance(tx, folio) });
  const outstanding = balances.filter((b) => b.balance !== 0n);
  if (requireZeroBalanceCheckout && outstanding.length > 0) {
    throw rule(
      "The guest's account has an outstanding balance. Settle every window before check-out.",
      "FOLIO_BALANCE_OUTSTANDING",
      {
        currencyCode: ctx.currencyCode,
        windows: outstanding.map((b) => ({ window: b.folio.window, balance: money(b.balance) })),
      },
    );
  }
  const settled: number[] = [];
  for (const { folio, balance } of balances) {
    if (balance !== 0n || folio.status !== "OPEN") continue;
    const { count } = await updateFolioVersioned(tx, folio.id, folio.version, {
      status: "SETTLED",
      settledAt: new Date(),
      settledById: ctx.userId,
    });
    if (count !== 1) throw staleVersion("Folio");
    settled.push(folio.window);
  }
  return {
    windows: folios.length,
    balance: money(balances.reduce((sum, b) => sum + b.balance, 0n)),
    settled,
  };
}

// --- Queries ------------------------------------------------------------------------------

function guestName(guest: { firstName: string; lastName: string }) {
  return `${guest.lastName}, ${guest.firstName}`;
}

/** Balance summary of a stay's windows (front desk), null when no folio exists. */
export async function folioSummary(
  tx: Tx,
  propertyId: string,
  reservationRoomId: string,
): Promise<FolioSummary | null> {
  const windows = await findWindows(tx, propertyId, reservationRoomId);
  if (windows.length === 0) return null;
  return {
    windows: windows.length,
    currencyCode: windows[0]!.currencyCode,
    minorUnits: await currencyMinorUnits(tx, windows[0]!.currencyCode),
    balance: money(windows.reduce((sum, w) => sum + units(w.balance), 0n)),
    status: windows.every((w) => w.status === "SETTLED")
      ? "SETTLED"
      : windows.every((w) => w.status === "CLOSED")
        ? "CLOSED"
        : "OPEN",
  };
}

export async function getFolioAccount(
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<FolioAccountView> {
  const header = await findAccountHeader(prisma, ctx.propertyId, reservationRoomId);
  if (!header) throw notFound("Folio");
  const businessDate = ctx.businessDate ?? "";
  const [windows, nights, minorUnits, rules] = await Promise.all([
    findWindows(prisma, ctx.propertyId, reservationRoomId),
    nightsForRoomCharges(prisma, ctx.propertyId, reservationRoomId),
    currencyMinorUnits(prisma, ctx.currencyCode),
    billingRules(prisma, ctx.propertyId),
  ]);
  const checkedIn = header.stay !== null;
  const eligible = nights.filter((n) => n.stayDate < businessDate);
  const unpostedNights = eligible.filter((n) => !n.posted).map((n) => n.stayDate);
  const totals = windows.reduce(
    (acc, w) => ({
      charges: acc.charges + units(w.chargesTotal),
      credits: acc.credits + units(w.creditsTotal),
      balance: acc.balance + units(w.balance),
    }),
    { charges: 0n, credits: 0n, balance: 0n },
  );
  const hasOpenWindow = windows.some((w) => w.status !== "CLOSED");
  return {
    reservationRoomId,
    confirmation: `${header.reservation.confirmationNumber}-${header.lineNumber}`,
    stayId: header.stay?.id ?? null,
    stayStatus: (header.stay?.status as "IN_HOUSE" | "CHECKED_OUT" | undefined) ?? null,
    reservationStatus: header.status,
    guest: { id: header.primaryGuest.id, name: guestName(header.primaryGuest) },
    room: header.room,
    roomType: header.roomType,
    ratePlanCode: header.ratePlan.code,
    arrival: toDateOnly(header.arrivalDate),
    departure: toDateOnly(header.departureDate),
    adults: header.adults,
    children: header.children,
    businessDate,
    currencyCode: ctx.currencyCode,
    minorUnits,
    maxWindows: rules.maxFolioWindows,
    requireZeroBalanceCheckout: rules.requireZeroBalanceCheckout,
    windows: windows.map((w) => ({
      id: w.id,
      window: w.window,
      status: w.status as FolioStatus,
      currencyCode: w.currencyCode,
      payeeName: w.payeeAccount?.name ?? (w.payeeGuest ? guestName(w.payeeGuest) : null),
      chargesTotal: money(units(w.chargesTotal)),
      creditsTotal: money(units(w.creditsTotal)),
      balance: money(units(w.balance)),
      version: w.version,
      openedAt: w.openedAt.toISOString(),
      settledAt: w.settledAt?.toISOString() ?? null,
      closedAt: w.closedAt?.toISOString() ?? null,
    })),
    totals: {
      charges: money(totals.charges),
      credits: money(totals.credits),
      balance: money(totals.balance),
    },
    roomCharges: {
      unpostedNights,
      postedNights: nights.filter((n) => n.posted).length,
      totalNights: nights.length,
    },
    actions: {
      postCharge: can(ctx, "billing:post") && hasOpenWindow,
      postRoomCharges: can(ctx, "billing:post") && checkedIn && unpostedNights.length > 0,
      takePayment: can(ctx, "payments:create") && hasOpenWindow,
      openWindow:
        checkedIn &&
        windows.length < rules.maxFolioWindows &&
        can(ctx, windows.length === 0 ? "billing:post" : "billing:transfer"),
      settle: can(ctx, "payments:create"),
      reverse: can(ctx, "billing:adjust"),
      adjust: can(ctx, "billing:adjust"),
      voidPayment: can(ctx, "payments:void"),
      refund: can(ctx, "payments:refund"),
      viewHistory: can(ctx, "audit:read"),
    },
  };
}

/** One page of a window's ledger, oldest first, with the database-computed running balance. */
export async function listLedger(
  ctx: PropertyContext,
  folioId: string,
  query: LedgerQuery,
): Promise<LedgerPage> {
  const ref = await findFolioRef(prisma, ctx.propertyId, folioId);
  if (!ref) throw notFound("Folio");
  let after: { postedAt: Date; id: string } | null = null;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor, ["t", "i"] as const);
    const postedAt = decoded ? new Date(decoded.t) : null;
    if (!decoded || !postedAt || Number.isNaN(postedAt.getTime())) {
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
    after = { postedAt, id: decoded.i };
  }
  const windows = await findWindows(prisma, ctx.propertyId, ref.reservationRoomId!);
  const folioStatus = windows.find((w) => w.id === folioId)?.status ?? "OPEN";
  const rows = await findLedgerPage(prisma, ctx.propertyId, folioId, after, query.limit);
  const page = rows.slice(0, query.limit);
  const businessDate = ctx.businessDate;
  const open = folioStatus !== "CLOSED";
  const items: LedgerItemView[] = page.map((row) => {
    const amount = parseMoney(row.amount);
    const adjusted = parseMoney(row.adjusted);
    const isPaymentLine =
      row.kind === "PAYMENT" && row.refund_id === null && row.payment_id !== null;
    const captured = row.payment_status === "CAPTURED";
    return {
      id: row.id,
      folioId: row.folio_id,
      kind: row.kind,
      source: row.source,
      businessDate: toDateOnly(row.business_date),
      revenueDate: row.revenue_date ? toDateOnly(row.revenue_date) : null,
      postedAt: row.posted_at.toISOString(),
      description: row.description,
      reference: row.reference,
      comment: row.comment,
      code: { id: row.code_id, code: row.code, name: row.code_name },
      quantity: row.quantity,
      unitAmount: row.unit_amount,
      amount: money(amount),
      runningBalance: money(parseMoney(row.running_balance)),
      parentItemId: row.parent_item_id,
      correctsItemId: row.corrects_item_id,
      reasonCode: row.reason_code,
      postedBy: row.posted_by,
      reversed: row.reversed,
      adjusted: money(adjusted),
      payment:
        row.payment_id && row.method_name
          ? {
              id: row.payment_id,
              receiptNumber: row.receipt_number,
              method: row.method_name,
              status: row.payment_status ?? "CAPTURED",
              refundable: money(parseMoney(row.refundable ?? "0")),
            }
          : null,
      actions: {
        reverse:
          open &&
          can(ctx, "billing:adjust") &&
          row.kind === "CHARGE" &&
          !row.reversed &&
          adjusted === 0n &&
          toDateOnly(row.business_date) === businessDate,
        adjust:
          open &&
          can(ctx, "billing:adjust") &&
          row.kind === "CHARGE" &&
          !row.reversed &&
          amount + adjusted > 0n,
        void:
          open &&
          can(ctx, "payments:void") &&
          isPaymentLine &&
          captured &&
          parseMoney(row.refunded ?? "0") === 0n &&
          row.payment_business_date !== null &&
          toDateOnly(row.payment_business_date) === businessDate,
        refund:
          open &&
          can(ctx, "payments:refund") &&
          isPaymentLine &&
          captured &&
          parseMoney(row.refundable ?? "0") > 0n,
      },
    };
  });
  const last = page.at(-1);
  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ t: last.posted_at.toISOString(), i: last.id })
        : null,
  };
}

/** Audit history of a stay's windows (audit:read). */
export async function folioHistory(
  ctx: PropertyContext,
  reservationRoomId: string,
): Promise<ResourceHistoryEntry[]> {
  requirePermission(ctx, "audit:read");
  // Another property's (or an unknown) stay is indistinguishable from a missing one.
  if (!(await findAccountHeader(prisma, ctx.propertyId, reservationRoomId)))
    throw notFound("Folio");
  const windows = await findWindows(prisma, ctx.propertyId, reservationRoomId);
  return resourceHistory(
    prisma,
    ctx,
    windows.map((w) => w.id),
    200,
  );
}

export async function listFolios(
  ctx: PropertyContext,
  query: FolioListQuery,
): Promise<{ items: FolioListRow[]; nextCursor: string | null }> {
  const search = query.q
    ? { tokens: normalizeName(query.q).split(" ").filter(Boolean).slice(0, 5), raw: query.q.trim() }
    : null;
  let cursor: { v: string; i: string } | null = null;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor, ["v", "i"] as const);
    if (!cursor) {
      throw new AppError("VALIDATION_FAILED", "Invalid cursor", {
        fields: { cursor: ["Invalid cursor"] },
      });
    }
  }
  const rows = await findFolioListPage(prisma, ctx.propertyId, {
    view: query.view,
    search,
    cursor,
    limit: query.limit,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      reservationRoomId: row.reservation_room_id,
      confirmation: row.confirmation_number,
      guestName: `${row.last_name}, ${row.first_name}`,
      roomNumber: row.room_number,
      arrival: toDateOnly(row.arrival_date),
      departure: toDateOnly(row.departure_date),
      stayStatus: row.stay_status,
      windows: row.windows,
      currencyCode: row.currency_code ?? ctx.currencyCode,
      balance: money(parseMoney(row.balance)),
      status:
        row.windows === 0
          ? null
          : row.open_windows > 0
            ? "OPEN"
            : row.settled_windows > 0
              ? "SETTLED"
              : "CLOSED",
    })),
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ v: last.search_name, i: last.reservation_room_id })
        : null,
  };
}

export async function billingOptions(ctx: PropertyContext): Promise<BillingOptions> {
  const [codes, methods, reasons, minorUnits] = await Promise.all([
    findManualChargeCodes(prisma, ctx.propertyId),
    findPaymentMethods(prisma, ctx.propertyId),
    findFinancialReasonCodes(prisma, ctx.propertyId),
    currencyMinorUnits(prisma, ctx.currencyCode),
  ]);
  const decimal = (value: Prisma.Decimal | null) => (value ? money(units(value)) : null);
  return {
    currencyCode: ctx.currencyCode,
    minorUnits,
    businessDate: ctx.businessDate,
    chargeCodes: codes.map((code) => ({
      id: code.id,
      code: code.code,
      name: code.name,
      group: code.group.code,
      defaultPrice: decimal(code.defaultPrice),
      minAmount: decimal(code.minAmount),
      maxAmount: decimal(code.maxAmount),
      taxInclusive: code.isTaxInclusive,
    })),
    paymentMethods: methods.map((method) => ({
      id: method.id,
      code: method.code,
      name: method.name,
      kind: method.kind,
      requiresReference: method.requiresReference,
    })),
    reasonCodes: reasons.map((reason) => ({
      id: reason.id,
      category: reason.category,
      code: reason.code,
      name: reason.name,
    })),
  };
}
