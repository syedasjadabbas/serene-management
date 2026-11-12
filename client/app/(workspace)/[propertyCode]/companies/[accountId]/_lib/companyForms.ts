import { z } from "zod";

type Status = "ACTIVE" | "INACTIVE";

export interface EditCompanyOriginal {
  status: string;
  isRestricted: boolean;
}

const normalizedStatus = (status: string): Status =>
  status === "INACTIVE" ? "INACTIVE" : "ACTIVE";

/** Whether saving changes the status or the restriction (both need an audited reason). */
export function companyNeedsReason(
  values: { status: Status; isRestricted: boolean },
  original: EditCompanyOriginal,
) {
  return (
    values.status !== normalizedStatus(original.status) ||
    values.isRestricted !== original.isRestricted
  );
}

/**
 * Edit-company form. The reason is required (3+ characters) when the status
 * or the restriction changes, and a restricted company needs its restriction
 * reason. Text fields stay raw strings; the server trims them.
 */
export function editCompanyFormSchema(original: EditCompanyOriginal) {
  return z
    .object({
      name: z.string().trim().min(1, "Name is required").max(200),
      legalName: z.string().max(200),
      taxId: z.string().max(60),
      iataNumber: z.string().max(20),
      email: z
        .string()
        .max(254)
        .refine((v) => v.trim() === "" || z.email().safeParse(v.trim()).success, {
          message: "Enter a valid email address",
        }),
      phone: z
        .string()
        .max(40)
        .regex(/^[+0-9 ()-]*$/, "Digits, spaces, +, ( ) and - only"),
      addressLine1: z.string().max(200),
      city: z.string().max(100),
      postalCode: z.string().max(20),
      countryCode: z.string().regex(/^([A-Za-z]{2})?$/, "Two-letter country code"),
      notes: z.string().max(4000),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      isRestricted: z.boolean(),
      restrictionReason: z.string().max(500),
      reason: z.string().max(1000),
    })
    .superRefine((value, ctx) => {
      if (companyNeedsReason(value, original) && value.reason.trim().length < 3) {
        ctx.addIssue({
          code: "custom",
          path: ["reason"],
          message: "Enter a reason of at least 3 characters",
        });
      }
      if (value.isRestricted && !value.restrictionReason.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["restrictionReason"],
          message: "Say why the company is restricted",
        });
      }
    });
}

export type EditCompanyValues = z.input<ReturnType<typeof editCompanyFormSchema>>;

export function editCompanyDefaults(company: {
  name: string;
  legalName: string | null;
  taxId: string | null;
  iataNumber: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
  countryCode: string | null;
  notes: string | null;
  status: string;
  isRestricted: boolean;
  restrictionReason: string | null;
}): EditCompanyValues {
  return {
    name: company.name,
    legalName: company.legalName ?? "",
    taxId: company.taxId ?? "",
    iataNumber: company.iataNumber ?? "",
    email: company.email ?? "",
    phone: company.phone ?? "",
    addressLine1: company.addressLine1 ?? "",
    city: company.city ?? "",
    postalCode: company.postalCode ?? "",
    countryCode: company.countryCode ?? "",
    notes: company.notes ?? "",
    status: normalizedStatus(company.status),
    isRestricted: company.isRestricted,
    restrictionReason: company.restrictionReason ?? "",
    reason: "",
  };
}

/** Request body of the update (status/restriction only when they changed). */
export function editCompanyPayload(
  values: EditCompanyValues,
  company: EditCompanyOriginal & { version: number },
) {
  const statusChange = values.status !== normalizedStatus(company.status);
  const restrictionChange = values.isRestricted !== company.isRestricted;
  return {
    version: company.version,
    name: values.name,
    legalName: values.legalName,
    taxId: values.taxId,
    iataNumber: values.iataNumber,
    email: values.email,
    phone: values.phone,
    addressLine1: values.addressLine1,
    city: values.city,
    postalCode: values.postalCode,
    countryCode: values.countryCode || null,
    notes: values.notes,
    ...(statusChange ? { status: values.status } : {}),
    ...(restrictionChange
      ? {
          isRestricted: values.isRestricted,
          restrictionReason: values.isRestricted ? values.restrictionReason : null,
        }
      : {}),
    ...(values.reason.trim() ? { reason: values.reason.trim() } : {}),
  };
}

/** Company contact (guest relationship) form. */
export const relationshipFormSchema = z.object({
  guest: z
    .object({ id: z.string(), label: z.string() })
    .nullable()
    .refine((g) => g !== null, {
      message: "Select a guest",
    }),
  kind: z.enum(["EMPLOYEE", "CONTACT", "ASSOCIATE"]),
  role: z.string().max(100),
  isPrimary: z.boolean(),
});

export type RelationshipValues = z.input<typeof relationshipFormSchema>;

export function relationshipPayload(values: {
  kind: "EMPLOYEE" | "CONTACT" | "ASSOCIATE";
  role: string;
  isPrimary: boolean;
}) {
  return { kind: values.kind, role: values.role.trim() || null, isPrimary: values.isPrimary };
}
