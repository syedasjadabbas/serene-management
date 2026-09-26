import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";

export const propertySelect = {
  id: true,
  code: true,
  name: true,
  legalName: true,
  timezone: true,
  currencyCode: true,
  countryCode: true,
  defaultLocale: true,
  checkInTime: true,
  checkOutTime: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  phone: true,
  email: true,
  confirmationPrefix: true,
} as const satisfies Prisma.PropertySelect;

export type PropertyRow = Prisma.PropertyGetPayload<{ select: typeof propertySelect }>;

export const configurationSelect = {
  maxFolioWindows: true,
  allowOverbooking: true,
  requireInspectedForCheckIn: true,
  usePickupStatus: true,
  useInspectedStatus: true,
  autoNoShowOnNightAudit: true,
  postNoShowCharges: true,
  requireZeroBalanceCheckout: true,
  allowCancelWithDeposit: true,
  autoCloseCashiersOnAudit: true,
  roomHoldDefaultMinutes: true,
  noShowTransactionCodeId: true,
  noShowReasonCodeId: true,
  updatedAt: true,
} as const satisfies Prisma.PropertyConfigurationSelect;

export type ConfigurationRow = Prisma.PropertyConfigurationGetPayload<{
  select: typeof configurationSelect;
}>;

export function findOrganization(tx: Tx, organizationId: string) {
  return tx.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, code: true, name: true, legalName: true, baseCurrency: true },
  });
}

/** Always scoped by organization: a property id from another tenant finds nothing. */
export function findProperty(tx: Tx, organizationId: string, propertyId: string) {
  return tx.property.findFirst({
    where: { id: propertyId, organizationId, status: "ACTIVE" },
    select: propertySelect,
  });
}

export function findPropertiesByIds(tx: Tx, organizationId: string, ids: string[]) {
  return tx.property.findMany({
    where: { organizationId, status: "ACTIVE", id: { in: ids } },
    select: propertySelect,
    orderBy: { code: "asc" },
  });
}

export function currencyExists(tx: Tx, code: string) {
  return tx.currency.count({ where: { code, status: "ACTIVE" } });
}

export function insertProperty(tx: Tx, data: Prisma.PropertyUncheckedCreateInput) {
  return tx.property.create({ data, select: propertySelect });
}

export function insertConfiguration(tx: Tx, propertyId: string) {
  return tx.propertyConfiguration.create({ data: { propertyId }, select: configurationSelect });
}

export function findConfiguration(tx: Tx, propertyId: string) {
  return tx.propertyConfiguration.findUnique({
    where: { propertyId },
    select: configurationSelect,
  });
}

export function upsertConfiguration(
  tx: Tx,
  propertyId: string,
  data: Prisma.PropertyConfigurationUncheckedUpdateInput,
) {
  return tx.propertyConfiguration.upsert({
    where: { propertyId },
    create: {
      propertyId,
      ...(data as Omit<Prisma.PropertyConfigurationUncheckedCreateInput, "propertyId">),
    },
    update: data,
    select: configurationSelect,
  });
}

export function updatePropertyTimes(
  tx: Tx,
  propertyId: string,
  data: {
    timezone?: string;
    checkInTime?: string;
    checkOutTime?: string;
    confirmationPrefix?: string;
  },
) {
  return tx.property.update({ where: { id: propertyId }, data, select: propertySelect });
}

/** Whether another property of the organization already uses the confirmation prefix. */
export function confirmationPrefixTaken(
  tx: Tx,
  organizationId: string,
  prefix: string,
  exceptPropertyId: string | null,
) {
  return tx.property.count({
    where: {
      organizationId,
      confirmationPrefix: prefix,
      ...(exceptPropertyId ? { id: { not: exceptPropertyId } } : {}),
    },
  });
}

/** The server-authoritative confirmation prefix of a property (D36). */
export async function findConfirmationPrefix(tx: Tx, propertyId: string): Promise<string> {
  const row = await tx.property.findUnique({
    where: { id: propertyId },
    select: { confirmationPrefix: true },
  });
  if (!row) throw new Error(`Property ${propertyId} not found`);
  return row.confirmationPrefix;
}

/**
 * Next value of a per-property counter (gap-free). The row is created on first
 * use; UPDATE ... RETURNING row-locks it until the caller's transaction ends,
 * so concurrent callers queue and a rollback returns the number unused.
 */
export async function nextSequenceValue(
  tx: Tx,
  propertyId: string,
  name: string,
  initial: { start: number; prefix: string },
): Promise<{ value: bigint; prefix: string }> {
  await tx.$executeRaw`
    INSERT INTO "property_sequences" ("property_id", "name", "prefix", "next_value", "updated_at")
    VALUES (${propertyId}::uuid, ${name}, ${initial.prefix}, ${initial.start}, now())
    ON CONFLICT ("property_id", "name") DO NOTHING`;
  const rows = await tx.$queryRaw<{ value: bigint; prefix: string }[]>`
    UPDATE "property_sequences"
    SET "next_value" = "next_value" + 1, "updated_at" = now()
    WHERE "property_id" = ${propertyId}::uuid AND "name" = ${name}
    RETURNING "next_value" - 1 AS "value", "prefix"`;
  const row = rows[0];
  if (!row) throw new Error(`Sequence ${name} could not be allocated`);
  return { value: BigInt(row.value), prefix: row.prefix };
}
