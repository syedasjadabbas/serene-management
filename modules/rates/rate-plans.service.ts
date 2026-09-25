import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError, notFound, staleVersion } from "@/lib/http/errors";
import { hasPermission } from "@/lib/permissions/evaluate";
import { formatMoney, isMinorUnitAligned, parseMoney } from "@/lib/utils/money";
import { recordAudit } from "@/modules/audit/audit.service";
import type { RestrictionRow } from "@/modules/availability/availability.policy";
import { loadRestrictions } from "@/modules/availability/availability.service";
import { addDays, fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { stayNights } from "@/modules/reservations/reservations.policy";
import { derivationProblem, priceNights, seasonsConflict, selectSeason } from "./rates.policy";
import {
  deleteSeason,
  findActivePackages,
  findActiveChildCodes,
  findPlanChainIds,
  findPlanLinks,
  findRatePlanDetail,
  findRatePlanList,
  findRatePlansForStay,
  findRateReferenceData,
  findSeasonAmounts,
  findSeasons,
  insertRatePlan,
  insertSeason,
  lockRatePlanChain,
  findCompanies,
  replacePlanAccounts,
  replacePlanPackages,
  replacePlanRoomTypes,
  replaceSeasonAmounts,
  updateRatePlanVersioned,
  updateSeason,
} from "./rates.repository";
import type {
  CalendarQuery,
  CreateRatePlanInput,
  RatePlanAccountsInput,
  RatePlanPackagesInput,
  SeasonInput,
  UpdateRatePlanInput,
} from "./rates.schema";
import { currencyMinorUnits, toPricing } from "./rates.service";
import type {
  RateAdminOptions,
  RateCalendarView,
  RatePlanDetail,
  RatePlanListItem,
} from "./rates.types";

/**
 * Rate administration (Phase 6): rate plans, seasons, package attachment and
 * the pricing calendar. It configures the Phase 2 pricing engine
 * (rates.policy.priceNights) and never computes prices another way: the
 * calendar and every booking run the same function.
 *
 * Every change locks the plan (and its parents) FOR UPDATE — bookings hold
 * the same rows FOR SHARE while they price — bumps the plan's version (409
 * on a stale edit) and writes a HIGH audit record with the reason
 * (`rates:manage` is high-risk).
 */

const toMoney = (value: Prisma.Decimal | null) =>
  value === null ? null : formatMoney(parseMoney(value.toFixed(4)));

function rule(message: string, reason: string, details: Record<string, unknown> = {}) {
  return new AppError("BUSINESS_RULE_VIOLATION", message, { reason, ...details });
}

function fieldError(field: string, message: string) {
  return new AppError("VALIDATION_FAILED", message, { fields: { [field]: [message] } });
}

function price(value: string | null | undefined, minorUnits: number, field: string) {
  if (value === null || value === undefined || value === "") return null;
  if (!isMinorUnitAligned(parseMoney(value), minorUnits)) {
    throw fieldError(field, `At most ${minorUnits} decimals`);
  }
  return formatMoney(parseMoney(value));
}

const dateOrNull = (value: string | null | undefined) => (value ? fromDateOnly(value) : null);

// --- Queries ------------------------------------------------------------------------

export async function listRatePlans(ctx: PropertyContext): Promise<RatePlanListItem[]> {
  const rows = await findRatePlanList(prisma, ctx.propertyId);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    status: row.status,
    currencyCode: row.currencyCode,
    taxInclusive: row.taxInclusive,
    version: row.version,
    displayOrder: row.displayOrder,
    parent: row.parent,
    derivation:
      row.derivationType && row.derivationValue
        ? { type: row.derivationType, value: toMoney(row.derivationValue)! }
        : null,
    roomTypes: row.roomTypes.map((rt) => rt.roomType.code),
    seasons: row._count.seasons,
    packages: row.packages.map((p) => p.package.code),
    requiresNegotiation: row.requiresNegotiation,
  }));
}

