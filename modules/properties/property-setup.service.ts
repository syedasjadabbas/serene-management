import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type SessionContext } from "@/lib/http/context";
import { AppError } from "@/lib/http/errors";
import { canAccessProperty, hasPermission } from "@/lib/permissions/evaluate";
import { recordAudit } from "@/modules/audit/audit.service";
import { hasBusinessDateHistory } from "@/modules/business-date/business-date.service";
import {
  findSetupProperty,
  lockTargetProperty,
  readSourceSetup,
  readTargetCodes,
} from "./property-setup.repository";
import type { PropertySetupCopyResult, PropertySetupSection } from "./properties.types";

/**
 * Copies a property's reference setup into a new property (D37): charge and
 * payment codes, taxes, reason/market/source/channel codes, housekeeping task
 * types, block statuses, reservation types and cancellation/deposit
 * policies. Never rooms, room types, rate plans, seasons, reservations,
 * folios, payments, business dates or history.
 *
 * - Idempotent by code: a code the target already has is left untouched.
 * - Allowed only before the target's go-live (no business date yet).
 * - No currency conversion (D4): when the currencies differ, amounts in the
 *   source currency (code default/min/max prices, flat taxes and flat
 *   policies) are not copied and are listed for review instead.
 */
export async function copyPropertySetup(
  ctx: SessionContext,
  targetPropertyId: string,
  sourcePropertyId: string,
  input: { reason: string; reasonCodeId?: string | null },
): Promise<PropertySetupCopyResult> {
  if (!hasPermission(ctx.access, targetPropertyId, "properties:manage")) {
    throw new AppError("FORBIDDEN", "You do not have access to this property");
  }
  // An inaccessible source is indistinguishable from a missing one.
  if (!canAccessProperty(ctx.access, sourcePropertyId)) {
    throw new AppError("FORBIDDEN", "You do not have access to the source property");
  }
  if (sourcePropertyId === targetPropertyId) {
    throw new AppError("VALIDATION_FAILED", "Choose another property to copy from", {
      fields: { sourceId: ["The source must be a different property"] },
    });
  }

  return runInTransaction(async (tx) => {
    if (!(await lockTargetProperty(tx, ctx.organizationId, targetPropertyId))) {
      throw new AppError("FORBIDDEN", "You do not have access to this property");
    }
    const [target, source] = await Promise.all([
      findSetupProperty(tx, ctx.organizationId, targetPropertyId),
      findSetupProperty(tx, ctx.organizationId, sourcePropertyId),
    ]);
    if (!target) throw new AppError("FORBIDDEN", "You do not have access to this property");
    if (!source) throw new AppError("FORBIDDEN", "You do not have access to the source property");
    if (await hasBusinessDateHistory(tx, target.id)) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "Setup can be copied only before the property goes live",
        { reason: "PROPERTY_LIVE" },
      );
    }

    const sections = await copySetup(tx, source, target);
    const result: PropertySetupCopyResult = {
      sourceProperty: { id: source.id, code: source.code, currencyCode: source.currencyCode },
      targetProperty: { id: target.id, code: target.code, currencyCode: target.currencyCode },
      sections,
      copied: sections.reduce((n, s) => n + s.copied, 0),
      skipped: sections.reduce((n, s) => n + s.skipped, 0),
    };

    await recordAudit(
      tx,
      { ...auditActor(ctx), propertyId: target.id },
      {
        action: "property.setup_copy",
        resourceType: "Property",
        resourceId: target.id,
        risk: "HIGH",
        after: {
          sourcePropertyId: source.id,
          sourcePropertyCode: source.code,
          copied: Object.fromEntries(sections.map((s) => [s.key, s.copied])),
          skipped: Object.fromEntries(sections.map((s) => [s.key, s.skipped])),
          needsReview: sections.flatMap((s) => s.needsReview.map((code) => `${s.key}:${code}`)),
        },
        reason: input.reason,
        reasonCodeId: input.reasonCodeId ?? null,
        permission: "properties:manage",
      },
    );
    return result;
  });
}

type SetupProperty = { id: string; code: string; currencyCode: string };

