import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  GET as accountRoute,
  PATCH as updateAccountRoute,
} from "@/app/api/v1/accounts/[accountId]/route";
import {
  DELETE as removeContactRoute,
  PUT as contactRoute,
} from "@/app/api/v1/accounts/[accountId]/contacts/[guestId]/route";
import { GET as accountsRoute, POST as createAccountRoute } from "@/app/api/v1/accounts/route";
import { GET as historyRoute } from "@/app/api/v1/guests/[guestId]/history/route";
import { POST as enrollRoute } from "@/app/api/v1/guests/[guestId]/loyalty/route";
import { DELETE as deleteNoteRoute } from "@/app/api/v1/guests/[guestId]/notes/[noteId]/route";
import { POST as addNoteRoute } from "@/app/api/v1/guests/[guestId]/notes/route";
import { PUT as preferencesRoute } from "@/app/api/v1/guests/[guestId]/preferences/route";
import { GET as guestRoute, PATCH as updateGuestRoute } from "@/app/api/v1/guests/[guestId]/route";
import { GET as guestOptionsRoute } from "@/app/api/v1/guests/options/route";
import { GET as searchRoute, POST as createGuestRoute } from "@/app/api/v1/guests/route";
import { POST as adjustRoute } from "@/app/api/v1/loyalty/memberships/[membershipId]/adjustments/route";
import { PATCH as membershipRoute } from "@/app/api/v1/loyalty/memberships/[membershipId]/route";
import { POST as createTierRoute } from "@/app/api/v1/loyalty/programs/[programId]/tiers/route";
import {
  GET as programsRoute,
  POST as createProgramRoute,
} from "@/app/api/v1/loyalty/programs/route";
import { GET as availabilityRoute } from "@/app/api/v1/properties/[propertyId]/availability/route";
import { PUT as planAccountsRoute } from "@/app/api/v1/properties/[propertyId]/rate-plans/[ratePlanId]/accounts/route";
import { POST as createPlanRoute } from "@/app/api/v1/properties/[propertyId]/rate-plans/route";
import { PUT as reservationCompanyRoute } from "@/app/api/v1/properties/[propertyId]/reservations/[reservationId]/company/route";
import { GET as reservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/[reservationId]/route";
import { POST as createReservationRoute } from "@/app/api/v1/properties/[propertyId]/reservations/route";
import { prisma } from "@/lib/db/prisma";
import { addDays } from "@/modules/business-date/business-date.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  auditLogsFor,
  buildFixtureInventory,
  createFixtureOrg,
  createGuestRow,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

type Inventory = Awaited<ReturnType<typeof buildFixtureInventory>>;

let org: FixtureOrg;
let other: FixtureOrg;
let A: string;
let B: string;
let inv: Inventory;
let D: string;
let gm: CookieJar; // general manager @ A: everything at A
let orgGm: CookieJar; // general manager at organization scope: organization data (D3)
let fom: CookieJar; // front office manager @ A: guests (sensitive), accounts:manage, no loyalty:manage
let agent: CookieJar; // front desk @ A: guests read/create/update, accounts:read, loyalty:read
let cashier: CookieJar; // cashier @ A: guests:read, accounts:read, no loyalty
let auditor: CookieJar; // read only @ A (+ audit:read)
let gmB: CookieJar; // general manager @ B only
let outsider: CookieJar; // general manager of another organization

const G = "/api/v1/guests";
const P = (propertyId: string) => `/api/v1/properties/${propertyId}`;
const KNG = () => inv.roomTypes.KNG!.id;

async function newGuest(jar: CookieJar, body: Record<string, unknown>) {
  const r = await call(createGuestRoute, { method: "POST", path: G, body, jar });
  return r;
}

async function profile(jar: CookieJar, guestId: string) {
  return call(guestRoute, { path: `${G}/${guestId}`, params: { guestId }, jar });
}

async function patchGuest(jar: CookieJar, guestId: string, body: Record<string, unknown>) {
  return call(updateGuestRoute, {
    method: "PATCH",
    path: `${G}/${guestId}`,
    params: { guestId },
    body,
    jar,
  });
}

async function book(body: Record<string, unknown>, jar = gm) {
  return call(createReservationRoute, {
    method: "POST",
    path: `${P(A)}/reservations`,
    params: { propertyId: A },
    body: {
      adults: 1,
      roomTypeId: KNG(),
      ratePlanId: inv.ratePlans.BAR!,
      reservationTypeId: inv.reservationTypes.GTD!,
      ...body,
    },
    jar,
  });
}

async function newCompany(code: string, jar = fom) {
  const r = await call(createAccountRoute, {
    method: "POST",
    path: "/api/v1/accounts",
    body: { code, name: `Company ${code}`, email: `travel@${code.toLowerCase()}.example.com` },
    jar,
  });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; version: number };
}

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Dubai" },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  A = org.properties.A!.id;
  B = org.properties.B!.id;
  inv = await buildFixtureInventory(org, "A", [{ code: "KNG", rooms: 12 }]);
  await buildFixtureInventory(org, "B", [{ code: "KNG", rooms: 2 }]);
  D = inv.businessDate;
  const users = {
    gm: await createUser(org, "gm", [{ role: "GENERAL_MANAGER", property: "A" }]),
    orgGm: await createUser(org, "orggm", [{ role: "GENERAL_MANAGER" }]),
    fom: await createUser(org, "fom", [{ role: "FRONT_OFFICE_MANAGER", property: "A" }]),
    agent: await createUser(org, "agent", [{ role: "FRONT_DESK_AGENT", property: "A" }]),
    cashier: await createUser(org, "cashier", [{ role: "CASHIER", property: "A" }]),
    auditor: await createUser(org, "auditor", [{ role: "AUDITOR", property: "A" }]),
    gmB: await createUser(org, "gmb", [{ role: "GENERAL_MANAGER", property: "B" }]),
    outsider: await createUser(other, "gmx", [{ role: "GENERAL_MANAGER", property: "X" }]),
  };
  gm = await loginAs(users.gm.email, TEST_PASSWORD);
  orgGm = await loginAs(users.orgGm.email, TEST_PASSWORD);
  fom = await loginAs(users.fom.email, TEST_PASSWORD);
  agent = await loginAs(users.agent.email, TEST_PASSWORD);
  cashier = await loginAs(users.cashier.email, TEST_PASSWORD);
  auditor = await loginAs(users.auditor.email, TEST_PASSWORD);
  gmB = await loginAs(users.gmB.email, TEST_PASSWORD);
  outsider = await loginAs(users.outsider.email, TEST_PASSWORD);

  // Preference catalog and a VIP level of the organization.
  await prisma.preferenceCode.createMany({
    data: [
      {
        organizationId: org.organizationId,
        groupCode: "ROOM",
        code: "HIGHFLOOR",
        name: "High floor",
      },
      { organizationId: org.organizationId, groupCode: "DIETARY", code: "VEGAN", name: "Vegan" },
    ],
  });
  await prisma.vipLevel.create({
    data: { organizationId: org.organizationId, code: "VIP", name: "VIP", rank: 1 },
  });
});