export async function getRatePlan(
  ctx: PropertyContext,
  ratePlanId: string,
): Promise<RatePlanDetail> {
  const row = await findRatePlanDetail(prisma, ctx.propertyId, ratePlanId);
  if (!row) throw notFound("Rate plan");
  const can = (p: "rates:manage") => hasPermission(ctx.access, ctx.propertyId, p);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    kind: row.kind,
    status: row.status,
    currencyCode: row.currencyCode,
    taxInclusive: row.taxInclusive,
    version: row.version,
    displayOrder: row.displayOrder,
    categoryId: row.categoryId,
    roomTransactionCode: row.roomTransactionCode,
    derivation:
      row.parent && row.derivationType && row.derivationValue
        ? {
            parentRatePlanId: row.parent.id,
            parentCode: row.parent.code,
            type: row.derivationType,
            value: toMoney(row.derivationValue)!,
            roundingIncrement: toMoney(row.roundingIncrement),
          }
        : null,
    sellFrom: row.sellFrom ? toDateOnly(row.sellFrom) : null,
    sellTo: row.sellTo ? toDateOnly(row.sellTo) : null,
    stayFrom: row.stayFrom ? toDateOnly(row.stayFrom) : null,
    stayTo: row.stayTo ? toDateOnly(row.stayTo) : null,
    cancellationPolicyId: row.cancellationPolicyId,
    depositPolicyId: row.depositPolicyId,
    defaultMarketCodeId: row.defaultMarketCodeId,
    defaultSourceCodeId: row.defaultSourceCodeId,
    roomTypeIds: row.roomTypes.map((rt) => rt.roomTypeId),
    seasons: row.seasons.map((season) => ({
      id: season.id,
      name: season.name,
      startDate: toDateOnly(season.startDate),
      endDate: toDateOnly(season.endDate),
      daysOfWeek: season.daysOfWeek,
      priority: season.priority,
      amounts: season.amounts.map((a) => ({
        roomTypeId: a.roomTypeId,
        roomTypeCode: a.roomType.code,
        oneAdult: toMoney(a.oneAdult)!,
        twoAdults: toMoney(a.twoAdults),
        threeAdults: toMoney(a.threeAdults),
        fourAdults: toMoney(a.fourAdults),
        extraAdult: toMoney(a.extraAdult),
        extraChild: toMoney(a.extraChild),
      })),
    })),
    packages: row.packages.map((p) => p.package),
    derivedPlans: row.derived,
    requiresNegotiation: row.requiresNegotiation,
    negotiated: row.negotiated.map((n) => ({
      account: n.account,
      validFrom: n.validFrom ? toDateOnly(n.validFrom) : null,
      validTo: n.validTo ? toDateOnly(n.validTo) : null,
    })),
    actions: { manage: can("rates:manage"), managePackages: can("rates:manage") },
  };
}

export async function rateAdminOptions(ctx: PropertyContext): Promise<RateAdminOptions> {
  const data = await findRateReferenceData(prisma, ctx.propertyId);
  return {
    currencyCode: ctx.currencyCode,
    minorUnits: await currencyMinorUnits(prisma, ctx.currencyCode),
    businessDate: ctx.businessDate,
    ...data,
  };
}

// --- Plans --------------------------------------------------------------------------

type PlanFields = Omit<CreateRatePlanInput, "code" | "reason">;