async function copySetup(
  tx: Tx,
  source: SetupProperty,
  target: SetupProperty,
): Promise<PropertySetupSection[]> {
  const propertyId = target.id;
  const sameCurrency = source.currencyCode === target.currencyCode;
  const from = await readSourceSetup(tx, source.id);
  const existing = await readTargetCodes(tx, propertyId);
  const sections: PropertySetupSection[] = [];
  const section = (key: string, label: string) => {
    const s: PropertySetupSection = { key, label, copied: 0, skipped: 0, needsReview: [] };
    sections.push(s);
    return s;
  };

  // Transaction code groups (parents linked after all exist) -------------------------------
  const groupIds = new Map(existing.groups.map((g) => [g.code, g.id]));
  const groupSection = section("transactionCodeGroups", "Transaction code groups");
  const newGroups: string[] = [];
  for (const g of from.groups) {
    if (groupIds.has(g.code)) {
      groupSection.skipped++;
      continue;
    }
    const row = await tx.transactionCodeGroup.create({
      data: { propertyId, code: g.code, name: g.name, type: g.type, sortOrder: g.sortOrder },
      select: { id: true },
    });
    groupIds.set(g.code, row.id);
    newGroups.push(g.code);
    groupSection.copied++;
  }
  const sourceGroupCode = new Map(from.groups.map((g) => [g.id, g.code]));
  for (const g of from.groups) {
    if (!newGroups.includes(g.code) || !g.parentId) continue;
    const parentId = groupIds.get(sourceGroupCode.get(g.parentId) ?? "");
    if (parentId) {
      await tx.transactionCodeGroup.update({
        where: { id: groupIds.get(g.code)! },
        data: { parentId },
      });
    }
  }

  // Transaction codes (adjustment codes linked after all exist) ----------------------------
  const codeIds = new Map(existing.codes.map((c) => [c.code, c.id]));
  const codeBuckets = new Map(existing.codes.map((c) => [c.code, c.bucket]));
  const codeSection = section("transactionCodes", "Transaction codes");
  const sourceCode = new Map(from.codes.map((c) => [c.id, c]));
  const newCodes: string[] = [];
  for (const c of from.codes) {
    const groupId = groupIds.get(sourceGroupCode.get(c.groupId) ?? "");
    if (codeIds.has(c.code) || !groupId) {
      codeSection.skipped++;
      continue;
    }
    const hasAmounts = c.defaultPrice !== null || c.minAmount !== null || c.maxAmount !== null;
    const row = await tx.transactionCode.create({
      data: {
        propertyId,
        groupId,
        code: c.code,
        name: c.name,
        bucket: c.bucket,
        isManualPostAllowed: c.isManualPostAllowed,
        isPaidOut: c.isPaidOut,
        isTaxInclusive: c.isTaxInclusive,
        includeInDepositRule: c.includeInDepositRule,
        includeInCancellationRule: c.includeInCancellationRule,
        defaultPrice: sameCurrency ? c.defaultPrice : null,
        minAmount: sameCurrency ? c.minAmount : null,
        maxAmount: sameCurrency ? c.maxAmount : null,
        glAccount: c.glAccount,
      },
      select: { id: true },
    });
    codeIds.set(c.code, row.id);
    codeBuckets.set(c.code, c.bucket);
    newCodes.push(c.code);
    codeSection.copied++;
    if (hasAmounts && !sameCurrency) codeSection.needsReview.push(c.code);
  }
  for (const c of from.codes) {
    if (!newCodes.includes(c.code) || !c.adjustmentCodeId) continue;
    const adjustmentCodeId = codeIds.get(sourceCode.get(c.adjustmentCodeId)?.code ?? "");
    if (adjustmentCodeId) {
      await tx.transactionCode.update({
        where: { id: codeIds.get(c.code)! },
        data: { adjustmentCodeId },
      });
    }
  }
  const targetCodeOf = (sourceId: string) => {
    const c = sourceCode.get(sourceId);
    if (!c) return null;
    const id = codeIds.get(c.code);
    // A target code with the same number but another bucket is a different code.
    return id && codeBuckets.get(c.code) === c.bucket ? id : null;
  };

  // Tax rules and their links --------------------------------------------------------------
  const taxIds = new Map(existing.taxRules.map((t) => [t.code, t.id]));
  const taxSection = section("taxRules", "Tax rules");
  const sourceTaxCode = new Map(from.taxRules.map((t) => [t.id, t.code]));
  for (const t of from.taxRules) {
    if (taxIds.has(t.code)) {
      taxSection.skipped++;
      continue;
    }
    const transactionCodeId = targetCodeOf(t.transactionCodeId);
    if (!transactionCodeId || (t.calculation === "FLAT_PER_UNIT" && !sameCurrency)) {
      taxSection.skipped++;
      taxSection.needsReview.push(t.code);
      continue;
    }
    const row = await tx.taxRule.create({
      data: {
        propertyId,
        code: t.code,
        name: t.name,
        calculation: t.calculation,
        basis: t.basis,
        rate: t.rate,
        transactionCodeId,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
      },
      select: { id: true },
    });
    taxIds.set(t.code, row.id);
    taxSection.copied++;
  }
  const linkSection = section("taxLinks", "Tax links");
  const links = new Set(existing.taxLinks.map((l) => `${l.transactionCodeId}:${l.taxRuleId}`));
  const newLinks: Prisma.TransactionCodeTaxCreateManyInput[] = [];
  for (const l of from.taxLinks) {
    const transactionCodeId = targetCodeOf(l.transactionCodeId);
    const taxRuleId = taxIds.get(sourceTaxCode.get(l.taxRuleId) ?? "");
    if (!transactionCodeId || !taxRuleId || links.has(`${transactionCodeId}:${taxRuleId}`)) {
      linkSection.skipped++;
      continue;
    }
    links.add(`${transactionCodeId}:${taxRuleId}`);
    newLinks.push({ propertyId, transactionCodeId, taxRuleId, sequence: l.sequence });
  }
  if (newLinks.length > 0) await tx.transactionCodeTax.createMany({ data: newLinks });
  linkSection.copied = newLinks.length;

  // Simple code tables ---------------------------------------------------------------------
  const copyByKey = async <S, K extends string>(
    key: string,
    label: string,
    rows: S[],
    existingKeys: Iterable<K>,
    keyOf: (row: S) => K,
    create: (rows: S[]) => Promise<unknown>,
  ) => {
    const s = section(key, label);
    const have = new Set<string>(existingKeys);
    const missing = rows.filter((r) => !have.has(keyOf(r)));
    s.skipped = rows.length - missing.length;
    if (missing.length > 0) await create(missing);
    s.copied = missing.length;
    return s;
  };

  await copyByKey(
    "reasonCodes",
    "Reason codes",
    from.reasonCodes,
    existing.reasonCodes.map((r) => `${r.category}:${r.code}`),
    (r) => `${r.category}:${r.code}`,
    (rows) => tx.reasonCode.createMany({ data: rows.map((r) => ({ ...r, propertyId })) }),
  );

  await copyByKey(
    "marketGroups",
    "Market groups",
    from.marketGroups,
    existing.marketGroups.map((g) => g.code),
    (g) => g.code,
    (rows) =>
      tx.marketGroup.createMany({
        data: rows.map((g) => ({ propertyId, code: g.code, name: g.name })),
      }),
  );
  const marketGroupIds = new Map(
    (
      await tx.marketGroup.findMany({ where: { propertyId }, select: { id: true, code: true } })
    ).map((g) => [g.code, g.id]),
  );
  const sourceMarketGroup = new Map(from.marketGroups.map((g) => [g.id, g.code]));
  await copyByKey(
    "marketCodes",
    "Market codes",
    from.marketCodes,
    existing.marketCodes.map((m) => m.code),
    (m) => m.code,
    (rows) =>
      tx.marketCode.createMany({
        data: rows.map((m) => ({
          propertyId,
          code: m.code,
          name: m.name,
          marketGroupId: m.marketGroupId
            ? (marketGroupIds.get(sourceMarketGroup.get(m.marketGroupId) ?? "") ?? null)
            : null,
        })),
      }),
  );
  await copyByKey(
    "sourceCodes",
    "Source codes",
    from.sourceCodes,
    existing.sourceCodes.map((s) => s.code),
    (s) => s.code,
    (rows) => tx.sourceCode.createMany({ data: rows.map((s) => ({ ...s, propertyId })) }),
  );
  await copyByKey(
    "channels",
    "Channels",
    from.channels,
    existing.channels.map((c) => c.code),
    (c) => c.code,
    (rows) => tx.channel.createMany({ data: rows.map((c) => ({ ...c, propertyId })) }),
  );

  // Payment methods need their (copied) payment transaction code.
  const paymentSection = section("paymentMethods", "Payment methods");
  const paymentCodes = new Set(existing.paymentMethods.map((p) => p.code));
  for (const p of from.paymentMethods) {
    if (paymentCodes.has(p.code)) {
      paymentSection.skipped++;
      continue;
    }
    const transactionCodeId = targetCodeOf(p.transactionCodeId);
    if (!transactionCodeId) {
      paymentSection.skipped++;
      paymentSection.needsReview.push(p.code);
      continue;
    }
    await tx.paymentMethod.create({
      data: {
        propertyId,
        code: p.code,
        name: p.name,
        kind: p.kind,
        transactionCodeId,
        requiresReference: p.requiresReference,
      },
    });
    paymentSection.copied++;
  }

  await copyByKey(
    "housekeepingTaskTypes",
    "Housekeeping task types",
    from.taskTypes,
    existing.taskTypes.map((t) => t.code),
    (t) => t.code,
    (rows) => tx.housekeepingTaskType.createMany({ data: rows.map((t) => ({ ...t, propertyId })) }),
  );
  // One default block status: a copied default does not replace the target's own.
  const targetHasDefault = existing.blockStatuses.some((b) => b.isDefault);
  await copyByKey(
    "blockStatuses",
    "Block statuses",
    from.blockStatuses,
    existing.blockStatuses.map((b) => b.code),
    (b) => b.code,
    (rows) =>
      tx.blockStatus.createMany({
        data: rows.map((b) => ({ ...b, isDefault: b.isDefault && !targetHasDefault, propertyId })),
      }),
  );
  await copyByKey(
    "reservationTypes",
    "Reservation types",
    from.reservationTypes,
    existing.reservationTypes.map((r) => r.code),
    (r) => r.code,
    (rows) => tx.reservationType.createMany({ data: rows.map((r) => ({ ...r, propertyId })) }),
  );

  // Policies: flat amounts are in the source currency (no FX, D4).
  const flatCancellation = sameCurrency
    ? []
    : from.cancellationPolicies.filter((p) => p.penaltyType === "FLAT").map((p) => p.code);
  const cancellation = await copyByKey(
    "cancellationPolicies",
    "Cancellation policies",
    from.cancellationPolicies.filter((p) => !flatCancellation.includes(p.code)),
    existing.cancellationPolicies.map((p) => p.code),
    (p) => p.code,
    (rows) => tx.cancellationPolicy.createMany({ data: rows.map((p) => ({ ...p, propertyId })) }),
  );
  cancellation.skipped += flatCancellation.length;
  cancellation.needsReview.push(...flatCancellation);
  const flatDeposit = sameCurrency
    ? []
    : from.depositPolicies.filter((p) => p.amountType === "FLAT").map((p) => p.code);
  const deposit = await copyByKey(
    "depositPolicies",
    "Deposit policies",
    from.depositPolicies.filter((p) => !flatDeposit.includes(p.code)),
    existing.depositPolicies.map((p) => p.code),
    (p) => p.code,
    (rows) => tx.depositPolicy.createMany({ data: rows.map((p) => ({ ...p, propertyId })) }),
  );
  deposit.skipped += flatDeposit.length;
  deposit.needsReview.push(...flatDeposit);

  // Night audit settings that name copied codes, unless the target chose its own.
  const configSection = section("nightAuditCodes", "Night audit codes");
  const noShowCode = from.configuration?.noShowTransactionCode?.code;
  const noShowReason = from.configuration?.noShowReasonCode;
  const configuration = await tx.propertyConfiguration.findUnique({
    where: { propertyId },
    select: { noShowTransactionCodeId: true, noShowReasonCodeId: true },
  });
  const settings: Prisma.PropertyConfigurationUncheckedUpdateInput = {};
  if (noShowCode && !configuration?.noShowTransactionCodeId && codeIds.has(noShowCode)) {
    settings.noShowTransactionCodeId = codeIds.get(noShowCode)!;
  }
  if (noShowReason && !configuration?.noShowReasonCodeId) {
    const reason = await tx.reasonCode.findFirst({
      where: { propertyId, category: noShowReason.category, code: noShowReason.code },
      select: { id: true },
    });
    if (reason) settings.noShowReasonCodeId = reason.id;
  }
  if (Object.keys(settings).length > 0) {
    await tx.propertyConfiguration.upsert({
      where: { propertyId },
      create: {
        propertyId,
        ...(settings as Omit<Prisma.PropertyConfigurationUncheckedCreateInput, "propertyId">),
      },
      update: settings,
    });
    configSection.copied = Object.keys(settings).length;
  } else {
    configSection.skipped = (noShowCode ? 1 : 0) + (noShowReason ? 1 : 0);
  }

  return sections;
}
