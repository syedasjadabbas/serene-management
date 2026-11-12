import { z } from "zod";
import type { RatePlanDetail, SeasonView } from "@serene/shared/modules/rates/rates.types";

const REASON_MESSAGE = "Enter a reason of at least 3 characters";

function reasonIssue(ctx: z.RefinementCtx, reason: string) {
  if (reason.trim().length < 3) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: REASON_MESSAGE });
  }
}

/** Just an audit reason (delete a season). */
export const reasonOnlyFormSchema = z
  .object({ reason: z.string() })
  .superRefine((v, ctx) => reasonIssue(ctx, v.reason));

export type ReasonOnlyValues = z.input<typeof reasonOnlyFormSchema>;

// --- Season ----------------------------------------------------------------------------

const priceSchema = z.object({ one: z.string(), two: z.string() });

/**
 * Season form. `roomTypeIds` are the plan's room types that have a price
 * row; at least one must be priced (a one-adult amount).
 */
export function seasonFormSchema(roomTypeIds: readonly string[]) {
  return z
    .object({
      name: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      daysOfWeek: z.number(),
      priority: z.string(),
      prices: z.record(z.string(), priceSchema),
      reason: z.string(),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (!v.name.trim()) add("name", "Enter a name");
      if (!v.startDate) add("startDate", "Select the first night");
      if (!v.endDate) add("endDate", "Select the last night");
      if (seasonAmounts(v.prices, roomTypeIds).length === 0)
        add("prices", "Enter a price for at least one room type");
      reasonIssue(ctx, v.reason);
    });
}

export type SeasonFormValues = z.input<ReturnType<typeof seasonFormSchema>>;

export function seasonDefaults(
  season: SeasonView | undefined,
  businessDate: string,
): SeasonFormValues {
  return {
    name: season?.name ?? "",
    startDate: season?.startDate ?? businessDate,
    endDate: season?.endDate ?? "",
    daysOfWeek: season?.daysOfWeek ?? 127,
    priority: String(season?.priority ?? 0),
    prices: Object.fromEntries(
      (season?.amounts ?? []).map((a) => [
        a.roomTypeId,
        { one: a.oneAdult, two: a.twoAdults ?? "" },
      ]),
    ),
    reason: "",
  };
}

/** Room types with a one-adult price become amounts; blank two-adult prices are null. */
export function seasonAmounts(prices: SeasonFormValues["prices"], roomTypeIds: readonly string[]) {
  return roomTypeIds
    .filter((id) => prices[id]?.one)
    .map((id) => ({
      roomTypeId: id,
      oneAdult: prices[id]!.one,
      twoAdults: prices[id]!.two || null,
    }));
}

export function seasonBody(
  v: SeasonFormValues,
  roomTypeIds: readonly string[],
  planVersion: RatePlanDetail["version"],
) {
  return {
    version: planVersion,
    name: v.name.trim(),
    startDate: v.startDate,
    endDate: v.endDate,
    daysOfWeek: v.daysOfWeek,
    priority: Number.parseInt(v.priority, 10) || 0,
    amounts: seasonAmounts(v.prices, roomTypeIds),
    reason: v.reason.trim(),
  };
}

// --- Packages in a plan ----------------------------------------------------------------

export const planPackagesFormSchema = z
  .object({ packageIds: z.array(z.string()), reason: z.string() })
  .superRefine((v, ctx) => reasonIssue(ctx, v.reason));

export type PlanPackagesValues = z.input<typeof planPackagesFormSchema>;

// --- Companies on a negotiated plan ----------------------------------------------------

export const planAccountsFormSchema = z
  .object({
    rows: z.array(
      z.object({
        company: z.object({ id: z.string(), label: z.string() }),
        validFrom: z.string(),
        validTo: z.string(),
      }),
    ),
    reason: z.string(),
  })
  .superRefine((v, ctx) => reasonIssue(ctx, v.reason));

export type PlanAccountsValues = z.input<typeof planAccountsFormSchema>;

export function planAccountsDefaults(plan: RatePlanDetail): PlanAccountsValues {
  return {
    rows: plan.negotiated.map((n) => ({
      company: { id: n.account.id, label: n.account.name },
      validFrom: n.validFrom ?? "",
      validTo: n.validTo ?? "",
    })),
    reason: "",
  };
}

export function planAccountsBody(v: PlanAccountsValues, version: RatePlanDetail["version"]) {
  return {
    version,
    accounts: v.rows.map((r) => ({
      accountProfileId: r.company.id,
      validFrom: r.validFrom || null,
      validTo: r.validTo || null,
    })),
    reason: v.reason.trim(),
  };
}