/** Validates references against this property and returns the columns to write. */
async function planColumns(
  tx: Tx,
  ctx: PropertyContext,
  input: PlanFields,
  planId: string | null,
): Promise<Prisma.RatePlanUncheckedUpdateManyInput> {
  const refs = await findRateReferenceData(tx, ctx.propertyId);
  const has = (list: { id: string }[], id: string | null | undefined) =>
    !id || list.some((item) => item.id === id);
  if (!has(refs.roomChargeCodes, input.roomTransactionCodeId)) {
    throw fieldError("roomTransactionCodeId", "Choose an active room revenue code");
  }
  for (const id of input.roomTypeIds) {
    if (!has(refs.roomTypes, id)) throw fieldError("roomTypeIds", "Unknown room type");
  }
  if (!has(refs.categories, input.categoryId)) throw fieldError("categoryId", "Unknown category");
  if (!has(refs.cancellationPolicies, input.cancellationPolicyId)) {
    throw fieldError("cancellationPolicyId", "Unknown cancellation policy");
  }
  if (!has(refs.depositPolicies, input.depositPolicyId)) {
    throw fieldError("depositPolicyId", "Unknown deposit policy");
  }
  if (!has(refs.marketCodes, input.defaultMarketCodeId)) {
    throw fieldError("defaultMarketCodeId", "Unknown market code");
  }
  if (!has(refs.sourceCodes, input.defaultSourceCodeId)) {
    throw fieldError("defaultSourceCodeId", "Unknown source code");
  }
  const minorUnits = await currencyMinorUnits(tx, ctx.currencyCode);
  if (input.derivation) {
    const plans = await findPlanLinks(tx, ctx.propertyId);
    const problem = derivationProblem(plans, planId, input.derivation.parentRatePlanId);
    if (problem) throw rule(problem, "INVALID_DERIVATION");
    const parent = plans.find((p) => p.id === input.derivation!.parentRatePlanId)!;
    if (parent.currencyCode !== ctx.currencyCode) {
      throw rule("The parent rate plan uses another currency", "INVALID_DERIVATION");
    }
    if (input.derivation.type === "AMOUNT")
      price(input.derivation.value.replace("-", ""), minorUnits, "derivation");
  }
  return {
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    categoryId: input.categoryId ?? null,
    // Always the property currency: a rate plan never prices in another one.
    currencyCode: ctx.currencyCode,
    taxInclusive: input.taxInclusive,
    roomTransactionCodeId: input.roomTransactionCodeId,
    parentRatePlanId: input.derivation?.parentRatePlanId ?? null,
    derivationType: input.derivation?.type ?? null,
    derivationValue: input.derivation ? formatMoney(parseMoney(input.derivation.value)) : null,
    roundingIncrement: input.derivation?.roundingIncrement
      ? price(input.derivation.roundingIncrement, 4, "roundingIncrement")
      : null,
    sellFrom: dateOrNull(input.sellFrom),
    sellTo: dateOrNull(input.sellTo),
    stayFrom: dateOrNull(input.stayFrom),
    stayTo: dateOrNull(input.stayTo),
    cancellationPolicyId: input.cancellationPolicyId ?? null,
    depositPolicyId: input.depositPolicyId ?? null,
    defaultMarketCodeId: input.defaultMarketCodeId ?? null,
    defaultSourceCodeId: input.defaultSourceCodeId ?? null,
    displayOrder: input.displayOrder,
    requiresNegotiation: input.requiresNegotiation,
  };
}

function snapshot(columns: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(columns).map(([k, v]) => [k, v instanceof Date ? toDateOnly(v) : v]),
  );
}

export async function createRatePlan(
  ctx: PropertyContext,
  input: CreateRatePlanInput,
): Promise<RatePlanDetail> {
  const id = await runInTransaction(async (tx) => {
    if (input.derivation)
      await lockRatePlanChain(tx, ctx.propertyId, input.derivation.parentRatePlanId, "update");
    const columns = await planColumns(tx, ctx, input, null);
    const existing = await tx.ratePlan.findFirst({
      where: { propertyId: ctx.propertyId, code: input.code },
      select: { id: true },
    });
    if (existing) throw fieldError("code", `Rate plan ${input.code} already exists`);
    const row = await insertRatePlan(tx, {
      ...(columns as Prisma.RatePlanUncheckedCreateInput),
      propertyId: ctx.propertyId,
      code: input.code,
    });
    await replacePlanRoomTypes(tx, ctx.propertyId, row.id, input.roomTypeIds);
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_plan.create",
        resourceType: "RatePlan",
        resourceId: row.id,
        risk: "HIGH",
        after: { code: input.code, ...snapshot(columns), roomTypeIds: input.roomTypeIds },
        reason: input.reason,
        permission: "rates:manage",
      },
    );
    return row.id;
  });
  return getRatePlan(ctx, id);
}

