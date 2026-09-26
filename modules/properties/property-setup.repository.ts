import "server-only";
import type { Tx } from "@/lib/db/prisma";

/**
 * Reads and writes of the reference setup a property can copy from another
 * one (D37). Every query is scoped by property; only ACTIVE source rows are
 * read (retired codes are not carried into a new property).
 */

const active = (propertyId: string) => ({ propertyId, status: "ACTIVE" as const });

/** Serializes concurrent copies into the same target (row lock until commit). */
export async function lockTargetProperty(tx: Tx, organizationId: string, propertyId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "properties"
    WHERE "id" = ${propertyId}::uuid AND "organization_id" = ${organizationId}::uuid
    FOR UPDATE`;
  return rows.length > 0;
}

export function findSetupProperty(tx: Tx, organizationId: string, propertyId: string) {
  return tx.property.findFirst({
    where: { id: propertyId, organizationId, status: "ACTIVE" },
    select: { id: true, code: true, currencyCode: true },
  });
}

export async function readSourceSetup(tx: Tx, propertyId: string) {
  const [
    groups,
    codes,
    taxRules,
    taxLinks,
    reasonCodes,
    marketGroups,
    marketCodes,
    sourceCodes,
    channels,
    paymentMethods,
    taskTypes,
    blockStatuses,
    reservationTypes,
    cancellationPolicies,
    depositPolicies,
    configuration,
  ] = await Promise.all([
    tx.transactionCodeGroup.findMany({
      where: { propertyId },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        sortOrder: true,
        parentId: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.transactionCode.findMany({
      where: active(propertyId),
      select: {
        id: true,
        groupId: true,
        code: true,
        name: true,
        bucket: true,
        isManualPostAllowed: true,
        isPaidOut: true,
        isTaxInclusive: true,
        includeInDepositRule: true,
        includeInCancellationRule: true,
        defaultPrice: true,
        minAmount: true,
        maxAmount: true,
        adjustmentCodeId: true,
        glAccount: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.taxRule.findMany({
      where: active(propertyId),
      select: {
        id: true,
        code: true,
        name: true,
        calculation: true,
        basis: true,
        rate: true,
        transactionCodeId: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.transactionCodeTax.findMany({
      where: { propertyId },
      select: { transactionCodeId: true, taxRuleId: true, sequence: true },
    }),
    tx.reasonCode.findMany({
      where: active(propertyId),
      select: { category: true, code: true, name: true, requiresComment: true },
      orderBy: [{ category: "asc" }, { code: "asc" }],
    }),
    tx.marketGroup.findMany({
      where: active(propertyId),
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    tx.marketCode.findMany({
      where: active(propertyId),
      select: { code: true, name: true, marketGroupId: true },
      orderBy: { code: "asc" },
    }),
    tx.sourceCode.findMany({
      where: active(propertyId),
      select: { code: true, name: true, groupCode: true },
      orderBy: { code: "asc" },
    }),
    tx.channel.findMany({
      where: active(propertyId),
      select: { code: true, name: true },
      orderBy: { code: "asc" },
    }),
    tx.paymentMethod.findMany({
      where: active(propertyId),
      select: {
        code: true,
        name: true,
        kind: true,
        transactionCodeId: true,
        requiresReference: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.housekeepingTaskType.findMany({
      where: active(propertyId),
      select: {
        code: true,
        name: true,
        credits: true,
        estimatedMinutes: true,
        changesRoomStatus: true,
        requiresInspection: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.blockStatus.findMany({
      where: active(propertyId),
      select: {
        code: true,
        name: true,
        type: true,
        allowsPickup: true,
        isDefault: true,
        sortOrder: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.reservationType.findMany({
      where: active(propertyId),
      select: {
        code: true,
        name: true,
        deductsInventory: true,
        isGuaranteed: true,
        requiresCard: true,
        requiresDeposit: true,
        requiresEta: true,
        releaseTime: true,
        postNoShowCharge: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.cancellationPolicy.findMany({
      where: active(propertyId),
      select: {
        code: true,
        name: true,
        deadlineHours: true,
        penaltyType: true,
        penaltyValue: true,
        description: true,
      },
      orderBy: { code: "asc" },
    }),
    tx.depositPolicy.findMany({
      where: active(propertyId),
      select: { code: true, name: true, amountType: true, amountValue: true, dueDays: true },
      orderBy: { code: "asc" },
    }),
    tx.propertyConfiguration.findUnique({
      where: { propertyId },
      select: {
        noShowTransactionCode: { select: { code: true } },
        noShowReasonCode: { select: { category: true, code: true } },
      },
    }),
  ]);
  return {
    groups,
    codes,
    taxRules,
    taxLinks,
    reasonCodes,
    marketGroups,
    marketCodes,
    sourceCodes,
    channels,
    paymentMethods,
    taskTypes,
    blockStatuses,
    reservationTypes,
    cancellationPolicies,
    depositPolicies,
    configuration,
  };
}

export type SourceSetup = Awaited<ReturnType<typeof readSourceSetup>>;

/** Existing codes of the target (all statuses: a retired code is never recreated). */
export async function readTargetCodes(tx: Tx, propertyId: string) {
  const where = { propertyId };
  const [
    groups,
    codes,
    taxRules,
    taxLinks,
    reasonCodes,
    marketGroups,
    marketCodes,
    sourceCodes,
    channels,
    paymentMethods,
    taskTypes,
    blockStatuses,
    reservationTypes,
    cancellationPolicies,
    depositPolicies,
  ] = await Promise.all([
    tx.transactionCodeGroup.findMany({ where, select: { id: true, code: true } }),
    tx.transactionCode.findMany({ where, select: { id: true, code: true, bucket: true } }),
    tx.taxRule.findMany({ where, select: { id: true, code: true } }),
    tx.transactionCodeTax.findMany({
      where,
      select: { transactionCodeId: true, taxRuleId: true },
    }),
    tx.reasonCode.findMany({ where, select: { id: true, category: true, code: true } }),
    tx.marketGroup.findMany({ where, select: { id: true, code: true } }),
    tx.marketCode.findMany({ where, select: { id: true, code: true } }),
    tx.sourceCode.findMany({ where, select: { id: true, code: true } }),
    tx.channel.findMany({ where, select: { id: true, code: true } }),
    tx.paymentMethod.findMany({ where, select: { id: true, code: true } }),
    tx.housekeepingTaskType.findMany({ where, select: { id: true, code: true } }),
    tx.blockStatus.findMany({ where, select: { id: true, code: true, isDefault: true } }),
    tx.reservationType.findMany({ where, select: { id: true, code: true } }),
    tx.cancellationPolicy.findMany({ where, select: { id: true, code: true } }),
    tx.depositPolicy.findMany({ where, select: { id: true, code: true } }),
  ]);
  return {
    groups,
    codes,
    taxRules,
    taxLinks,
    reasonCodes,
    marketGroups,
    marketCodes,
    sourceCodes,
    channels,
    paymentMethods,
    taskTypes,
    blockStatuses,
    reservationTypes,
    cancellationPolicies,
    depositPolicies,
  };
}
