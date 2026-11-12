import { describe, expect, it } from "vitest";
import {
  guestPayload,
  newGuestDialogDefaults,
  newGuestFormSchema,
  newGuestInlineDefaults,
} from "@/app/(workspace)/[propertyCode]/guests/_lib/guestForm";
import {
  newCompanyDefaults,
  newCompanyFormSchema,
} from "@/app/(workspace)/[propertyCode]/guests/_lib/companyForm";
import {
  programFormSchema,
  tierFormDefaults,
  tierFormSchema,
} from "@/app/(workspace)/[propertyCode]/guests/_lib/loyaltyForm";
import {
  companyNeedsReason,
  editCompanyDefaults,
  editCompanyFormSchema,
  editCompanyPayload,
  relationshipFormSchema,
  relationshipPayload,
} from "@/app/(workspace)/[propertyCode]/companies/[accountId]/_lib/companyForms";
import {
  editProfileDefaults,
  editProfileFormSchema,
  enrollFormSchema,
  membershipFormSchema,
  pointsFormSchema,
  preferencesPayload,
} from "@/app/(workspace)/[propertyCode]/guests/[guestId]/_lib/guestDialogForms";
import {
  companyFormSchema,
  companyPayload,
} from "@/app/(workspace)/[propertyCode]/reservations/[reservationId]/_lib/companyForm";

const messages = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("new guest form", () => {
  it("prefills the name from the search text", () => {
    expect(newGuestInlineDefaults("  Ada  King Lovelace ")).toMatchObject({
      firstName: "Ada",
      lastName: "King Lovelace",
    });
    expect(newGuestInlineDefaults("")).toMatchObject({ firstName: "", lastName: "" });
  });

  it("requires names and validates e-mail with the shared messages", () => {
    const bad = newGuestFormSchema.safeParse({ ...newGuestDialogDefaults, email: "nope" });
    expect(messages(bad)).toMatchObject({
      firstName: "First name is required",
      lastName: "Last name is required",
      email: "Enter a valid email address",
    });
  });

  it("parses and carries the duplicate decision", () => {
    const parsed = newGuestFormSchema.parse({
      ...newGuestDialogDefaults,
      firstName: " Ada ",
      lastName: "Lovelace",
      nationalityCode: "pk",
    });
    expect(parsed.firstName).toBe("Ada");
    expect(parsed.nationalityCode).toBe("PK");
    expect(guestPayload(parsed, true).allowDuplicate).toBe(true);
    expect(guestPayload(parsed, false).allowDuplicate).toBe(false);
  });
});

describe("new company form", () => {
  it("maps empty optional fields to null and upper-cases the code", () => {
    const out = newCompanyFormSchema.parse({
      ...newCompanyDefaults,
      code: " acme-1 ",
      name: " Acme ",
      countryCode: "pk",
    });
    expect(out).toEqual({
      type: "COMPANY",
      code: "ACME-1",
      name: "Acme",
      email: null,
      phone: null,
      city: null,
      countryCode: "PK",
      notes: null,
    });
  });

  it("explains invalid entries", () => {
    const bad = newCompanyFormSchema.safeParse({
      ...newCompanyDefaults,
      code: "bad code!",
      phone: "abc",
      email: "x",
      countryCode: "PAK",
    });
    expect(messages(bad)).toMatchObject({
      code: "Use up to 20 letters, digits, '-' or '_'",
      name: "Name is required",
      phone: "Digits, spaces, +, ( ) and - only",
      email: "Enter a valid email address",
      countryCode: "Two-letter country code",
    });
  });
});

describe("loyalty forms", () => {
  it("requires an audited reason of 3 characters", () => {
    const bad = programFormSchema.safeParse({
      code: "a",
      name: "n",
      isExternal: false,
      reason: "no",
    });
    expect(messages(bad)).toEqual({ reason: "Enter a reason of at least 3 characters" });
  });

  it("defaults a new tier's rank and converts numbers", () => {
    const defaults = tierFormDefaults(null, 2);
    expect(defaults.rank).toBe("3");
    const out = tierFormSchema(false).parse({
      ...defaults,
      code: "GOLD",
      name: "Gold",
      qualifyingNights: "10",
      reason: "launch",
    });
    expect(out).toMatchObject({ rank: 3, qualifyingNights: 10, qualifyingStays: null });
  });

  it("needs a code only when creating", () => {
    const base = { ...tierFormDefaults(null, 0), name: "Gold", reason: "launch" };
    expect(messages(tierFormSchema(false).safeParse(base))).toEqual({ code: "Code is required" });
    expect(tierFormSchema(true).safeParse(base).success).toBe(true);
  });
});