export async function updateRatePlan(
  ctx: PropertyContext,
  ratePlanId: string,
  input: UpdateRatePlanInput,
): Promise<RatePlanDetail> {
  await runInTransaction(async (tx) => {
    const locked = await lockRatePlanChain(tx, ctx.propertyId, ratePlanId, "update");
    const self = locked.find((row) => row.id === ratePlanId);
    if (!self) throw notFound("Rate plan");
    if (self.version !== input.version) throw staleVersion("Rate plan");
    if (input.derivation && input.derivation.parentRatePlanId !== self.parent_rate_plan_id) {
      await lockRatePlanChain(tx, ctx.propertyId, input.derivation.parentRatePlanId, "update");
    }
    const before = await findRatePlanDetail(tx, ctx.propertyId, ratePlanId);
    if (input.derivation && before!.seasons.length > 0) {
      throw rule(
        "A plan with its own seasons cannot become derived; remove its seasons first",
        "PLAN_HAS_SEASONS",
      );
    }
    if (input.status === "INACTIVE" && self.status === "ACTIVE") {
      const children = await findActiveChildCodes(tx, ctx.propertyId, ratePlanId);
      if (children.length > 0) {
        throw rule(
          `Deactivate or re-parent the plans derived from it first: ${children.map((c) => c.code).join(", ")}`,
          "PLAN_HAS_ACTIVE_CHILDREN",
        );
      }
    }
    const columns = await planColumns(tx, ctx, input, ratePlanId);
    const { count } = await updateRatePlanVersioned(tx, ratePlanId, input.version, {
      ...columns,
      status: input.status,
    });
    if (count !== 1) throw staleVersion("Rate plan");
    await replacePlanRoomTypes(tx, ctx.propertyId, ratePlanId, input.roomTypeIds);

    const beforeValues = snapshot({
      name: before!.name,
      description: before!.description,
      kind: before!.kind,
      status: before!.status,
      taxInclusive: before!.taxInclusive,
      roomTransactionCodeId: before!.roomTransactionCode.id,
      parentRatePlanId: before!.parentRatePlanId,
      derivationType: before!.derivationType,
      derivationValue: toMoney(before!.derivationValue),
      sellFrom: before!.sellFrom,
      sellTo: before!.sellTo,
      stayFrom: before!.stayFrom,
      stayTo: before!.stayTo,
      cancellationPolicyId: before!.cancellationPolicyId,
      roomTypeIds: before!.roomTypes
        .map((rt) => rt.roomTypeId)
        .sort()
        .join(","),
    });
    const afterValues = snapshot({
      ...columns,
      status: input.status,
      roomTypeIds: [...input.roomTypeIds].sort().join(","),
    });
    const changed = Object.keys(beforeValues).filter(
      (k) => String(beforeValues[k] ?? "") !== String(afterValues[k] ?? ""),
    );
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_plan.update",
        resourceType: "RatePlan",
        resourceId: ratePlanId,
        risk: "HIGH",
        before: Object.fromEntries(changed.map((k) => [k, beforeValues[k]])),
        after: Object.fromEntries(changed.map((k) => [k, afterValues[k]])),
        reason: input.reason,
        permission: "rates:manage",
      },
    );
  });
  return getRatePlan(ctx, ratePlanId);
}

// --- Seasons -------------------------------------------------------------------------

async function lockPlanForSeasons(
  tx: Tx,
  ctx: PropertyContext,
  ratePlanId: string,
  version: number,
) {
  const locked = await lockRatePlanChain(tx, ctx.propertyId, ratePlanId, "update");
  const self = locked.find((row) => row.id === ratePlanId);
  if (!self) throw notFound("Rate plan");
  if (self.version !== version) throw staleVersion("Rate plan");
  if (self.parent_rate_plan_id) {
    throw rule(
      "A derived plan takes its prices from its parent and has no seasons",
      "PLAN_IS_DERIVED",
    );
  }
  const { count } = await updateRatePlanVersioned(tx, ratePlanId, version, {});
  if (count !== 1) throw staleVersion("Rate plan");
}

async function seasonAmounts(tx: Tx, ctx: PropertyContext, ratePlanId: string, input: SeasonInput) {
  const minorUnits = await currencyMinorUnits(tx, ctx.currencyCode);
  const plan = await findRatePlanDetail(tx, ctx.propertyId, ratePlanId);
  const planTypes = new Set(plan!.roomTypes.map((rt) => rt.roomTypeId));
  return input.amounts.map((amount, index) => {
    if (!planTypes.has(amount.roomTypeId)) {
      throw fieldError(`amounts.${index}.roomTypeId`, "The plan is not sold for this room type");
    }
    const at = (key: keyof typeof amount) =>
      price(amount[key] as string | null | undefined, minorUnits, `amounts.${index}.${key}`);
    return {
      roomTypeId: amount.roomTypeId,
      oneAdult: at("oneAdult")!,
      twoAdults: at("twoAdults"),
      threeAdults: at("threeAdults"),
      fourAdults: at("fourAdults"),
      extraAdult: at("extraAdult"),
      extraChild: at("extraChild"),
    };
  });
}

