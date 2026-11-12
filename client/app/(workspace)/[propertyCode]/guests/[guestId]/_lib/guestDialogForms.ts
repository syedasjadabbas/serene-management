import { z } from "zod";
import type {
  GuestAddressView,
  GuestContactView,
} from "@serene/shared/modules/guests/guests.types";

const REASON_MESSAGE = "Enter a reason of at least 3 characters";
const EMAIL_MESSAGE = "Enter a valid email address";
const PHONE_MESSAGE = "Digits, spaces, +, ( ) and - only";

const CONTACT_TYPES = ["EMAIL", "PHONE", "MOBILE", "WHATSAPP", "FAX"] as const;
const ADDRESS_TYPES = ["HOME", "BUSINESS", "BILLING", "OTHER"] as const;

const emailOrEmpty = z
  .string()
  .max(254)
  .refine((v) => v.trim() === "" || z.email().safeParse(v.trim()).success, EMAIL_MESSAGE);
const phoneOrEmpty = z
  .string()
  .max(40)
  .regex(/^[+0-9 ()-]*$/, PHONE_MESSAGE);
const countryOrEmpty = z.string().regex(/^([A-Za-z]{2})?$/, "Two-letter country code");

// --- Edit profile ---------------------------------------------------------------------------

const contactRowSchema = z
  .object({
    type: z.enum(CONTACT_TYPES),
    value: z.string(),
    isPrimary: z.boolean(),
    optIn: z.boolean(),
  })
  .superRefine((contact, ctx) => {
    const value = contact.value.trim();
    if (value.length < 3) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter at least 3 characters",
      });
    } else if (contact.type === "EMAIL" && !z.email().safeParse(value).success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: EMAIL_MESSAGE });
    } else if (contact.type !== "EMAIL" && !/^[+0-9 ()-]+$/.test(value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: PHONE_MESSAGE });
    }
  });

const addressRowSchema = z.object({
  type: z.enum(ADDRESS_TYPES),
  line1: z.string().trim().min(1, "Enter the first address line").max(200),
  line2: z.string().max(200),
  city: z.string().max(100),
  region: z.string().max(100),
  postalCode: z.string().max(20),
  countryCode: countryOrEmpty,
  isPrimary: z.boolean(),
});

export interface ProfileOriginal {
  status: string;
  isRestricted: boolean;
  dateOfBirth: string | null;
  readSensitive: boolean;
}

const normalizedStatus = (status: string) => (status === "INACTIVE" ? "INACTIVE" : "ACTIVE");

/** Which sensitive changes a form state makes (each needs an audited reason). */
export function profileChanges(
  values: { status: string; isRestricted: boolean; dateOfBirth: string },
  original: ProfileOriginal,
) {
  const statusChange = values.status !== normalizedStatus(original.status);
  const restrictionChange = values.isRestricted !== original.isRestricted;
  const dateOfBirthChange =
    original.readSensitive && values.dateOfBirth !== (original.dateOfBirth ?? "");
  return {
    statusChange,
    restrictionChange,
    dateOfBirthChange,
    needsReason: statusChange || restrictionChange || dateOfBirthChange,
  };
}

export function editProfileFormSchema(original: ProfileOriginal) {
  return z
    .object({
      title: z.string().max(20),
      firstName: z.string().trim().min(1, "First name is required").max(100),
      middleName: z.string().max(100),
      lastName: z.string().trim().min(1, "Last name is required").max(100),
      preferredName: z.string().max(100),
      gender: z.string().max(20),
      dateOfBirth: z.string(),
      email: emailOrEmpty,
      phone: phoneOrEmpty,
      preferredContact: z.string(),
      nationalityCode: countryOrEmpty,
      languageCode: z.string().max(10),
      vipLevelId: z.string(),
      marketingOptIn: z.boolean(),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      isRestricted: z.boolean(),
      restrictionReason: z.string().max(500),
      reason: z.string().max(1000),
      contacts: z.array(contactRowSchema).max(20),
      addresses: z.array(addressRowSchema).max(10),
    })
    .superRefine((value, ctx) => {
      if (profileChanges(value, original).needsReason && value.reason.trim().length < 3) {
        ctx.addIssue({ code: "custom", path: ["reason"], message: REASON_MESSAGE });
      }
      if (value.isRestricted && !value.restrictionReason.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["restrictionReason"],
          message: "Say why the profile is restricted",
        });
      }
    });
}