describe("edit company form", () => {
  const company = {
    version: 4,
    name: "Acme",
    legalName: null,
    taxId: null,
    iataNumber: null,
    email: null,
    phone: null,
    addressLine1: null,
    city: null,
    postalCode: null,
    countryCode: null,
    notes: null,
    status: "ACTIVE",
    isRestricted: false,
    restrictionReason: null,
  };

  it("needs a reason only for status or restriction changes", () => {
    const schema = editCompanyFormSchema(company);
    const defaults = editCompanyDefaults(company);
    expect(schema.safeParse(defaults).success).toBe(true);
    const changed = { ...defaults, status: "INACTIVE" as const };
    expect(companyNeedsReason(changed, company)).toBe(true);
    expect(messages(schema.safeParse(changed))).toEqual({
      reason: "Enter a reason of at least 3 characters",
    });
    expect(messages(schema.safeParse({ ...defaults, isRestricted: true, reason: "risk" }))).toEqual(
      { restrictionReason: "Say why the company is restricted" },
    );
  });

  it("sends status and restriction only when they changed", () => {
    const defaults = editCompanyDefaults(company);
    const plain = editCompanyPayload(defaults, company);
    expect(plain).not.toHaveProperty("status");
    expect(plain).not.toHaveProperty("isRestricted");
    expect(plain.version).toBe(4);
    const restricted = editCompanyPayload(
      { ...defaults, isRestricted: true, restrictionReason: "fraud", reason: " audit " },
      company,
    );
    expect(restricted).toMatchObject({
      isRestricted: true,
      restrictionReason: "fraud",
      reason: "audit",
    });
  });

  it("builds the relationship payload", () => {
    expect(
      relationshipFormSchema.safeParse({ guest: null, kind: "CONTACT", role: "", isPrimary: false })
        .success,
    ).toBe(false);
    expect(relationshipPayload({ kind: "CONTACT", role: "  ", isPrimary: true })).toEqual({
      kind: "CONTACT",
      role: null,
      isPrimary: true,
    });
  });
});

describe("guest dialogs", () => {
  const guest = {
    title: null,
    firstName: "Ada",
    middleName: null,
    lastName: "Lovelace",
    preferredName: null,
    gender: null,
    dateOfBirth: "1990-01-01",
    email: "ada@example.com",
    phone: null,
    preferredContact: null,
    nationalityCode: null,
    languageCode: null,
    vipLevelId: null,
    marketingOptIn: false,
    status: "ACTIVE",
    isRestricted: false,
    restrictionReason: null,
    contacts: [],
    addresses: [],
  };
  const original = {
    status: "ACTIVE",
    isRestricted: false,
    dateOfBirth: "1990-01-01",
    readSensitive: true,
  };

  it("requires a reason when the date of birth changes", () => {
    const schema = editProfileFormSchema(original);
    const defaults = editProfileDefaults(guest);
    expect(schema.safeParse(defaults).success).toBe(true);
    expect(messages(schema.safeParse({ ...defaults, dateOfBirth: "1991-02-02" }))).toEqual({
      reason: "Enter a reason of at least 3 characters",
    });
  });

  it("validates contact rows", () => {
    const schema = editProfileFormSchema(original);
    const defaults = editProfileDefaults(guest);
    const bad = schema.safeParse({
      ...defaults,
      contacts: [{ type: "EMAIL", value: "nope", isPrimary: false, optIn: false }],
    });
    expect(messages(bad)).toEqual({ "contacts.0.value": "Enter a valid email address" });
  });

  it("requires a membership number for external programs", () => {
    const schema = enrollFormSchema((id) => id === "ext");
    const base = { programId: "ext", tierId: "", number: "", reason: "welcome" };
    expect(messages(schema.safeParse(base))).toEqual({ number: "Enter the membership number" });
    expect(schema.safeParse({ ...base, programId: "int" }).success).toBe(true);
  });

  it("needs a change for a membership and whole non-zero points", () => {
    const schema = membershipFormSchema({ tierId: "t1", status: "ACTIVE" });
    expect(messages(schema.safeParse({ tierId: "t1", status: "ACTIVE", reason: "same" }))).toEqual({
      tierId: "Change the tier or the status",
    });
    expect(schema.safeParse({ tierId: "", status: "ACTIVE", reason: "drop" }).success).toBe(true);
    const ok = { description: "Goodwill", reason: "service" };
    expect(pointsFormSchema.safeParse({ ...ok, points: "-50" }).success).toBe(true);
    expect(pointsFormSchema.safeParse({ ...ok, points: "0" }).success).toBe(false);
    expect(pointsFormSchema.safeParse({ ...ok, points: "1.5" }).success).toBe(false);
  });

  it("maps preference rows (empty property means every property)", () => {
    expect(
      preferencesPayload({
        rows: [
          { preferenceCodeId: "a", propertyId: "", note: "  " },
          { preferenceCodeId: "b", propertyId: "p1", note: " quiet " },
        ],
      }),
    ).toEqual([
      { preferenceCodeId: "a", propertyId: null, note: null },
      { preferenceCodeId: "b", propertyId: "p1", note: "quiet" },
    ]);
  });
});

describe("reservation company form", () => {
  it("keeps the booker only for a company and its contacts", () => {
    const company = { id: "c1", label: "Acme" };
    const values = { company, booker: "g1", reason: " moved " };
    expect(companyPayload(values, ["g1"])).toEqual({
      companyId: "c1",
      bookerGuestId: "g1",
      reason: "moved",
    });
    expect(companyPayload(values, ["g2"]).bookerGuestId).toBeNull();
    expect(companyPayload({ ...values, company: null }, ["g1"])).toMatchObject({
      companyId: null,
      bookerGuestId: null,
    });
    expect(companyFormSchema.safeParse({ ...values, reason: "x".repeat(1001) }).success).toBe(
      false,
    );
  });
});