async function assertNoConflict(
  tx: Tx,
  ratePlanId: string,
  input: SeasonInput,
  seasonId: string | null,
) {
  const others = (await findSeasons(tx, ratePlanId)).filter((s) => s.id !== seasonId);
  const candidate = {
    startDate: input.startDate,
    endDate: input.endDate,
    daysOfWeek: input.daysOfWeek,
    priority: input.priority,
  };
  const clash = others.find((s) =>
    seasonsConflict(candidate, {
      startDate: toDateOnly(s.startDate),
      endDate: toDateOnly(s.endDate),
      daysOfWeek: s.daysOfWeek,
      priority: s.priority,
    }),
  );
  if (clash) {
    throw rule(
      `Season "${clash.name}" has the same priority on overlapping days; give one of them a higher priority`,
      "SEASON_CONFLICT",
      { seasonId: clash.id },
    );
  }
}

export async function createSeason(
  ctx: PropertyContext,
  ratePlanId: string,
  input: SeasonInput,
): Promise<RatePlanDetail> {
  await runInTransaction(async (tx) => {
    await lockPlanForSeasons(tx, ctx, ratePlanId, input.version);
    await assertNoConflict(tx, ratePlanId, input, null);
    const amounts = await seasonAmounts(tx, ctx, ratePlanId, input);
    const season = await insertSeason(tx, {
      propertyId: ctx.propertyId,
      ratePlanId,
      name: input.name,
      startDate: fromDateOnly(input.startDate),
      endDate: fromDateOnly(input.endDate),
      daysOfWeek: input.daysOfWeek,
      priority: input.priority,
    });
    await replaceSeasonAmounts(tx, ctx.propertyId, season.id, amounts);
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_season.create",
        resourceType: "RatePlan",
        resourceId: ratePlanId,
        risk: "HIGH",
        after: {
          seasonId: season.id,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          daysOfWeek: input.daysOfWeek,
          priority: input.priority,
          amounts,
        },
        reason: input.reason,
        permission: "rates:manage",
      },
    );
  });
  return getRatePlan(ctx, ratePlanId);
}

export async function updateSeasonPrices(
  ctx: PropertyContext,
  ratePlanId: string,
  seasonId: string,
  input: SeasonInput,
): Promise<RatePlanDetail> {
  await runInTransaction(async (tx) => {
    await lockPlanForSeasons(tx, ctx, ratePlanId, input.version);
    const current = (await findSeasons(tx, ratePlanId)).find((s) => s.id === seasonId);
    if (!current) throw notFound("Season");
    await assertNoConflict(tx, ratePlanId, input, seasonId);
    const amounts = await seasonAmounts(tx, ctx, ratePlanId, input);
    const beforeAmounts = (await findSeasonAmounts(tx, seasonId)).map((a) => ({
      roomTypeId: a.roomTypeId,
      oneAdult: toMoney(a.oneAdult),
      twoAdults: toMoney(a.twoAdults),
    }));
    await updateSeason(tx, seasonId, {
      name: input.name,
      startDate: fromDateOnly(input.startDate),
      endDate: fromDateOnly(input.endDate),
      daysOfWeek: input.daysOfWeek,
      priority: input.priority,
    });
    await replaceSeasonAmounts(tx, ctx.propertyId, seasonId, amounts);
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_season.update",
        resourceType: "RatePlan",
        resourceId: ratePlanId,
        risk: "HIGH",
        before: {
          seasonId,
          name: current.name,
          startDate: toDateOnly(current.startDate),
          endDate: toDateOnly(current.endDate),
          daysOfWeek: current.daysOfWeek,
          priority: current.priority,
          amounts: beforeAmounts,
        },
        after: {
          seasonId,
          name: input.name,
          startDate: input.startDate,
          endDate: input.endDate,
          daysOfWeek: input.daysOfWeek,
          priority: input.priority,
          amounts,
        },
        reason: input.reason,
        permission: "rates:manage",
      },
    );
  });
  return getRatePlan(ctx, ratePlanId);
}

