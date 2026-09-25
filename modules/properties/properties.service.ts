import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext, type SessionContext } from "@/lib/http/context";
import { AppError, notFound } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit.service";
import { hasBusinessDateHistory } from "@/modules/business-date/business-date.service";
import {
  type ConfigurationRow,
  currencyExists,
  findConfiguration,
  findOrganization,
  findPropertiesByIds,
  findProperty,
  insertConfiguration,
  insertProperty,
  nextSequenceValue,
  type PropertyRow,
  updatePropertyTimes,
  upsertConfiguration,
} from "./properties.repository";
import type { CreatePropertyInput, UpdatePropertyConfigurationInput } from "./properties.schema";
import type { OrganizationView, PropertyConfigurationView, PropertyView } from "./properties.types";

/** Defaults mirror the column defaults, used when a legacy property has no configuration row. */
const DEFAULT_CONFIGURATION = {
  maxFolioWindows: 8,
  allowOverbooking: false,
  requireInspectedForCheckIn: false,
  usePickupStatus: false,
  useInspectedStatus: true,
  autoNoShowOnNightAudit: true,
  postNoShowCharges: true,
  requireZeroBalanceCheckout: true,
  allowCancelWithDeposit: false,
  autoCloseCashiersOnAudit: false,
  roomHoldDefaultMinutes: 30,
  noShowTransactionCodeId: null,
  noShowReasonCodeId: null,
};

export async function getOrganization(ctx: SessionContext): Promise<OrganizationView> {
  const organization = await findOrganization(prisma, ctx.organizationId);
  if (!organization) throw notFound("Organization");
  return organization;
}

/** Properties the caller can access (from the resolved access profile, never from the client). */
export async function listAccessibleProperties(ctx: SessionContext): Promise<PropertyView[]> {
  const rows = await findPropertiesByIds(
    prisma,
    ctx.organizationId,
    Object.keys(ctx.access.byProperty),
  );
  return rows.map(toPropertyView);
}

export async function getProperty(ctx: PropertyContext): Promise<PropertyView> {
  const row = await findProperty(prisma, ctx.organizationId, ctx.propertyId);
  if (!row) throw notFound("Property");
  return toPropertyView(row);
}

/** Creates a property with its configuration row. Organization-level, high-risk. */
export async function createProperty(
  ctx: SessionContext,
  input: CreatePropertyInput,
): Promise<PropertyView> {
  return runInTransaction(async (tx) => {
    if ((await currencyExists(tx, input.currencyCode)) === 0) {
      throw new AppError("VALIDATION_FAILED", "Unknown currency", {
        fields: { currencyCode: ["Unknown currency"] },
      });
    }
    const row = await insertProperty(tx, {
      organizationId: ctx.organizationId,
      code: input.code,
      name: input.name,
      legalName: input.legalName ?? null,
      timezone: input.timezone,
      currencyCode: input.currencyCode,
      countryCode: input.countryCode,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
    });
    await insertConfiguration(tx, row.id);
    const view = toPropertyView(row);
    await recordAudit(
      tx,
      { ...auditActor(ctx), propertyId: row.id },
      {
        action: "property.create",
        resourceType: "Property",
        resourceId: row.id,
        risk: "HIGH",
        after: view,
        reason: input.reason,
        permission: "properties:manage",
      },
    );
    return view;
  });
}

export async function getPropertyConfiguration(
  ctx: PropertyContext,
): Promise<PropertyConfigurationView> {
  const [property, configuration] = await Promise.all([
    findProperty(prisma, ctx.organizationId, ctx.propertyId),
    findConfiguration(prisma, ctx.propertyId),
  ]);
  if (!property) throw notFound("Property");
  return toConfigurationView(property, configuration);
}

/**
 * Changes operational settings. High-risk: audited with before/after and
 * reason. The time zone may change only before go-live, because every
 * business date and local-time rule depends on it.
 */
export async function updatePropertyConfiguration(
  ctx: PropertyContext,
  input: UpdatePropertyConfigurationInput,
): Promise<PropertyConfigurationView> {
  const { reason, reasonCodeId, timezone, checkInTime, checkOutTime, ...settings } = input;

  return runInTransaction(async (tx) => {
    const property = await findProperty(tx, ctx.organizationId, ctx.propertyId);
    if (!property) throw notFound("Property");
    const before = toConfigurationView(property, await findConfiguration(tx, ctx.propertyId));

    if (
      timezone !== undefined &&
      timezone !== property.timezone &&
      (await hasBusinessDateHistory(tx, ctx.propertyId))
    ) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "The time zone cannot change after the property's business date has been initialized",
      );
    }

    const updatedProperty =
      timezone !== undefined || checkInTime !== undefined || checkOutTime !== undefined
        ? await updatePropertyTimes(tx, ctx.propertyId, {
            ...(timezone !== undefined ? { timezone } : {}),
            ...(checkInTime !== undefined ? { checkInTime } : {}),
            ...(checkOutTime !== undefined ? { checkOutTime } : {}),
          })
        : property;
    await assertNightAuditCodes(tx, ctx.propertyId, settings);
    const configuration = await upsertConfiguration(tx, ctx.propertyId, settings);
    const after = toConfigurationView(updatedProperty, configuration);

    await recordAudit(tx, auditActor(ctx), {
      action: "property.configuration_update",
      resourceType: "PropertyConfiguration",
      resourceId: ctx.propertyId,
      risk: "HIGH",
      before: changedFields(before, after, "before"),
      after: changedFields(before, after, "after"),
      reason,
      reasonCodeId: reasonCodeId ?? null,
      permission: "settings:manage",
    });
    return after;
  });
}

