import { z } from "zod";
import {
  PACKAGE_CALCULATIONS,
  PACKAGE_POSTING_TYPES,
  PACKAGE_RHYTHMS,
} from "@serene/shared/modules/rates/rates.schema";
import type { PackageView } from "@serene/shared/modules/rates/rates.types";

const componentSchema = z.object({
  id: z.string().optional(),
  name: z.string().refine((v) => v.trim().length > 0, "Enter a name"),
  transactionCodeId: z.string().min(1, "Select the revenue code"),
  calculation: z.enum(PACKAGE_CALCULATIONS),
  rhythm: z.enum(PACKAGE_RHYTHMS),
  unitPrice: z.string().regex(/^\d+(\.\d+)?$/, "Enter the price as a number, e.g. 12.50"),
});

/** Package create/edit form; `isEdit` drops the code (fixed once created). */
export function packageFormSchema(isEdit: boolean) {
  return z
    .object({
      code: z.string(),
      name: z.string(),
      postingType: z.enum(PACKAGE_POSTING_TYPES),
      sellSeparately: z.boolean(),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      components: z.array(componentSchema),
    })
    .superRefine((v, ctx) => {
      if (v.name.trim().length === 0) {
        ctx.addIssue({ code: "custom", path: ["name"], message: "Enter a name" });
      }
      if (!isEdit && v.code.trim().length === 0) {
        ctx.addIssue({ code: "custom", path: ["code"], message: "Enter a code" });
      }
    });
}

export type PackageFormValues = z.input<ReturnType<typeof packageFormSchema>>;
export type PackageComponentValues = PackageFormValues["components"][number];

export function emptyPackageComponent(): PackageComponentValues {
  return {
    name: "",
    transactionCodeId: "",
    calculation: "PER_ROOM",
    rhythm: "EVERY_NIGHT",
    unitPrice: "",
  };
}

export function packageDefaults(pkg?: PackageView): PackageFormValues {
  return {
    code: "",
    name: pkg?.name ?? "",
    postingType: (pkg?.postingType ?? "SEPARATE_LINE") as PackageFormValues["postingType"],
    sellSeparately: pkg?.sellSeparately ?? true,
    status: pkg?.status ?? "ACTIVE",
    components: pkg?.components.map((c) => ({
      id: c.id,
      name: c.name,
      transactionCodeId: c.transactionCode.id,
      calculation: c.calculation as PackageComponentValues["calculation"],
      rhythm: c.rhythm as PackageComponentValues["rhythm"],
      unitPrice: c.unitPrice,
    })) ?? [emptyPackageComponent()],
  };
}

/** Request body: create carries the code, edit carries the status. */
export function packagePayload(v: PackageFormValues, isEdit: boolean) {
  const base = {
    name: v.name.trim(),
    postingType: v.postingType,
    sellSeparately: v.sellSeparately,
    components: v.components.map((c) => ({ ...c, name: c.name.trim(), daysOfWeek: 127 })),
  };
  return isEdit ? { ...base, status: v.status } : { ...base, code: v.code.trim() };
}