export async function removeSeason(
  ctx: PropertyContext,
  ratePlanId: string,
  seasonId: string,
  input: { version: number; reason: string },
): Promise<RatePlanDetail> {
  await runInTransaction(async (tx) => {
    await lockPlanForSeasons(tx, ctx, ratePlanId, input.version);
    const current = (await findSeasons(tx, ratePlanId)).find((s) => s.id === seasonId);
    if (!current) throw notFound("Season");
    await deleteSeason(tx, seasonId);
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_season.delete",
        resourceType: "RatePlan",
        resourceId: ratePlanId,
        risk: "HIGH",
        before: {
          seasonId,
          name: current.name,
          startDate: toDateOnly(current.startDate),
          endDate: toDateOnly(current.endDate),
        },
        reason: input.reason,
        permission: "rates:manage",
      },
    );
  });
  return getRatePlan(ctx, ratePlanId);
}

// --- Packages on a plan -------------------------------------------------------------------

export async function setRatePlanPackages(
  ctx: PropertyContext,
  ratePlanId: string,
  input: RatePlanPackagesInput,
): Promise<RatePlanDetail> {
  await runInTransaction(async (tx) => {
    const locked = await lockRatePlanChain(tx, ctx.propertyId, ratePlanId, "update");
    const self = locked.find((row) => row.id === ratePlanId);
    if (!self) throw notFound("Rate plan");
    if (self.version !== input.version) throw staleVersion("Rate plan");
    const ids = [...new Set(input.packageIds)];
    const packages = await findActivePackages(tx, ctx.propertyId, ids);
    if (packages.length !== ids.length) throw fieldError("packageIds", "Choose active packages");
    const before = (await findRatePlanDetail(tx, ctx.propertyId, ratePlanId))!.packages.map(
      (p) => p.package.code,
    );
    const { count } = await updateRatePlanVersioned(tx, ratePlanId, input.version, {});
    if (count !== 1) throw staleVersion("Rate plan");
    await replacePlanPackages(tx, ctx.propertyId, ratePlanId, ids);
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_plan.packages",
        resourceType: "RatePlan",
        resourceId: ratePlanId,
        risk: "HIGH",
        before: { packages: before },
        after: { packages: packages.map((p) => p.code) },
        reason: input.reason,
        permission: "rates:manage",
      },
    );
  });
  return getRatePlan(ctx, ratePlanId);
}

/**
 * Sets the companies a negotiated plan is sold to (Phase 7). Only active
 * companies of the organization; the plan must be marked requiresNegotiation
 * so it never appears in public quotes.
 */
export async function setRatePlanAccounts(
  ctx: PropertyContext,
  ratePlanId: string,
  input: RatePlanAccountsInput,
): Promise<RatePlanDetail> {
  const ids = input.accounts.map((a) => a.accountProfileId);
  if (new Set(ids).size !== ids.length) throw fieldError("accounts", "Each company once");
  await runInTransaction(async (tx) => {
    const locked = await lockRatePlanChain(tx, ctx.propertyId, ratePlanId, "update");
    const self = locked.find((row) => row.id === ratePlanId);
    if (!self) throw notFound("Rate plan");
    if (self.version !== input.version) throw staleVersion("Rate plan");
    const before = (await findRatePlanDetail(tx, ctx.propertyId, ratePlanId))!;
    if (!before.requiresNegotiation && input.accounts.length > 0) {
      throw rule("Mark the plan as negotiated before linking companies", "PLAN_NOT_NEGOTIATED");
    }
    const companies = await findCompanies(tx, ctx.organizationId, ids);
    if (companies.length !== ids.length) throw fieldError("accounts", "Choose active companies");
    const { count } = await updateRatePlanVersioned(tx, ratePlanId, input.version, {});
    if (count !== 1) throw staleVersion("Rate plan");
    await replacePlanAccounts(
      tx,
      ctx.propertyId,
      ratePlanId,
      input.accounts.map((a) => ({
        accountProfileId: a.accountProfileId,
        validFrom: a.validFrom ? fromDateOnly(a.validFrom) : null,
        validTo: a.validTo ? fromDateOnly(a.validTo) : null,
      })),
    );
    const code = new Map(companies.map((c) => [c.id, c.code ?? c.name]));
    const describe = (id: string, from: string | null, to: string | null) =>
      `${code.get(id) ?? id}${from || to ? ` ${from ?? "…"}..${to ?? "…"}` : ""}`;
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "rate_plan.accounts",
        resourceType: "RatePlan",
        resourceId: ratePlanId,
        risk: "HIGH",
        before: {
          accounts: before.negotiated.map(
            (n) =>
              `${n.account.code ?? n.account.name}${n.validFrom || n.validTo ? ` ${n.validFrom ? toDateOnly(n.validFrom) : "…"}..${n.validTo ? toDateOnly(n.validTo) : "…"}` : ""}`,
          ),
        },
        after: {
          accounts: input.accounts.map((a) => describe(a.accountProfileId, a.validFrom, a.validTo)),
        },
        reason: input.reason,
        permission: "rates:manage",
      },
    );
  });
  return getRatePlan(ctx, ratePlanId);
}

