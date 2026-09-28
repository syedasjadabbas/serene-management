import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

/**
 * Standard starter reference setup of a property (D49): the codes a property
 * needs before it can take reservations, post charges, accept payments, run
 * housekeeping and close the day. Applied automatically to an organization's
 * first property (properties.service `createProperty`); later properties copy
 * a sibling's setup instead (D37, property-setup.service). The development
 * seed and the integration fixtures build on the same function.
 *
 * Currency-neutral: no prices or flat amounts. Taxes, rooms, room types, rate
 * plans and packages are property-specific and never part of it. Every
 * entry is editable afterwards like any other code.
 */

/** Ids of the created (or already present) rows, by code. */
export interface StarterSetup {
  reservationTypes: Record<string, string>;
  marketCodes: Record<string, string>;
  sourceCodes: Record<string, string>;
  channels: Record<string, string>;
  /** Keyed `CATEGORY:CODE`. */
  reasonCodes: Record<string, string>;
  cancellationPolicies: Record<string, string>;
  taskTypes: Record<string, string>;
  maintenanceCategories: Record<string, string>;
  /** Transaction code ids by code ("1000", "2000", payment codes). */
  chargeCodes: Record<string, string>;
  paymentMethods: Record<string, string>;
  /** Block statuses by code: INQ, TENT, DEF, LOST. */
  blockStatuses: Record<string, string>;
}

/**
 * Chart of postable codes every property gets (Phase 5). Amounts are not
 * set here: prices are entered at posting time or come from rates/packages.
 */
const CHARGE_GROUPS = [
  ["FNB", "Food & beverage", "REVENUE", 2],
  ["MISC", "Guest services", "REVENUE", 3],
  ["TAX", "Taxes & service charges", "REVENUE", 8],
  ["PAY", "Payments", "PAYMENT", 9],
] as const;

const CHARGE_CODES = [
  ["2000", "Restaurant", "FNB", "FOOD_BEVERAGE"],
  ["2010", "Room service", "FNB", "FOOD_BEVERAGE"],
  ["2020", "Minibar", "FNB", "MINIBAR"],
  ["2030", "Breakfast", "FNB", "FOOD_BEVERAGE"],
  ["3000", "Laundry", "MISC", "LAUNDRY"],
  ["3010", "Telephone", "MISC", "TELEPHONE"],
  ["3020", "Airport transfer", "MISC", "TRANSPORT"],
  ["3030", "Spa", "MISC", "SPA"],
  ["3090", "Miscellaneous", "MISC", "OTHER"],
] as const;

const PAYMENT_METHODS = [
  ["CASH", "Cash", "CASH", "9000", "Cash", false],
  ["CARD", "Card (hotel terminal)", "CREDIT_CARD", "9100", "Card payment", true],
  ["BANK", "Bank transfer", "BANK_TRANSFER", "9200", "Bank transfer", true],
] as const;

/**
 * Reference setup of a property: market/source/channel/reason codes,
 * reservation types, cancellation policies, charge and payment codes,
 * payment methods, block statuses, housekeeping task types, maintenance
 * categories and the night audit codes. Idempotent by code.
 */
