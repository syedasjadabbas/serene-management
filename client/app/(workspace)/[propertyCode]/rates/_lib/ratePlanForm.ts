import { z } from "zod";
import type { RATE_PLAN_KINDS } from "@serene/shared/modules/rates/rates.schema";
import type { RatePlanDetail } from "@serene/shared/modules/rates/rates.types";

/**
 * Rate plan create/edit form. `isEdit` drops the code requirement (the code
 * is fixed once created). The audit reason needs at least 3 characters.
 */
export function ratePlanFormSchema(isEdit: boolean) {
  return z
    .object({
      code: z.string(),
      name: z.string(),
      kind: z.string(),
      description: z.string(),
      taxInclusive: z.boolean(),
      negotiatedOnly: z.boolean(),
      roomTransactionCodeId: z.string(),
      derived: z.boolean(),
      parentId: z.string(),
      derivationType: z.enum(["PERCENT", "AMOUNT"]),
      derivationValue: z.string(),
      rounding: z.string(),
      roomTypeIds: z.array(z.string()),
      cancellationPolicyId: z.string(),
      marketId: z.string(),
      sourceId: z.string(),
      stayFrom: z.string(),
      stayTo: z.string(),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      reason: z.string(),
    })
    .superRefine((v, ctx) => {
      const add = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (v.name.trim().length === 0) add("name", "Enter a name");
      if (!isEdit && v.code.trim().length === 0) add("code", "Enter a code");
      if (!v.roomTransactionCodeId) add("roomTransactionCodeId", "Select the room revenue code");
      if (v.roomTypeIds.length === 0) add("roomTypeIds", "Select at least one room type");
      if (v.derived && !v.parentId) add("parentId", "Select the parent plan");
      if (v.reason.trim().length < 3) add("reason", "Enter a reason of at least 3 characters");
    });
}

export type RatePlanFormValues = z.input<ReturnType<typeof ratePlanFormSchema>>;

export function ratePlanDefaults(plan?: RatePlanDetail): RatePlanFormValues {
  return {
    code: "",
    name: plan?.name ?? "",
    kind: plan?.kind ?? "CORPORATE",
    description: plan?.description ?? "",
    taxInclusive: plan?.taxInclusive ?? false,
    negotiatedOnly: plan?.requiresNegotiation ?? false,
    roomTransactionCodeId: plan?.roomTransactionCode.id ?? "",
    derived: plan ? plan.derivation !== null : true,
    parentId: plan?.derivation?.parentRatePlanId ?? "",
    derivationType: plan?.derivation?.type ?? "PERCENT",
    derivationValue: plan?.derivation?.value ?? "-10",
    rounding: plan?.derivation?.roundingIncrement ?? "1",
    roomTypeIds: plan?.roomTypeIds ?? [],
    cancellationPolicyId: plan?.cancellationPolicyId ?? "",
    marketId: plan?.defaultMarketCodeId ?? "",
    sourceId: plan?.defaultSourceCodeId ?? "",
    stayFrom: plan?.stayFrom ?? "",
    stayTo: plan?.stayTo ?? "",
    status: plan?.status ?? "ACTIVE",
    reason: "",
  };
}

/** The request fields shared by create and update. */
export function ratePlanPayloadFields(v: RatePlanFormValues, displayOrder: number | undefined) {
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    kind: v.kind as (typeof RATE_PLAN_KINDS)[number],
    taxInclusive: v.taxInclusive,
    // A NEGOTIATED plan is always sold only to its companies (server-enforced too).
    requiresNegotiation: v.negotiatedOnly || v.kind === "NEGOTIATED",
    roomTransactionCodeId: v.roomTransactionCodeId,
    derivation: v.derived
      ? {
          parentRatePlanId: v.parentId,
          type: v.derivationType,
          value: v.derivationValue.trim(),
          roundingIncrement: v.rounding.trim() || null,
        }
      : null,
    stayFrom: v.stayFrom || null,
    stayTo: v.stayTo || null,
    cancellationPolicyId: v.cancellationPolicyId || null,
    defaultMarketCodeId: v.marketId || null,
    defaultSourceCodeId: v.sourceId || null,
    displayOrder: displayOrder ?? 10,
    roomTypeIds: v.roomTypeIds,
    reason: v.reason.trim(),
  };
}
