import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  businessDateSync,
  fromDateOnly,
  isAcceptableInitialBusinessDate,
  localDateInZone,
  localTimeInZone,
  toDateOnly,
} from "./business-date.policy";
import {
  countBusinessDates,
  findCurrentBusinessDate,
  insertBusinessDate,
  lockCurrentBusinessDateForShare,
} from "./business-date.repository";
import type { InitializeBusinessDateInput } from "./business-date.schema";
import type { BusinessDateView } from "./business-date.types";

export async function getBusinessDateView(
  property: { propertyId: string; timezone: string },
  now: Date = new Date(),
): Promise<BusinessDateView> {
  const current = await findCurrentBusinessDate(prisma, property.propertyId);
  return buildView(property, current, now);
}

/** Current business date as "YYYY-MM-DD" (null before go-live); used to build request contexts. */
export async function getCurrentBusinessDate(propertyId: string): Promise<string | null> {
  const current = await findCurrentBusinessDate(prisma, propertyId);
  return current ? toDateOnly(current.date) : null;
}

/**
 * Go-live: opens the property's first business date. Allowed once per
 * property; the date must be the property's local calendar date or the day
 * before. High-risk: audited with reason.
 */
export async function initializeBusinessDate(
  ctx: PropertyContext,
  input: InitializeBusinessDateInput,
  now: Date = new Date(),
): Promise<BusinessDateView> {
  const localDate = localDateInZone(now, ctx.timezone);
  if (!isAcceptableInitialBusinessDate(input.date, localDate)) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The first business date must be the property's current local date or the day before",
      { propertyLocalDate: localDate, requested: input.date },
    );
  }

  const created = await runInTransaction(async (tx) => {
    // The partial unique index (one current date per property) is the final
    // guard against a concurrent initialization.
    if ((await countBusinessDates(tx, ctx.propertyId)) > 0) {
      throw new AppError("CONFLICT", "The business date for this property is already initialized");
    }
    const row = await insertBusinessDate(tx, ctx.propertyId, fromDateOnly(input.date));
    await recordAudit(
      tx,
      { ...auditActor(ctx), businessDate: input.date },
      {
        action: "business_date.initialize",
        resourceType: "BusinessDate",
        resourceId: row.id,
        risk: "HIGH",
        after: { date: input.date, status: row.status, timezone: ctx.timezone },
        reason: input.reason,
        reasonCodeId: input.reasonCodeId ?? null,
        permission: "properties:manage",
      },
    );
    return row;
  });

  return buildView({ propertyId: ctx.propertyId, timezone: ctx.timezone }, created, now);
}

/** True once the property has gone live (any business date, open or closed). */
export async function hasBusinessDateHistory(tx: Tx, propertyId: string): Promise<boolean> {
  return (await countBusinessDates(tx, propertyId)) > 0;
}

/**
 * For posting services (Phase 5+): returns the open business date with a
 * shared lock held until the caller's transaction ends. Throws when the
 * property is not live or night audit is running.
 */
export async function requireOpenBusinessDate(tx: Tx, propertyId: string): Promise<string> {
  const row = await lockCurrentBusinessDateForShare(tx, propertyId);
  if (!row) {
    // A command that waited on the lock while night audit closed the date
    // finds the old row no longer current (the new one is outside its
    // snapshot): the date just rolled, the client retries on the new date.
    if ((await countBusinessDates(tx, propertyId)) > 0) {
      throw new AppError(
        "BUSINESS_DATE_LOCKED",
        "The business date has just changed. Refresh and try again",
        { reason: "BUSINESS_DATE_CHANGED" },
      );
    }
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "The property business date has not been initialized",
    );
  }
  if (row.status !== "OPEN") {
    throw new AppError("BUSINESS_DATE_LOCKED", "Night audit is in progress for this property");
  }
  return toDateOnly(row.date);
}

function buildView(
  property: { propertyId: string; timezone: string },
  current: { date: Date; status: "OPEN" | "IN_AUDIT" | "CLOSED" } | null,
  now: Date,
): BusinessDateView {
  const propertyLocalDate = localDateInZone(now, property.timezone);
  const propertyLocalTime = localTimeInZone(now, property.timezone);
  if (!current || current.status === "CLOSED") {
    return {
      propertyId: property.propertyId,
      timezone: property.timezone,
      businessDate: null,
      status: "NOT_INITIALIZED",
      propertyLocalDate,
      propertyLocalTime,
      sync: null,
    };
  }
  const businessDate = toDateOnly(current.date);
  return {
    propertyId: property.propertyId,
    timezone: property.timezone,
    businessDate,
    status: current.status,
    propertyLocalDate,
    propertyLocalTime,
    sync: businessDateSync(businessDate, propertyLocalDate),
  };
}
