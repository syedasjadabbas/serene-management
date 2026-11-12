import { z } from "zod";

export interface AddPackageValues {
  packageId: string;
  quantity: string;
  startDate: string;
  endDate: string;
}

/** Add-package form values; the quantity is typed as digits and parsed on submit. */
export const addPackageFormSchema = z.object({
  packageId: z.string().min(1, "Choose a package"),
  quantity: z
    .string()
    .refine((q) => Number.parseInt(q || "0", 10) >= 1, "Enter a quantity of at least 1"),
  startDate: z.string().min(1, "Choose the first night"),
  endDate: z.string().min(1, "Choose the last night"),
});

export function addPackageDefaults(firstNight: string, lastNight: string): AddPackageValues {
  return { packageId: "", quantity: "1", startDate: firstNight, endDate: lastNight };
}

/** Keeps the digits only, at most two (as the quantity box has always done). */
export function sanitizeQuantity(raw: string) {
  return raw.replace(/\D/g, "").slice(0, 2);
}

export function addPackageBody(v: AddPackageValues) {
  return {
    packageId: v.packageId,
    quantity: Number.parseInt(v.quantity || "0", 10),
    startDate: v.startDate,
    endDate: v.endDate,
  };
}
