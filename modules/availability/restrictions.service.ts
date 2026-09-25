import "server-only";
import { prisma } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { recordAudit } from "@/modules/audit/audit.service";
import { addDays, fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { weekdayBit } from "@/modules/rates/rates.policy";
import { stayNights } from "@/modules/reservations/reservations.policy";
import type { RestrictionsQuery, SetRestrictionsInput } from "./availability.schema";

/**
 * Restriction management (Phase 6). Writes the sparse `restrictions` rows the
 * availability engine already evaluates (availability.policy
 * .restrictionViolations — the single evaluator used by search, rate quotes
 * and booking). Precedence is simple and deterministic: every row whose
 * scope matches applies (house, room type, rate plan, room type + rate
 * plan); rules only close or constrain, none re-opens, so a stay is
 * bookable only when no applicable row is violated.
 *
 * `availability:manage` is high-risk: a reason is required and every change
 * is audited HIGH with its range, scope and the number of days touched.
 */

export interface RestrictionListRow {
  id: string;
  stayDate: string;
  type: string;
  value: number | null;
  roomType: { id: string; code: string } | null;
  ratePlan: { id: string; code: string } | null;
}

export async function listRestrictions(
  ctx: PropertyContext,
  query: RestrictionsQuery,
): Promise<RestrictionListRow[]> {
  const rows = await prisma.restriction.findMany({
    where: {
      propertyId: ctx.propertyId,
      stayDate: { gte: fromDateOnly(query.from), lte: fromDateOnly(query.to) },
      ...(query.roomTypeId ? { OR: [{ roomTypeId: null }, { roomTypeId: query.roomTypeId }] } : {}),
      ...(query.ratePlanId
        ? { AND: [{ OR: [{ ratePlanId: null }, { ratePlanId: query.ratePlanId }] }] }
        : {}),
    },
    orderBy: [{ stayDate: "asc" }, { type: "asc" }],
    take: 2000,
    select: {
      id: true,
      stayDate: true,
      type: true,
      value: true,
      roomType: { select: { id: true, code: true } },
      ratePlan: { select: { id: true, code: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    stayDate: toDateOnly(row.stayDate),
    type: row.type,
    value: row.value,
    roomType: row.roomType,
    ratePlan: row.ratePlan,
  }));
}

export async function setRestrictions(
  ctx: PropertyContext,
  input: SetRestrictionsInput,
): Promise<{ days: string[]; action: "set" | "clear"; changed: number }> {
  return runInTransaction(async (tx) => {
    // One restriction editor at a time per property (the partial unique
    // indexes remain the final guard).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restrictions:${ctx.propertyId}`}))`;
    if (input.roomTypeId) {
      const roomType = await tx.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: ctx.propertyId },
        select: { id: true },
      });
      if (!roomType) throw new AppError("NOT_FOUND", "Room type not found");
    }
    if (input.ratePlanId) {
      const plan = await tx.ratePlan.findFirst({
        where: { id: input.ratePlanId, propertyId: ctx.propertyId },
        select: { id: true },
      });
      if (!plan) throw new AppError("NOT_FOUND", "Rate plan not found");
    }
    const days = stayNights(input.from, addDays(input.to, 1)).filter(
      (date) => (weekdayBit(date) & input.daysOfWeek) !== 0,
    );
    if (days.length === 0) {
      throw new AppError("VALIDATION_FAILED", "No date in the range falls on the chosen weekdays", {
        fields: { daysOfWeek: ["No matching date"] },
      });
    }
    const scope = { roomTypeId: input.roomTypeId, ratePlanId: input.ratePlanId };
    const { count: removed } = await tx.restriction.deleteMany({
      where: {
        propertyId: ctx.propertyId,
        type: input.type,
        stayDate: { in: days.map(fromDateOnly) },
        ...scope,
      },
    });
    let created = 0;
    if (input.action === "set") {
      created = (
        await tx.restriction.createMany({
          data: days.map((date) => ({
            propertyId: ctx.propertyId,
            stayDate: fromDateOnly(date),
            type: input.type,
            ...scope,
            value: input.value,
            createdById: ctx.userId,
          })),
        })
      ).count;
    }
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: input.action === "set" ? "restriction.set" : "restriction.clear",
        resourceType: "Restriction",
        resourceId: ctx.propertyId,
        risk: "HIGH",
        after: {
          type: input.type,
          from: input.from,
          to: input.to,
          daysOfWeek: input.daysOfWeek,
          ...scope,
          value: input.value,
          days: days.length,
          removed,
          created,
        },
        reason: input.reason,
        permission: "availability:manage",
      },
    );
    return { days, action: input.action, changed: input.action === "set" ? created : removed };
  });
}