export async function applyStarterSetup(db: Tx, propertyId: string): Promise<StarterSetup> {
  const upsertByCode = <T extends { id: string }>(existing: T | null, create: () => Promise<T>) =>
    existing ? Promise.resolve(existing) : create();

  // Reference codes --------------------------------------------------------------
  const marketGroup = await upsertByCode(
    await db.marketGroup.findFirst({ where: { propertyId, code: "TRN" }, select: { id: true } }),
    () =>
      db.marketGroup.create({
        data: { propertyId, code: "TRN", name: "Transient" },
        select: { id: true },
      }),
  );
  const marketCodes: Record<string, string> = {};
  for (const [code, name] of [
    ["BAR", "Best available rate"],
    ["COR", "Corporate"],
    ["LEI", "Leisure package"],
    ["OTA", "Online travel agency"],
    ["GRP", "Groups"],
  ] as const) {
    const row = await upsertByCode(
      await db.marketCode.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.marketCode.create({
          data: { propertyId, code, name, marketGroupId: marketGroup.id },
          select: { id: true },
        }),
    );
    marketCodes[code] = row.id;
  }
  const sourceCodes: Record<string, string> = {};
  for (const [code, name] of [
    ["DIR", "Direct"],
    ["PHN", "Telephone"],
    ["WEB", "Hotel website"],
    ["WLK", "Walk-in"],
    ["OTA", "Online travel agency"],
  ] as const) {
    const row = await upsertByCode(
      await db.sourceCode.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () => db.sourceCode.create({ data: { propertyId, code, name }, select: { id: true } }),
    );
    sourceCodes[code] = row.id;
  }
  const channels: Record<string, string> = {};
  for (const [code, name] of [
    ["FD", "Front desk"],
    ["RES", "Reservations office"],
    ["WEB", "Booking engine"],
  ] as const) {
    const row = await upsertByCode(
      await db.channel.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () => db.channel.create({ data: { propertyId, code, name }, select: { id: true } }),
    );
    channels[code] = row.id;
  }
  const reasonCodes: Record<string, string> = {};
  for (const [category, code, name] of [
    ["CANCELLATION", "GUEST", "Cancelled by guest"],
    ["CANCELLATION", "PLANS", "Change of plans"],
    ["CANCELLATION", "DUPL", "Duplicate booking"],
    ["NO_SHOW", "NOSHOW", "Guest did not arrive"],
    ["NO_SHOW", "LATE", "Arrived after release time"],
    ["NO_SHOW", "AUTO", "Automatic no-show (night audit)"],
    ["OUT_OF_ORDER", "MAINT", "Maintenance work"],
    ["OUT_OF_ORDER", "RENO", "Renovation"],
    ["OUT_OF_SERVICE", "TOUCH", "Touch-up / minor repair"],
    ["OUT_OF_SERVICE", "AMEN", "Amenity or furniture missing"],
    ["ROOM_MOVE", "GUEST", "Guest request"],
    ["ROOM_MOVE", "NOISE", "Noise or comfort complaint"],
    ["ROOM_MOVE", "MAINT", "Maintenance issue in room"],
    ["EARLY_DEPARTURE", "PLANS", "Change of plans"],
    ["EARLY_DEPARTURE", "EMERG", "Personal emergency"],
    ["ADJUSTMENT", "RATE", "Rate correction"],
    ["ADJUSTMENT", "SVC", "Service recovery"],
    ["ADJUSTMENT", "ERR", "Posting error"],
    ["VOID", "ERR", "Posted in error"],
    ["VOID", "DUP", "Duplicate posting"],
    ["REFUND", "OVER", "Overpayment"],
    ["REFUND", "GOOD", "Goodwill gesture"],
    ["REFUND", "NSVC", "Service not provided"],
  ] as const) {
    const row = await upsertByCode(
      await db.reasonCode.findFirst({
        where: { propertyId, category, code },
        select: { id: true },
      }),
      () =>
        db.reasonCode.create({ data: { propertyId, category, code, name }, select: { id: true } }),
    );
    reasonCodes[`${category}:${code}`] = row.id;
  }
  const reservationTypes: Record<string, string> = {};
  for (const [code, name, deductsInventory, isGuaranteed] of [
    ["TENT", "Tentative (not deducted)", false, false],
    ["6PM", "6 PM hold", true, false],
    ["GTD", "Guaranteed", true, true],
    ["COMP", "Company guaranteed", true, true],
  ] as const) {
    const row = await upsertByCode(
      await db.reservationType.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.reservationType.create({
          data: {
            propertyId,
            code,
            name,
            deductsInventory,
            isGuaranteed,
            releaseTime: code === "6PM" ? "18:00" : null,
          },
          select: { id: true },
        }),
    );
    reservationTypes[code] = row.id;
    // Phase 8: guaranteed reservations are charged a no-show fee by night audit.
    await db.reservationType.update({
      where: { id: row.id },
      data: { postNoShowCharge: isGuaranteed },
    });
  }
  const cancellationPolicies: Record<string, string> = {};
  for (const [code, name, deadlineHours, penaltyType, penaltyValue, description] of [
    [
      "24H",
      "24 hours",
      24,
      "NIGHTS",
      "1",
      "Free cancellation until 24 hours before arrival; then one night is charged.",
    ],
    [
      "72H",
      "72 hours",
      72,
      "NIGHTS",
      "1",
      "Free cancellation until 72 hours before arrival; then one night is charged.",
    ],
    [
      "NRF",
      "Non-refundable",
      0,
      "PERCENT_OF_STAY",
      "100",
      "Non-refundable: the full stay is charged on cancellation.",
    ],
  ] as const) {
    const row = await upsertByCode(
      await db.cancellationPolicy.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.cancellationPolicy.create({
          data: { propertyId, code, name, deadlineHours, penaltyType, penaltyValue, description },
          select: { id: true },
        }),
    );
    cancellationPolicies[code] = row.id;
  }

  // Room charge transaction code ---------------------------------------------------
  const group = await upsertByCode(
    await db.transactionCodeGroup.findFirst({
      where: { propertyId, code: "LODG" },
      select: { id: true },
    }),
    () =>
      db.transactionCodeGroup.create({
        data: { propertyId, code: "LODG", name: "Lodging", type: "REVENUE" },
        select: { id: true },
      }),
  );
  const roomCharge = await upsertByCode(
    await db.transactionCode.findFirst({
      where: { propertyId, code: "1000" },
      select: { id: true },
    }),
    () =>
      db.transactionCode.create({
        data: {
          propertyId,
          groupId: group.id,
          code: "1000",
          name: "Room charge",
          bucket: "ROOM",
          isManualPostAllowed: false,
        },
        select: { id: true },
      }),
  );

  // Night audit (Phase 8): the no-show fee code (room revenue, kept out of ADR).
  const noShowCharge = await upsertByCode(
    await db.transactionCode.findFirst({
      where: { propertyId, code: "1090" },
      select: { id: true },
    }),
    () =>
      db.transactionCode.create({
        data: {
          propertyId,
          groupId: group.id,
          code: "1090",
          name: "No-show charge",
          bucket: "ROOM",
          isManualPostAllowed: false,
        },
        select: { id: true },
      }),
  );

  // Billing configuration (Phase 5): codes, taxes, payment methods ------------------
  const chargeCodes: Record<string, string> = { "1000": roomCharge.id, "1090": noShowCharge.id };
  const groups: Record<string, string> = {};
  for (const [code, name, type, sortOrder] of CHARGE_GROUPS) {
    const row = await upsertByCode(
      await db.transactionCodeGroup.findFirst({
        where: { propertyId, code },
        select: { id: true },
      }),
      () =>
        db.transactionCodeGroup.create({
          data: { propertyId, code, name, type, sortOrder },
          select: { id: true },
        }),
    );
    groups[code] = row.id;
  }
  const upsertCode = async (
    code: string,
    data: Omit<Prisma.TransactionCodeUncheckedCreateInput, "propertyId" | "code">,
  ) => {
    const row = await upsertByCode(
      await db.transactionCode.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.transactionCode.create({ data: { propertyId, code, ...data }, select: { id: true } }),
    );
    chargeCodes[code] = row.id;
    return row.id;
  };
  for (const [code, name, group, bucket] of CHARGE_CODES) {
    await upsertCode(code, { groupId: groups[group]!, name, bucket, isManualPostAllowed: true });
  }
  const paymentMethods: Record<string, string> = {};
  for (const [code, name, kind, txCode, txName, requiresReference] of PAYMENT_METHODS) {
    const transactionCodeId = await upsertCode(txCode, {
      groupId: groups.PAY!,
      name: txName,
      bucket: "PAYMENT",
      isManualPostAllowed: false,
    });
    const row = await upsertByCode(
      await db.paymentMethod.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.paymentMethod.create({
          data: { propertyId, code, name, kind, transactionCodeId, requiresReference },
          select: { id: true },
        }),
    );
    paymentMethods[code] = row.id;
  }

  // Night audit configuration (Phase 8): fee code and automatic no-show reason,
  // unless the property already chose its own.
  await db.propertyConfiguration.updateMany({
    where: { propertyId, noShowTransactionCodeId: null },
    data: { noShowTransactionCodeId: noShowCharge.id },
  });
  await db.propertyConfiguration.updateMany({
    where: { propertyId, noShowReasonCodeId: null },
    data: { noShowReasonCodeId: reasonCodes["NO_SHOW:AUTO"]! },
  });
  const blockStatuses: Record<string, string> = {};
  for (const [code, name, type, allowsPickup, isDefault, sortOrder] of [
    ["INQ", "Inquiry", "INQUIRY", false, false, 1],
    ["TENT", "Tentative", "NON_DEDUCT", false, false, 2],
    ["DEF", "Definite", "DEDUCT", true, true, 3],
    ["LOST", "Lost / cancelled", "CANCEL", false, false, 4],
  ] as const) {
    const row = await upsertByCode(
      await db.blockStatus.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.blockStatus.create({
          data: { propertyId, code, name, type, allowsPickup, isDefault, sortOrder },
          select: { id: true },
        }),
    );
    blockStatuses[code] = row.id;
  }
  // Housekeeping task types and maintenance categories (Phase 4) ---------------------
  const taskTypes: Record<string, string> = {};
  for (const [code, name, minutes, changesRoomStatus, requiresInspection] of [
    ["DEP", "Departure clean", 45, true, true],
    ["STAY", "Stayover clean", 25, true, false],
    ["DEEP", "Deep clean", 120, true, true],
    ["TURN", "Turndown", 10, false, false],
    ["SPEC", "Special cleaning", 60, true, true],
  ] as const) {
    const row = await upsertByCode(
      await db.housekeepingTaskType.findFirst({
        where: { propertyId, code },
        select: { id: true },
      }),
      () =>
        db.housekeepingTaskType.create({
          data: {
            propertyId,
            code,
            name,
            estimatedMinutes: minutes,
            changesRoomStatus,
            requiresInspection,
          },
          select: { id: true },
        }),
    );
    taskTypes[code] = row.id;
  }
  const maintenanceCategories: Record<string, string> = {};
  for (const [code, name] of [
    ["PLUMB", "Plumbing"],
    ["ELEC", "Electrical"],
    ["HVAC", "Heating and air conditioning"],
    ["FURN", "Furniture and fixtures"],
    ["GEN", "General"],
  ] as const) {
    const row = await upsertByCode(
      await db.maintenanceCategory.findFirst({ where: { propertyId, code }, select: { id: true } }),
      () =>
        db.maintenanceCategory.create({ data: { propertyId, code, name }, select: { id: true } }),
    );
    maintenanceCategories[code] = row.id;
  }
  return {
    reservationTypes,
    marketCodes,
    sourceCodes,
    channels,
    reasonCodes,
    cancellationPolicies,
    taskTypes,
    maintenanceCategories,
    chargeCodes,
    paymentMethods,
    blockStatuses,
  };
}