describe("guest profiles", () => {
  it("creates a profile, warns about duplicates and audits the creation", async () => {
    const email = `dup.${randomUUID().slice(0, 6)}@example.com`;
    const first = await newGuest(agent, {
      firstName: "Nora",
      lastName: "Duplicate",
      email,
      phone: "+92 300 111 2233",
    });
    expect(first.status).toBe(201);
    const dup = await newGuest(agent, { firstName: "Nora", lastName: "Dup", email });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.reason).toBe("POSSIBLE_DUPLICATE");
    expect(dup.body.error.details.matches[0].id).toBe(first.body.data.id);
    // Same phone, different formatting: still a possible duplicate.
    const byPhone = await newGuest(agent, {
      firstName: "N",
      lastName: "Other",
      phone: "03001112233",
    });
    expect(byPhone.status).toBe(201); // "0300…" vs "92300…": different digits, not the same number
    const phoneDup = await newGuest(agent, {
      firstName: "N",
      lastName: "Same",
      phone: "+923001112233",
    });
    expect(phoneDup.status).toBe(409);
    const allowed = await newGuest(agent, {
      firstName: "Nora",
      lastName: "Dup",
      email,
      allowDuplicate: true,
    });
    expect(allowed.status).toBe(201);
    const audit = await auditLogsFor(allowed.body.data.id);
    expect(audit.map((a) => a.action)).toContain("guest.create");
    // Read-only users cannot create.
    expect((await newGuest(auditor, { firstName: "X", lastName: "Y" })).status).toBe(403);
  });

  it("updates a profile with version checks, lists and HIGH-risk sensitive changes", async () => {
    const guest = (await createGuestRow(org, "Petra", "Profile")).id;
    const v1 = (await profile(agent, guest)).body.data;
    expect(v1.access).toMatchObject({ update: true, readSensitive: false });
    const updated = await patchGuest(agent, guest, {
      version: v1.version,
      preferredName: "Pet",
      phone: "+44 (20) 7946-0018",
      contacts: [
        { type: "EMAIL", value: "petra.work@example.com", isPrimary: true },
        { type: "MOBILE", value: "+44 7700 900123", isPrimary: true },
      ],
      addresses: [
        {
          type: "HOME",
          line1: "1 High Street",
          city: "London",
          countryCode: "gb",
          isPrimary: true,
        },
      ],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      version: v1.version + 1,
      displayName: "Pet Profile",
      phone: "+44 (20) 7946-0018",
    });
    expect(updated.body.data.contacts).toHaveLength(2);
    expect(updated.body.data.addresses[0]).toMatchObject({ city: "London", countryCode: "GB" });
    // Stale version.
    const stale = await patchGuest(agent, guest, { version: v1.version, preferredName: "X" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.reason).toBe("STALE_VERSION");
    // Two primary e-mails are refused.
    const twoPrimary = await patchGuest(agent, guest, {
      version: v1.version + 1,
      contacts: [
        { type: "EMAIL", value: "a@example.com", isPrimary: true },
        { type: "EMAIL", value: "b@example.com", isPrimary: true },
      ],
    });
    expect(twoPrimary.status).toBe(400);
    // Concurrent edits of one version: one wins.
    const [a, b] = await Promise.all([
      patchGuest(agent, guest, { version: v1.version + 1, preferredName: "A" }),
      patchGuest(fom, guest, { version: v1.version + 1, preferredName: "B" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const current = (await profile(fom, guest)).body.data;

    // Date of birth is sensitive: only guests:read_sensitive may write / read it.
    expect(
      (await patchGuest(agent, guest, { version: current.version, dateOfBirth: "1990-05-01" }))
        .status,
    ).toBe(403);
    const dob = await patchGuest(fom, guest, {
      version: current.version,
      dateOfBirth: "1990-05-01",
    });
    expect(dob.status).toBe(200);
    expect(dob.body.data.dateOfBirth).toBe("1990-05-01");
    expect((await profile(agent, guest)).body.data.dateOfBirth).toBeNull();
    const future = await patchGuest(fom, guest, {
      version: dob.body.data.version,
      dateOfBirth: "2999-01-01",
    });
    expect(future.status).toBe(400);

    // Restriction: reason required, HIGH audit, and the guest can no longer book.
    const noReason = await patchGuest(fom, guest, {
      version: dob.body.data.version,
      isRestricted: true,
      restrictionReason: "Unpaid balance",
    });
    expect(noReason.status).toBe(400);
    const restricted = await patchGuest(fom, guest, {
      version: dob.body.data.version,
      isRestricted: true,
      restrictionReason: "Unpaid balance",
      reason: "Finance request",
    });
    expect(restricted.status).toBe(200);
    const audit = await auditLogsFor(guest);
    const high = audit.find((e) => e.action === "guest.update" && e.risk === "HIGH");
    expect(high).toBeTruthy();
    // The date of birth itself never reaches the audit trail.
    expect(JSON.stringify(audit)).not.toContain("1990-05-01");
    const blocked = await book({
      guestId: guest,
      arrival: addDays(D, 3),
      departure: addDays(D, 4),
    });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.reason).toBe("GUEST_RESTRICTED");
  });

  it("searches by name words, e-mail, phone digits and readable confirmation numbers", async () => {
    const suffix = randomUUID().slice(0, 5);
    const created = await newGuest(agent, {
      firstName: "Zoltan",
      lastName: `Searchable${suffix}`,
      email: `zs.${suffix}@example.com`,
      phone: "+49 (30) 555-0199",
    });
    const id = created.body.data.id as string;
    const find = async (q: string, jar = agent) =>
      (await call(searchRoute, { path: `${G}?q=${encodeURIComponent(q)}`, jar })).body.data.map(
        (g: { id: string }) => g.id,
      );
    expect(await find(`searchable${suffix} zolt`)).toContain(id);
    expect(await find(`zs.${suffix}@EXAMPLE.com`)).toContain(id);
    expect(await find("3055501")).toContain(id);
    const booking = await book({ guestId: id, arrival: addDays(D, 5), departure: addDays(D, 6) });
    const confirmation = booking.body.data.confirmationNumber as string;
    expect(await find(confirmation)).toContain(id);
    // Prefixed numbers (D36) are found by their digits and case-insensitively.
    expect(await find(confirmation.split("-").pop()!)).toContain(id);
    expect(await find(confirmation.toLowerCase())).toContain(id);
    // Property B users cannot find guests through A's confirmation numbers.
    expect(await find(confirmation, gmB)).not.toContain(id);
    // Another organization never sees the profile.
    expect(await find(`searchable${suffix}`, outsider)).toEqual([]);
    expect((await profile(outsider, id)).status).toBe(404);
    expect((await patchGuest(outsider, id, { version: 1, preferredName: "x" })).status).toBe(404);
  });

  it("pages the guest list with a stable keyset cursor", async () => {
    const tag = `Pager${randomUUID().slice(0, 4)}`;
    for (const first of ["Ann", "Ben", "Cid", "Dee", "Eve"]) {
      await createGuestRow(org, first, tag);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const r: {
        status: number;
        body: { data: { firstName: string }[]; meta: { nextCursor: string | null } };
      } = await call(searchRoute, {
        path: `${G}?q=${tag}&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
        jar: agent,
      });
      expect(r.status).toBe(200);
      seen.push(...r.body.data.map((g) => g.firstName));
      cursor = r.body.meta.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["Ann", "Ben", "Cid", "Dee", "Eve"]);
    expect((await call(searchRoute, { path: `${G}?cursor=garbage`, jar: agent })).status).toBe(400);
  });

  it("keeps structured preferences per scope, audited", async () => {
    const guest = (await createGuestRow(org, "Priya", "Prefs")).id;
    const options = (await call(guestOptionsRoute, { path: `${G}/options`, jar: agent })).body.data;
    const highFloor = options.preferenceCodes.find((p: { code: string }) => p.code === "HIGHFLOOR");
    const vegan = options.preferenceCodes.find((p: { code: string }) => p.code === "VEGAN");
    expect(options.properties.map((p: { id: string }) => p.id)).toEqual([A]);
    const put = (body: Record<string, unknown>, jar = agent) =>
      call(preferencesRoute, {
        method: "PUT",
        path: `${G}/${guest}/preferences`,
        params: { guestId: guest },
        body,
        jar,
      });
    const v = (await profile(agent, guest)).body.data.version;
    // Preferences for every property need an organization-scope grant (D3).
    const globalByAgent = await put({
      version: v,
      preferences: [{ preferenceCodeId: highFloor.id, propertyId: null }],
    });
    expect(globalByAgent.status).toBe(403);
    expect(globalByAgent.body.error.details.reason).toBe("ORGANIZATION_SCOPE_REQUIRED");
    const global = await put(
      { version: v, preferences: [{ preferenceCodeId: highFloor.id, propertyId: null }] },
      orgGm,
    );
    expect(global.status).toBe(200);
    expect((await profile(agent, guest)).body.data.access.manageGlobalPreferences).toBe(false);
    // Property staff resend the global preference unchanged and set their own.
    const set = await put({
      version: global.body.data.version,
      preferences: [
        { preferenceCodeId: highFloor.id, propertyId: null },
        { preferenceCodeId: vegan.id, propertyId: A, note: "Strict" },
      ],
    });
    expect(set.status).toBe(200);
    expect(set.body.data.preferences).toHaveLength(2);
    // A property the caller does not manage.
    const foreign = await put({
      version: set.body.data.version,
      preferences: [{ preferenceCodeId: vegan.id, propertyId: B }],
    });
    expect(foreign.status).toBe(403);
    // Each code once per scope; unknown codes are refused.
    const twice = await put({
      version: set.body.data.version,
      preferences: [
        { preferenceCodeId: vegan.id, propertyId: null },
        { preferenceCodeId: vegan.id, propertyId: null },
      ],
    });
    expect(twice.status).toBe(400);
    const unknown = await put({
      version: set.body.data.version,
      preferences: [{ preferenceCodeId: randomUUID(), propertyId: null }],
    });
    expect(unknown.status).toBe(404);
    // B's general manager sees only the global preference.
    const fromB = (await profile(gmB, guest)).body.data;
    expect(
      fromB.preferences.map((p: { preferenceCode: { code: string } }) => p.preferenceCode.code),
    ).toEqual(["HIGHFLOOR"]);
    expect((await auditLogsFor(guest)).map((a) => a.action)).toContain("guest.preferences");
    expect((await put({ version: set.body.data.version, preferences: [] }, auditor)).status).toBe(
      403,
    );
  });

  it("restricts management notes and exposes alerts", async () => {
    const guest = (await createGuestRow(org, "Nadim", "Notes")).id;
    const note = (body: Record<string, unknown>, jar = agent) =>
      call(addNoteRoute, {
        method: "POST",
        path: `${G}/${guest}/notes`,
        params: { guestId: guest },
        body,
        jar,
      });
    expect((await note({ body: "Prefers early check-in", isAlert: true })).status).toBe(201);
    expect((await note({ body: "Credit watch", visibility: "MANAGEMENT" })).status).toBe(403);
    const mgmt = await note({ body: "Credit watch", visibility: "MANAGEMENT" }, fom);
    expect(mgmt.status).toBe(201);
    const byAgent = (await profile(agent, guest)).body.data;
    expect(byAgent.notes.map((n: { body: string }) => n.body)).toEqual(["Prefers early check-in"]);
    expect(byAgent.alerts).toEqual(["Prefers early check-in"]);
    const byFom = (await profile(fom, guest)).body.data;
    expect(byFom.notes).toHaveLength(2);
    // The restricted text is not copied into the audit trail.
    expect(JSON.stringify(await auditLogsFor(guest))).not.toContain("Credit watch");
    const alertId = byAgent.notes[0].id as string;
    const del = await call(deleteNoteRoute, {
      method: "DELETE",
      path: `${G}/${guest}/notes/${alertId}`,
      params: { guestId: guest, noteId: alertId },
      jar: agent,
    });
    expect(del.status).toBe(200);
    expect(del.body.data.alerts).toEqual([]);
    expect((await note({ body: "x" }, auditor)).status).toBe(403);
  });

  it("derives history from reservations, limited to readable properties and billing", async () => {
    const guest = (await createGuestRow(org, "Hana", "History")).id;
    await book({ guestId: guest, arrival: addDays(D, 7), departure: addDays(D, 9) });
    await book({ guestId: guest, arrival: addDays(D, 11), departure: addDays(D, 12) });
    const history = (jar: CookieJar, query = "") =>
      call(historyRoute, {
        path: `${G}/${guest}/history${query}`,
        params: { guestId: guest },
        jar,
      });
    const byGm = await history(gm);
    expect(byGm.status).toBe(200);
    expect(byGm.body.data).toHaveLength(2);
    expect(byGm.body.data[0]).toMatchObject({
      arrival: addDays(D, 11),
      nights: 1,
      status: "RESERVED",
    });
    expect(byGm.body.data[0].roomTotal).not.toBeNull();
    const paged = await history(gm, "?limit=1");
    expect(paged.body.data).toHaveLength(1);
    const next = await history(gm, `?limit=1&cursor=${paged.body.meta.nextCursor}`);
    expect(next.body.data[0].arrival).toBe(addDays(D, 7));
    expect((await history(gm, "?status=CANCELLED")).body.data).toHaveLength(0);
    // Property B's manager may read the profile but not A's reservations.
    expect((await history(gmB)).body.data).toHaveLength(0);
    expect((await history(gmB, `?propertyId=${A}`)).status).toBe(403);
    // Profile statistics use the same scoping.
    expect((await profile(gm, guest)).body.data.statistics.upcoming).toBe(2);
    expect((await profile(gmB, guest)).body.data.statistics.upcoming).toBe(0);
  });
});

describe("companies", () => {
  it("creates, updates and relates companies to guests (one primary contact)", async () => {
    const code = `C${randomUUID().slice(0, 5).toUpperCase()}`;
    const company = await newCompany(code);
    const taken = await call(createAccountRoute, {
      method: "POST",
      path: "/api/v1/accounts",
      body: { code, name: "Again" },
      jar: fom,
    });
    expect(taken.status).toBe(409);
    expect(
      (
        await call(createAccountRoute, {
          method: "POST",
          path: "/api/v1/accounts",
          body: { code: "NOPE", name: "x" },
          jar: agent,
        })
      ).status,
    ).toBe(403);

    const patch = (body: Record<string, unknown>, jar = fom) =>
      call(updateAccountRoute, {
        method: "PATCH",
        path: `/api/v1/accounts/${company.id}`,
        params: { accountId: company.id },
        body,
        jar,
      });
    const updated = await patch({ version: company.version, city: "Lahore", countryCode: "pk" });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ city: "Lahore", countryCode: "PK" });
    expect((await patch({ version: company.version, city: "X" })).status).toBe(409);
    expect((await patch({ version: updated.body.data.version, status: "INACTIVE" })).status).toBe(
      400,
    );

    const g1 = (await createGuestRow(org, "Omar", "Employee")).id;
    const g2 = (await createGuestRow(org, "Lina", "Contact")).id;
    const relate = (guestId: string, body: Record<string, unknown>, jar = fom) =>
      call(contactRoute, {
        method: "PUT",
        path: `/api/v1/accounts/${company.id}/contacts/${guestId}`,
        params: { accountId: company.id, guestId },
        body,
        jar,
      });
    expect((await relate(g1, { kind: "EMPLOYEE", role: "CFO", isPrimary: true })).status).toBe(200);
    const second = await relate(g2, { kind: "CONTACT", isPrimary: true });
    expect(second.status).toBe(200);
    const primaries = second.body.data.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primaries.map((c: { guest: { id: string } }) => c.guest.id)).toEqual([g2]);
    // Re-relating updates the one row: no duplicate relationship.
    const again = await relate(g1, { kind: "ASSOCIATE" });
    expect(again.body.data.contacts).toHaveLength(2);
    expect(await prisma.accountContact.count({ where: { accountProfileId: company.id } })).toBe(2);
    // The guest profile shows the relationship.
    const guestView = (await profile(agent, g1)).body.data;
    expect(guestView.companies[0]).toMatchObject({
      kind: "ASSOCIATE",
      account: { id: company.id },
    });
    // Cashiers read companies but not loyalty.
    expect((await profile(cashier, g1)).body.data.loyalty).toBeNull();
    const removed = await call(removeContactRoute, {
      method: "DELETE",
      path: `/api/v1/accounts/${company.id}/contacts/${g1}`,
      params: { accountId: company.id, guestId: g1 },
      jar: fom,
    });
    expect(removed.body.data.contacts).toHaveLength(1);
    const actions = (await auditLogsFor(company.id)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "account.create",
        "account.update",
        "account.contact_add",
        "account.contact_update",
        "account.contact_remove",
      ]),
    );
    // Listing and isolation.
    const list = await call(accountsRoute, {
      path: `/api/v1/accounts?q=company ${code}`,
      jar: agent,
    });
    expect(list.body.data.map((a: { id: string }) => a.id)).toContain(company.id);
    const read = (jar: CookieJar) =>
      call(accountRoute, {
        path: `/api/v1/accounts/${company.id}`,
        params: { accountId: company.id },
        jar,
      });
    expect((await read(outsider)).status).toBe(404);
    expect((await read(auditor)).status).toBe(200);
    expect((await relate(g1, { kind: "CONTACT" }, auditor)).status).toBe(403);
  });

  it("books for a company with a validated contact and its negotiated rate only", async () => {
    const company = await newCompany(`N${randomUUID().slice(0, 5).toUpperCase()}`);
    const rival = await newCompany(`R${randomUUID().slice(0, 5).toUpperCase()}`);
    const booker = (await createGuestRow(org, "Bea", "Booker")).id;
    const stranger = (await createGuestRow(org, "Sam", "Stranger")).id;
    const traveller = (await createGuestRow(org, "Tom", "Traveller")).id;
    await call(contactRoute, {
      method: "PUT",
      path: `/api/v1/accounts/${company.id}/contacts/${booker}`,
      params: { accountId: company.id, guestId: booker },
      body: { kind: "CONTACT" },
      jar: fom,
    });
    const corp = inv.ratePlans.CORP!;
    const arrival = addDays(D, 20);
    const departure = addDays(D, 22);
    const quote = async (companyId?: string) => {
      const r = await call(availabilityRoute, {
        path: `${P(A)}/availability?arrival=${arrival}&departure=${departure}&adults=1&roomTypeId=${KNG()}${companyId ? `&companyId=${companyId}` : ""}`,
        params: { propertyId: A },
        jar: gm,
      });
      expect(r.status).toBe(200);
      return r.body.data.roomTypes[0].rates as { ratePlan: { code: string }; total: string }[];
    };
    // Not linked yet: never offered, not even with the company.
    expect((await quote()).map((r) => r.ratePlan.code)).not.toContain("CORP");
    expect((await quote(company.id)).map((r) => r.ratePlan.code)).not.toContain("CORP");

    const plan = await prisma.ratePlan.findUniqueOrThrow({
      where: { id: corp },
      select: { version: true },
    });
    const link = await call(planAccountsRoute, {
      method: "PUT",
      path: `${P(A)}/rate-plans/${corp}/accounts`,
      params: { propertyId: A, ratePlanId: corp },
      body: {
        version: plan.version,
        accounts: [{ accountProfileId: company.id, validFrom: D, validTo: addDays(D, 60) }],
        reason: "Corporate contract",
      },
      jar: gm,
    });
    expect(link.status).toBe(200);
    expect(link.body.data.negotiated[0].account.id).toBe(company.id);
    const withCompany = await quote(company.id);
    const corpQuote = withCompany.find((r) => r.ratePlan.code === "CORP");
    const bar = withCompany.find((r) => r.ratePlan.code === "BAR")!;
    expect(corpQuote).toBeTruthy();
    // BAR −12% on the same nights (rounded to whole units by the plan).
    expect(Number(corpQuote!.total)).toBeLessThan(Number(bar.total));
    expect((await quote()).map((r) => r.ratePlan.code)).not.toContain("CORP");
    expect((await quote(rival.id)).map((r) => r.ratePlan.code)).not.toContain("CORP");

    // Public booking at the negotiated rate is refused; with the company it works.
    const publicTry = await book({ guestId: traveller, arrival, departure, ratePlanId: corp });
    expect(publicTry.status).toBe(422);
    expect(publicTry.body.error.details.reason).toBe("RATE_NOT_SELLABLE");
    const notContact = await book({
      guestId: traveller,
      arrival,
      departure,
      ratePlanId: corp,
      companyId: company.id,
      bookerGuestId: stranger,
    });
    expect(notContact.status).toBe(422);
    expect(notContact.body.error.details.reason).toBe("NOT_COMPANY_CONTACT");
    const booked = await book({
      guestId: traveller,
      arrival,
      departure,
      ratePlanId: corp,
      companyId: company.id,
      bookerGuestId: booker,
    });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const reservationId = booked.body.data.id as string;
    const detail = (jar = gm) =>
      call(reservationRoute, {
        path: `${P(A)}/reservations/${reservationId}`,
        params: { propertyId: A, reservationId },
        jar,
      });
    const d1 = (await detail()).body.data;
    expect(d1.company).toMatchObject({ id: company.id });
    expect(d1.booker.id).toBe(booker);
    expect(d1.rooms[0].totalAmount).toBe(corpQuote!.total);

    const setCompany = (body: Record<string, unknown>) =>
      call(reservationCompanyRoute, {
        method: "PUT",
        path: `${P(A)}/reservations/${reservationId}/company`,
        params: { propertyId: A, reservationId },
        body,
        jar: gm,
      });
    // The negotiated rate belongs to the company: switching or clearing is refused.
    const toRival = await setCompany({ version: d1.version, companyId: rival.id });
    expect(toRival.status).toBe(422);
    expect(toRival.body.error.details.reason).toBe("RATE_REQUIRES_COMPANY");
    expect((await setCompany({ version: d1.version, companyId: null })).status).toBe(422);
    expect((await setCompany({ version: d1.version + 5, companyId: company.id })).status).toBe(409);

    // A BAR booking can change company freely; restricted companies cannot book.
    const barBooking = await book({
      guestId: traveller,
      arrival: addDays(D, 30),
      departure: addDays(D, 31),
    });
    const barId = barBooking.body.data.id as string;
    const barVersion = (
      await call(reservationRoute, {
        path: `${P(A)}/reservations/${barId}`,
        params: { propertyId: A, reservationId: barId },
        jar: gm,
      })
    ).body.data.version;
    const switched = await call(reservationCompanyRoute, {
      method: "PUT",
      path: `${P(A)}/reservations/${barId}/company`,
      params: { propertyId: A, reservationId: barId },
      body: { version: barVersion, companyId: rival.id },
      jar: gm,
    });
    expect(switched.status).toBe(200);
    expect(switched.body.data.company.id).toBe(rival.id);
    await prisma.accountProfile.update({
      where: { id: rival.id },
      data: { isRestricted: true, restrictionReason: "Credit hold" },
    });
    const restricted = await book({
      guestId: traveller,
      arrival: addDays(D, 32),
      departure: addDays(D, 33),
      companyId: rival.id,
    });
    expect(restricted.status).toBe(422);
    expect(restricted.body.error.details.reason).toBe("COMPANY_RESTRICTED");
    // A company of another organization does not exist here.
    const foreign = await prisma.accountProfile.create({
      data: {
        organizationId: other.organizationId,
        type: "COMPANY",
        code: "FOREIGN",
        name: "Foreign Co",
        searchName: "foreign co",
      },
      select: { id: true },
    });
    const foreignTry = await book({
      guestId: traveller,
      arrival: addDays(D, 34),
      departure: addDays(D, 35),
      companyId: foreign.id,
    });
    expect(foreignTry.status).toBe(404);
  });

  it("keeps negotiated plans private by construction", async () => {
    const created = await call(createPlanRoute, {
      method: "POST",
      path: `${P(A)}/rate-plans`,
      params: { propertyId: A },
      body: {
        code: `NG${randomUUID().slice(0, 4)}`,
        name: "Negotiated",
        kind: "NEGOTIATED",
        taxInclusive: false,
        roomTransactionCodeId: inv.chargeCodes["1000"],
        derivation: { parentRatePlanId: inv.ratePlans.BAR, type: "PERCENT", value: "-5" },
        roomTypeIds: [KNG()],
        reason: "Contract",
      },
      jar: gm,
    });
    expect(created.status).toBe(400);
    const plain = await call(createPlanRoute, {
      method: "POST",
      path: `${P(A)}/rate-plans`,
      params: { propertyId: A },
      body: {
        code: `PL${randomUUID().slice(0, 4)}`,
        name: "Public",
        kind: "CORPORATE",
        taxInclusive: false,
        roomTransactionCodeId: inv.chargeCodes["1000"],
        derivation: { parentRatePlanId: inv.ratePlans.BAR, type: "PERCENT", value: "-5" },
        roomTypeIds: [KNG()],
        reason: "Contract",
      },
      jar: gm,
    });
    expect(plain.status).toBe(201);
    const company = await newCompany(`P${randomUUID().slice(0, 5).toUpperCase()}`);
    const link = await call(planAccountsRoute, {
      method: "PUT",
      path: `${P(A)}/rate-plans/${plain.body.data.id}/accounts`,
      params: { propertyId: A, ratePlanId: plain.body.data.id },
      body: {
        version: plain.body.data.version,
        accounts: [{ accountProfileId: company.id }],
        reason: "x-y-z",
      },
      jar: gm,
    });
    expect(link.status).toBe(422);
    expect(link.body.error.details.reason).toBe("PLAN_NOT_NEGOTIATED");
  });
});

describe("loyalty", () => {
  let programId: string;
  let tiers: Record<string, string>;

  beforeAll(async () => {
    const noReason = await call(createProgramRoute, {
      method: "POST",
      path: "/api/v1/loyalty/programs",
      body: { code: "RWD", name: "Rewards" },
      jar: gm,
    });
    expect(noReason.status).toBe(400);
    // Programs are organization data (D3): a property-scoped grant is not enough.
    const byPropertyGm = await call(createProgramRoute, {
      method: "POST",
      path: "/api/v1/loyalty/programs",
      body: { code: "RWD", name: "Rewards", reason: "Launch" },
      jar: gm,
    });
    expect(byPropertyGm.status).toBe(403);
    expect(byPropertyGm.body.error.details.reason).toBe("ORGANIZATION_SCOPE_REQUIRED");
    const created = await call(createProgramRoute, {
      method: "POST",
      path: "/api/v1/loyalty/programs",
      body: { code: "RWD", name: "Rewards", reason: "Launch" },
      jar: orgGm,
    });
    expect(created.status).toBe(201);
    programId = created.body.data.programs.find((p: { code: string }) => p.code === "RWD").id;
    for (const [code, rank] of [
      ["SILVER", 1],
      ["GOLD", 2],
    ] as const) {
      const r = await call(createTierRoute, {
        method: "POST",
        path: `/api/v1/loyalty/programs/${programId}/tiers`,
        params: { programId },
        body: { code, name: code, rank, qualifyingNights: rank * 10, reason: "Launch" },
        jar: orgGm,
      });
      expect(r.status).toBe(201);
    }
    const overview = await call(programsRoute, { path: "/api/v1/loyalty/programs", jar: agent });
    tiers = Object.fromEntries(
      overview.body.data.programs
        .find((p: { id: string }) => p.id === programId)
        .tiers.map((t: { code: string; id: string }) => [t.code, t.id]),
    );
    expect(overview.body.data.actions.manage).toBe(false);
  });

  const enroll = (guestId: string, body: Record<string, unknown>, jar = gm) =>
    call(enrollRoute, {
      method: "POST",
      path: `${G}/${guestId}/loyalty`,
      params: { guestId },
      body: { programId, reason: "Front desk enrollment", ...body },
      jar,
    });

  it("enrolls once, even when two requests race", async () => {
    const guest = (await createGuestRow(org, "Lou", "Loyal")).id;
    const [a, b] = await Promise.all([
      enroll(guest, { tierId: tiers.SILVER }),
      enroll(guest, { tierId: tiers.SILVER }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.details.reason).toBe("ALREADY_ENROLLED");
    const view = (await profile(agent, guest)).body.data;
    expect(view.loyalty).toHaveLength(1);
    expect(view.loyalty[0]).toMatchObject({
      tier: { code: "SILVER" },
      status: "ACTIVE",
      pointsBalance: "0",
    });
    expect(view.loyalty[0].membershipNumber).toMatch(/^RWD\d{7}$/);
    expect(view.loyalty[0].changes[0]).toMatchObject({ type: "ENROLLED", toTier: "SILVER" });
    expect((await enroll(guest, {}, fom)).status).toBe(403);
    expect((await enroll(guest, {}, agent)).status).toBe(403);
  });

  it("changes tier and status with history, and adjusts whole points only", async () => {
    const guest = (await createGuestRow(org, "Max", "Member")).id;
    const enrolled = await enroll(guest, { tierId: tiers.SILVER });
    const m = enrolled.body.data.loyalty[0];
    const change = (body: Record<string, unknown>, jar = orgGm) =>
      call(membershipRoute, {
        method: "PATCH",
        path: `/api/v1/loyalty/memberships/${m.id}`,
        params: { membershipId: m.id },
        body: { reason: "Status review", ...body },
        jar,
      });
    // Tier/status changes and points need organization scope (D3).
    expect((await change({ version: m.version, tierId: tiers.GOLD }, gm)).status).toBe(403);
    const upgraded = await change({ version: m.version, tierId: tiers.GOLD });
    expect(upgraded.status).toBe(200);
    const after = upgraded.body.data.loyalty[0];
    expect(after.tier.code).toBe("GOLD");
    expect(after.changes[0]).toMatchObject({
      type: "TIER_CHANGED",
      fromTier: "SILVER",
      toTier: "GOLD",
    });
    expect((await change({ version: m.version, tierId: tiers.SILVER })).status).toBe(409);
    // A tier of another program is refused.
    const otherProgram = await prisma.loyaltyProgram.create({
      data: {
        organizationId: org.organizationId,
        code: `OT${randomUUID().slice(0, 4)}`,
        name: "Other",
      },
      select: { id: true },
    });
    const foreignTier = await prisma.loyaltyTier.create({
      data: { programId: otherProgram.id, code: "X", name: "X" },
      select: { id: true },
    });
    const wrongTier = await change({ version: after.version, tierId: foreignTier.id });
    expect(wrongTier.status).toBe(422);
    // The database refuses it too.
    await expect(
      prisma.loyaltyMembership.update({ where: { id: m.id }, data: { tierId: foreignTier.id } }),
    ).rejects.toThrow();

    const adjust = (body: Record<string, unknown>, jar = orgGm) =>
      call(adjustRoute, {
        method: "POST",
        path: `/api/v1/loyalty/memberships/${m.id}/adjustments`,
        params: { membershipId: m.id },
        body: { description: "Goodwill", reason: "Service recovery", ...body },
        jar,
      });
    expect((await adjust({ version: after.version, points: "500" }, gm)).status).toBe(403);
    const plus = await adjust({ version: after.version, points: "500" });
    expect(plus.status).toBe(201);
    const afterPlus = plus.body.data.loyalty[0];
    expect(afterPlus.pointsBalance).toBe("500");
    // A retried request with the same version cannot apply twice.
    expect((await adjust({ version: after.version, points: "500" })).status).toBe(409);
    const tooMuch = await adjust({ version: afterPlus.version, points: "-600" });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error.details.reason).toBe("INSUFFICIENT_POINTS");
    expect((await adjust({ version: afterPlus.version, points: "12.5" })).status).toBe(400);
    const minus = await adjust({ version: afterPlus.version, points: "-200" });
    expect(minus.body.data.loyalty[0].pointsBalance).toBe("300");
    expect(
      minus.body.data.loyalty[0].transactions.map((t: { points: string }) => t.points),
    ).toEqual(["-200", "500"]);
    // Deactivation is recorded; the ledger and history are append-only.
    const inactive = await change({
      version: minus.body.data.loyalty[0].version,
      status: "INACTIVE",
    });
    expect(inactive.body.data.loyalty[0].changes[0]).toMatchObject({
      type: "STATUS_CHANGED",
      fromStatus: "ACTIVE",
      toStatus: "INACTIVE",
    });
    await expect(
      prisma.$executeRaw`UPDATE loyalty_transactions SET points = 1 WHERE membership_id = ${m.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`DELETE FROM loyalty_membership_changes WHERE membership_id = ${m.id}::uuid`,
    ).rejects.toThrow();
    const audit = (await auditLogsFor(m.id)).filter((a) => a.risk === "HIGH").map((a) => a.action);
    expect(audit).toEqual(
      expect.arrayContaining([
        "loyalty.enroll",
        "loyalty.membership_change",
        "loyalty.points_adjust",
      ]),
    );
    // Other organizations cannot touch the membership.
    const outside = await call(membershipRoute, {
      method: "PATCH",
      path: `/api/v1/loyalty/memberships/${m.id}`,
      params: { membershipId: m.id },
      body: { version: 1, status: "ACTIVE", reason: "Hijack" },
      jar: outsider,
    });
    expect([403, 404]).toContain(outside.status);
  });

  it("shows loyalty only with loyalty:read and never lets read-only users change it", async () => {
    const guest = (await createGuestRow(org, "Rae", "Readonly")).id;
    const enrolled = await enroll(guest, {});
    const m = enrolled.body.data.loyalty[0];
    const asAuditor = (await profile(auditor, guest)).body.data;
    expect(asAuditor.loyalty).toHaveLength(1);
    expect(asAuditor.access).toMatchObject({ update: false, manageLoyalty: false });
    expect(asAuditor.history).not.toBeNull();
    expect((await profile(cashier, guest)).body.data.history).toBeNull();
    const before = await prisma.loyaltyMembership.findUniqueOrThrow({ where: { id: m.id } });
    const attempts = await Promise.all([
      call(membershipRoute, {
        method: "PATCH",
        path: `/api/v1/loyalty/memberships/${m.id}`,
        params: { membershipId: m.id },
        body: { version: m.version, status: "INACTIVE", reason: "x-y-z" },
        jar: auditor,
      }),
      call(adjustRoute, {
        method: "POST",
        path: `/api/v1/loyalty/memberships/${m.id}/adjustments`,
        params: { membershipId: m.id },
        body: { version: m.version, points: "100", description: "x-y-z", reason: "x-y-z" },
        jar: auditor,
      }),
      call(createProgramRoute, {
        method: "POST",
        path: "/api/v1/loyalty/programs",
        body: { code: "HACK", name: "x", reason: "x-y-z" },
        jar: auditor,
      }),
      patchGuest(auditor, guest, { version: 1, preferredName: "x" }),
    ]);
    expect(attempts.map((a) => a.status)).toEqual([403, 403, 403, 403]);
    expect(await prisma.loyaltyMembership.findUniqueOrThrow({ where: { id: m.id } })).toEqual(
      before,
    );
  });
});
