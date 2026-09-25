import "server-only";
import { prisma, type Tx } from "@/lib/db/prisma";
import { runInTransaction } from "@/lib/db/transaction";
import { auditActor, type PropertyContext } from "@/lib/http/context";
import { AppError, notFound } from "@/lib/http/errors";
import { formatMoney, isMinorUnitAligned, parseMoney } from "@/lib/utils/money";
import { recordAudit } from "@/modules/audit/audit.service";
import {
  type PackageRow,
  countComponentPostings,
  createComponent,
  deleteComponents,
  findActivePackages,
  findPackage,
  findPackages,
  findRateReferenceData,
  insertPackage,
  lockPackage,
  updateComponent,
  updatePackageRow,
} from "./rates.repository";
import type { CreatePackageInput, UpdatePackageInput } from "./rates.schema";
import { currencyMinorUnits } from "./rates.service";
import type { PackageView } from "./rates.types";

/**
 * Package configuration (Phase 6). Packages are priced and posted by the
 * Phase 5 billing engine (billing.policy.packageLinesForNight /
 * roomLineAmount): this service only maintains the configuration it reads.
 * A component price change applies to nights posted afterwards; posted
 * lines never change. Components with postings cannot be deleted (their id
 * is part of the posting key); deactivate the package instead.
 */

function fieldError(field: string, message: string) {
  return new AppError("VALIDATION_FAILED", message, { fields: { [field]: [message] } });
}

function view(row: PackageRow): PackageView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    postingType: row.postingType,
    sellSeparately: row.sellSeparately,
    status: row.status,
    ratePlans: row.ratePlans.map((r) => r.ratePlan.code),
    components: row.components.map((c) => ({
      id: c.id,
      name: c.name,
      transactionCode: c.transactionCode,
      calculation: c.calculation,
      rhythm: c.postingRhythm,
      daysOfWeek: c.daysOfWeek,
      unitPrice: formatMoney(parseMoney(c.unitPrice.toFixed(4))),
    })),
  };
}

/** An ACTIVE package sold separately (bookable on a reservation), in this property. */
export async function requireSellablePackage(tx: Tx, propertyId: string, packageId: string) {
  const [pkg] = await findActivePackages(tx, propertyId, [packageId]);
  if (!pkg) throw notFound("Package");
  if (!pkg.sellSeparately) {
    throw new AppError(
      "BUSINESS_RULE_VIOLATION",
      "This package is sold only as part of a rate plan",
      {
        reason: "PACKAGE_NOT_SOLD_SEPARATELY",
      },
    );
  }
  return pkg;
}

export async function listPackages(ctx: PropertyContext): Promise<PackageView[]> {
  return (await findPackages(prisma, ctx.propertyId)).map(view);
}

export async function getPackage(ctx: PropertyContext, packageId: string): Promise<PackageView> {
  const row = await findPackage(prisma, ctx.propertyId, packageId);
  if (!row) throw notFound("Package");
  return view(row);
}

async function componentRows(
  tx: Tx,
  ctx: PropertyContext,
  components: CreatePackageInput["components"],
) {
  const refs = await findRateReferenceData(tx, ctx.propertyId);
  const minorUnits = await currencyMinorUnits(tx, ctx.currencyCode);
  return components.map((component, index) => {
    if (!refs.packageChargeCodes.some((code) => code.id === component.transactionCodeId)) {
      throw fieldError(
        `components.${index}.transactionCodeId`,
        "Choose an active revenue code (not room, tax or payment)",
      );
    }
    if (!isMinorUnitAligned(parseMoney(component.unitPrice), minorUnits)) {
      throw fieldError(`components.${index}.unitPrice`, `At most ${minorUnits} decimals`);
    }
    return {
      id: component.id,
      data: {
        name: component.name,
        transactionCodeId: component.transactionCodeId,
        calculation: component.calculation,
        postingRhythm: component.rhythm,
        daysOfWeek: component.daysOfWeek,
        unitPrice: formatMoney(parseMoney(component.unitPrice)),
        sortOrder: index,
      },
    };
  });
}

export async function createPackage(
  ctx: PropertyContext,
  input: CreatePackageInput,
): Promise<PackageView> {
  const id = await runInTransaction(async (tx) => {
    const existing = await tx.package.findFirst({
      where: { propertyId: ctx.propertyId, code: input.code },
      select: { id: true },
    });
    if (existing) throw fieldError("code", `Package ${input.code} already exists`);
    const components = await componentRows(tx, ctx, input.components);
    const row = await insertPackage(tx, {
      propertyId: ctx.propertyId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      postingType: input.postingType,
      sellSeparately: input.sellSeparately,
    });
    for (const component of components) {
      await createComponent(tx, {
        ...component.data,
        propertyId: ctx.propertyId,
        packageId: row.id,
      });
    }
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "package.create",
        resourceType: "Package",
        resourceId: row.id,
        after: {
          code: input.code,
          name: input.name,
          postingType: input.postingType,
          components: components.map((c) => c.data),
        },
        permission: "packages:manage",
      },
    );
    return row.id;
  });
  return getPackage(ctx, id);
}

export async function updatePackage(
  ctx: PropertyContext,
  packageId: string,
  input: UpdatePackageInput,
): Promise<PackageView> {
  await runInTransaction(async (tx) => {
    if (!(await lockPackage(tx, ctx.propertyId, packageId))) throw notFound("Package");
    const before = (await findPackage(tx, ctx.propertyId, packageId))!;
    const components = await componentRows(tx, ctx, input.components);
    const keep = new Set(components.map((c) => c.id).filter(Boolean));
    for (const component of components) {
      if (component.id && !before.components.some((c) => c.id === component.id)) {
        throw fieldError("components", "Unknown component");
      }
    }
    const removed = before.components.filter((c) => !keep.has(c.id)).map((c) => c.id);
    if ((await countComponentPostings(tx, removed)) > 0) {
      throw new AppError(
        "BUSINESS_RULE_VIOLATION",
        "A removed component already has folio postings; deactivate the package instead",
        { reason: "COMPONENT_POSTED" },
      );
    }
    await updatePackageRow(tx, packageId, {
      name: input.name,
      description: input.description ?? null,
      postingType: input.postingType,
      sellSeparately: input.sellSeparately,
      status: input.status,
    });
    await deleteComponents(tx, removed);
    for (const component of components) {
      if (component.id) await updateComponent(tx, component.id, component.data);
      else {
        await createComponent(tx, {
          ...component.data,
          propertyId: ctx.propertyId,
          packageId,
        });
      }
    }
    await recordAudit(
      tx,
      { ...auditActor(ctx) },
      {
        action: "package.update",
        resourceType: "Package",
        resourceId: packageId,
        before: {
          name: before.name,
          postingType: before.postingType,
          status: before.status,
          components: before.components.map((c) => ({
            id: c.id,
            name: c.name,
            unitPrice: c.unitPrice.toFixed(4),
            calculation: c.calculation,
            rhythm: c.postingRhythm,
          })),
        },
        after: {
          name: input.name,
          postingType: input.postingType,
          status: input.status,
          components: components.map((c) => ({ id: c.id ?? null, ...c.data })),
        },
        permission: "packages:manage",
      },
    );
  });
  return getPackage(ctx, packageId);
}