export type EditProfileValues = z.input<ReturnType<typeof editProfileFormSchema>>;
export type ContactRowValues = EditProfileValues["contacts"][number];
export type AddressRowValues = EditProfileValues["addresses"][number];

interface ProfileLike {
  title: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  preferredContact: GuestContactView["type"] | null;
  nationalityCode: string | null;
  languageCode: string | null;
  vipLevelId: string | null;
  marketingOptIn: boolean;
  status: string;
  isRestricted: boolean;
  restrictionReason: string | null;
  contacts: Pick<GuestContactView, "type" | "value" | "isPrimary" | "optIn">[];
  addresses: Omit<GuestAddressView, "id">[];
}

export function editProfileDefaults(guest: ProfileLike): EditProfileValues {
  return {
    title: guest.title ?? "",
    firstName: guest.firstName,
    middleName: guest.middleName ?? "",
    lastName: guest.lastName,
    preferredName: guest.preferredName ?? "",
    gender: guest.gender ?? "",
    dateOfBirth: guest.dateOfBirth ?? "",
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    preferredContact: guest.preferredContact ?? "",
    nationalityCode: guest.nationalityCode ?? "",
    languageCode: guest.languageCode ?? "",
    vipLevelId: guest.vipLevelId ?? "",
    marketingOptIn: guest.marketingOptIn,
    status: normalizedStatus(guest.status),
    isRestricted: guest.isRestricted,
    restrictionReason: guest.restrictionReason ?? "",
    reason: "",
    contacts: guest.contacts.map(({ type, value, isPrimary, optIn }) => ({
      type,
      value,
      isPrimary,
      optIn,
    })),
    addresses: guest.addresses.map((a) => ({
      type: a.type,
      line1: a.line1,
      line2: a.line2 ?? "",
      city: a.city ?? "",
      region: a.region ?? "",
      postalCode: a.postalCode ?? "",
      countryCode: a.countryCode ?? "",
      isPrimary: a.isPrimary,
    })),
  };
}

export function newContactRow(): ContactRowValues {
  return { type: "MOBILE", value: "", isPrimary: false, optIn: false };
}

export function newAddressRow(isFirst: boolean): AddressRowValues {
  return {
    type: "HOME",
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    countryCode: "",
    isPrimary: isFirst,
  };
}

const nullable = (value: string) => (value === "" ? null : value);

/** Update request body: sensitive fields only when the caller changed (and may change) them. */
export function editProfilePayload(
  values: EditProfileValues,
  guest: ProfileOriginal & {
    version: number;
    restrictionReason: string | null;
    manageRestrictions: boolean;
  },
) {
  const { statusChange, restrictionChange, dateOfBirthChange } = profileChanges(values, guest);
  return {
    version: guest.version,
    title: values.title,
    firstName: values.firstName,
    middleName: values.middleName,
    lastName: values.lastName,
    preferredName: values.preferredName,
    gender: values.gender,
    ...(dateOfBirthChange ? { dateOfBirth: values.dateOfBirth || null } : {}),
    email: values.email,
    phone: values.phone,
    preferredContact: (values.preferredContact || null) as GuestContactView["type"] | null,
    nationalityCode: values.nationalityCode || null,
    languageCode: values.languageCode,
    vipLevelId: values.vipLevelId || null,
    marketingOptIn: values.marketingOptIn,
    ...(statusChange ? { status: values.status } : {}),
    ...(!guest.manageRestrictions
      ? {}
      : restrictionChange
        ? {
            isRestricted: values.isRestricted,
            restrictionReason: values.isRestricted ? values.restrictionReason : null,
          }
        : values.isRestricted && values.restrictionReason !== (guest.restrictionReason ?? "")
          ? { restrictionReason: values.restrictionReason }
          : {}),
    contacts: values.contacts,
    addresses: values.addresses.map((a) => ({
      ...a,
      line2: nullable(a.line2),
      city: nullable(a.city),
      region: nullable(a.region),
      postalCode: nullable(a.postalCode),
      countryCode: a.countryCode || null,
    })),
    ...(values.reason.trim() ? { reason: values.reason.trim() } : {}),
  };
}