// --- Calendar ------------------------------------------------------------------------------

function restrictionScope(
  row: RestrictionRow,
): RateCalendarView["days"][number]["restrictions"][number]["scope"] {
  if (row.roomTypeId && row.ratePlanId) return "ROOM_TYPE_AND_RATE_PLAN";
  if (row.roomTypeId) return "ROOM_TYPE";
  if (row.ratePlanId) return "RATE_PLAN";
  return "HOUSE";
}

/**
 * Nightly prices (1 and 2 adults) and the restrictions that apply to a plan
 * and room type, day by day — computed with the booking engine's own
 * functions (priceNights, selectSeason, restrictionViolations' scoping).
 */
export async function rateCalendar(
  ctx: PropertyContext,
  query: CalendarQuery,
): Promise<RateCalendarView> {
  const plan = await findRatePlanDetail(prisma, ctx.propertyId, query.ratePlanId);
  if (!plan) throw notFound("Rate plan");
  const roomType = await prisma.roomType.findFirst({
    where: { id: query.roomTypeId, propertyId: ctx.propertyId },
    select: { id: true, code: true, name: true },
  });
  if (!roomType) throw notFound("Room type");
  const dates = stayNights(query.from, addDays(query.to, 1));
  const chain = await findPlanChainIds(prisma, ctx.propertyId, plan.id);
  const rows = await findRatePlansForStay(prisma, ctx.propertyId, query.from, query.to, {
    id: { in: chain },
  });
  const pricing = new Map(rows.map((row) => [row.id, toPricing(row)]));
  const minorUnits = await currencyMinorUnits(prisma, ctx.currencyCode);
  const self = pricing.get(plan.id)!;
  const one = priceNights(self, pricing, roomType.id, dates, 1, 0, minorUnits);
  const two = priceNights(self, pricing, roomType.id, dates, 2, 0, minorUnits);
  // Seasons belong to the base plan at the top of the derivation chain.
  let base = self;
  while (base.parentRatePlanId && pricing.get(base.parentRatePlanId)) {
    base = pricing.get(base.parentRatePlanId)!;
  }
  const seasonNames = new Map(
    rows.flatMap((row) => row.seasons.map((season) => [season.id, season.name] as const)),
  );
  const restrictions = await loadRestrictions(
    prisma,
    ctx.propertyId,
    query.from,
    addDays(query.to, 1),
  );
  const amount = (night: { amount: bigint | null }) =>
    night.amount === null ? null : formatMoney(night.amount, minorUnits);
  return {
    ratePlan: {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      status: plan.status,
      derived: plan.parentRatePlanId !== null,
    },
    roomType,
    currencyCode: ctx.currencyCode,
    minorUnits,
    days: dates.map((date, index) => {
      const season = selectSeason(base.seasons, date);
      return {
        date,
        seasonName: season ? (seasonNames.get(season.id) ?? null) : null,
        oneAdult: amount(one[index]!),
        twoAdults: amount(two[index]!),
        // The same scoping as restrictionViolations: house rows and rows for
        // this room type and/or this plan apply.
        restrictions: restrictions
          .filter(
            (r) =>
              r.stayDate === date &&
              (r.roomTypeId === null || r.roomTypeId === roomType.id) &&
              (r.ratePlanId === null || r.ratePlanId === plan.id),
          )
          .map((r) => ({ type: r.type, value: r.value, scope: restrictionScope(r) })),
      };
    }),
  };
}