/** The no-show fee must post with a revenue code; the automatic reason must be a NO_SHOW reason. */
async function assertNightAuditCodes(
  tx: Tx,
  propertyId: string,
  settings: { noShowTransactionCodeId?: string | null; noShowReasonCodeId?: string | null },
) {
  if (settings.noShowTransactionCodeId) {
    const code = await tx.transactionCode.findFirst({
      where: {
        id: settings.noShowTransactionCodeId,
        propertyId,
        status: "ACTIVE",
        bucket: { notIn: ["PAYMENT", "TAX", "NON_REVENUE"] },
        group: { type: "REVENUE" },
      },
      select: { id: true },
    });
    if (!code) {
      throw new AppError("VALIDATION_FAILED", "Choose an active revenue transaction code", {
        fields: { noShowTransactionCodeId: ["Not a revenue code of this property"] },
      });
    }
  }
  if (settings.noShowReasonCodeId) {
    const reason = await tx.reasonCode.findFirst({
      where: { id: settings.noShowReasonCodeId, propertyId, category: "NO_SHOW", status: "ACTIVE" },
      select: { id: true },
    });
    if (!reason) {
      throw new AppError("VALIDATION_FAILED", "Choose an active no-show reason code", {
        fields: { noShowReasonCodeId: ["Not a no-show reason of this property"] },
      });
    }
  }
}

function toPropertyView(row: PropertyRow): PropertyView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    legalName: row.legalName,
    timezone: row.timezone,
    currencyCode: row.currencyCode,
    countryCode: row.countryCode,
    defaultLocale: row.defaultLocale,
    checkInTime: row.checkInTime,
    checkOutTime: row.checkOutTime,
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
    },
    phone: row.phone,
    email: row.email,
  };
}

function toConfigurationView(
  property: Pick<PropertyRow, "id" | "timezone" | "checkInTime" | "checkOutTime">,
  configuration: ConfigurationRow | null,
): PropertyConfigurationView {
  const { updatedAt, ...settings } = configuration ?? { ...DEFAULT_CONFIGURATION, updatedAt: null };
  return {
    propertyId: property.id,
    timezone: property.timezone,
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
    ...settings,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

/** Only the settings that actually changed, so the audit record stays readable. */
function changedFields(
  before: PropertyConfigurationView,
  after: PropertyConfigurationView,
  side: "before" | "after",
): Record<string, unknown> {
  const source = side === "before" ? before : after;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof PropertyConfigurationView)[]) {
    if (key === "updatedAt" || key === "propertyId") continue;
    if (before[key] !== after[key]) result[key] = source[key];
  }
  return result;
}

/** Per-property document numbers. Confirmation numbers start at 100000 (6+ digits, human friendly). */
const SEQUENCES = {
  confirmation: { start: 100000, prefix: "" },
  cancellation: { start: 1000, prefix: "X" },
  maintenance: { start: 1000, prefix: "M" },
  receipt: { start: 1, prefix: "R" },
} as const;

export async function allocateNumber(
  tx: Tx,
  propertyId: string,
  name: keyof typeof SEQUENCES,
): Promise<string> {
  const { value, prefix } = await nextSequenceValue(tx, propertyId, name, SEQUENCES[name]);
  return `${prefix}${value.toString()}`;
}

/**
 * Front-office rules from the property configuration, for use inside a
 * command's transaction. A property without a configuration row uses the
 * schema defaults.
 */
/** Billing switches (Phase 5): zero-balance check-out rule and window limit. */
export async function billingRules(
  tx: Tx,
  propertyId: string,
): Promise<{ requireZeroBalanceCheckout: boolean; maxFolioWindows: number }> {
  const configuration = await findConfiguration(tx, propertyId);
  return {
    requireZeroBalanceCheckout:
      configuration?.requireZeroBalanceCheckout ?? DEFAULT_CONFIGURATION.requireZeroBalanceCheckout,
    maxFolioWindows: configuration?.maxFolioWindows ?? DEFAULT_CONFIGURATION.maxFolioWindows,
  };
}

export async function frontOfficeRules(
  tx: Tx,
  propertyId: string,
): Promise<{ requireInspectedForCheckIn: boolean; usePickupStatus: boolean }> {
  const configuration = await findConfiguration(tx, propertyId);
  return {
    requireInspectedForCheckIn: configuration?.requireInspectedForCheckIn ?? false,
    usePickupStatus: configuration?.usePickupStatus ?? false,
  };
}