// --- Preferences ----------------------------------------------------------------------------

export const preferencesFormSchema = z.object({
  rows: z.array(
    z.object({
      preferenceCodeId: z.string(),
      propertyId: z.string().nullable(),
      note: z.string().max(500),
    }),
  ),
});
export type PreferencesValues = z.input<typeof preferencesFormSchema>;

export function preferencesPayload(values: PreferencesValues) {
  return values.rows.map((r) => ({
    preferenceCodeId: r.preferenceCodeId,
    propertyId: r.propertyId || null,
    note: r.note.trim() || null,
  }));
}

// --- Note ------------------------------------------------------------------------------------

export const noteFormSchema = z.object({
  body: z.string().trim().min(1, "Enter the note").max(4000),
  visibility: z.enum(["ALL_STAFF", "MANAGEMENT", "INTERNAL"]),
  isAlert: z.boolean(),
  scope: z.string(),
});

export function notePayload(values: z.output<typeof noteFormSchema>) {
  return {
    body: values.body,
    visibility: values.visibility,
    isAlert: values.isAlert,
    propertyId: values.scope || null,
  };
}

// --- Loyalty ---------------------------------------------------------------------------------

const auditReason = z.string().trim().min(3, REASON_MESSAGE).max(500, "At most 500 characters");

/** Enrol in a program; external programs need their own membership number. */
export function enrollFormSchema(isExternal: (programId: string) => boolean) {
  return z
    .object({
      programId: z.string().min(1, "Choose a program"),
      tierId: z.string(),
      number: z.string(),
      reason: auditReason,
    })
    .superRefine((value, ctx) => {
      if (isExternal(value.programId) && !value.number.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["number"],
          message: "Enter the membership number",
        });
      }
    });
}

export function enrollPayload(
  values: z.output<ReturnType<typeof enrollFormSchema>>,
  external: boolean,
) {
  return {
    programId: values.programId,
    tierId: values.tierId || null,
    ...(external ? { membershipNumber: values.number.trim().toUpperCase() } : {}),
    reason: values.reason,
  };
}

/** Membership change: at least one of tier / status must differ. */
export function membershipFormSchema(original: {
  tierId: string | null;
  status: "ACTIVE" | "INACTIVE";
}) {
  return z
    .object({
      tierId: z.string(),
      status: z.enum(["ACTIVE", "INACTIVE"]),
      reason: auditReason,
    })
    .superRefine((value, ctx) => {
      const tierChanged = (value.tierId || null) !== original.tierId;
      if (!tierChanged && value.status === original.status) {
        ctx.addIssue({
          code: "custom",
          path: ["tierId"],
          message: "Change the tier or the status",
        });
      }
    });
}

export function membershipPayload(
  values: z.output<ReturnType<typeof membershipFormSchema>>,
  original: { tierId: string | null; status: "ACTIVE" | "INACTIVE"; version: number },
) {
  return {
    version: original.version,
    ...((values.tierId || null) !== original.tierId ? { tierId: values.tierId || null } : {}),
    ...(values.status !== original.status ? { status: values.status } : {}),
    reason: values.reason,
  };
}

export const pointsFormSchema = z.object({
  points: z
    .string()
    .trim()
    .regex(/^-?[1-9]\d*$/, "Enter whole points, not zero (a minus sign deducts)"),
  description: z.string().trim().min(3, "Enter at least 3 characters").max(200),
  reason: auditReason,
});
