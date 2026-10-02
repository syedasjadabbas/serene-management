import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as searchRoute } from "@/app/api/v1/guests/route";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db/prisma";
import {
  type GuestSearchTerms,
  guestSummarySelect,
  searchGuests,
} from "@/modules/guests/guests.repository";
import { guestSearchName, normalizeName, phoneDigits } from "@/modules/guests/guests.policy";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  createCustomUser,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

/**
 * Guest search (scalability phase 8, docs/SCALABILITY.md §36). The search
 * statement was rewritten (a capped candidate pass, a bounded name-order
 * window, then every match by branch). The previous statement is kept here
 * as the oracle and every page of many searches is compared, with the cap
 * and window shrunk so all three steps run on small data.
 * Then: isolation, permissions and the response contract through the API.
 */

type Handler = typeof searchRoute;
type After = { lastName: string; firstName: string; id: string } | null;

/** The statement before phase 8 (verbatim logic), the oracle. */
function previousSearch(
  tx: Tx,
  organizationId: string,
  status: "ACTIVE" | "INACTIVE",
  terms: GuestSearchTerms | null,
  after: After,
  limit: number,
) {
  const and: Prisma.GuestWhereInput[] = [{ organizationId, status, deletedAt: null }];
  if (terms) {
    const or: Prisma.GuestWhereInput[] = [];
    if (terms.nameTokens.length > 0) {
      or.push({ AND: terms.nameTokens.map((token) => ({ searchName: { contains: token } })) });
    }
    if (terms.raw.includes("@")) {
      const email = terms.raw.toLowerCase();
      or.push({ primaryEmail: email });
      or.push({ contacts: { some: { type: "EMAIL", value: email } } });
    }
    if (terms.digits.length >= 4) or.push({ phoneDigits: { contains: terms.digits } });
    or.push({ profileNumber: terms.raw.toUpperCase() });
    if (terms.confirmationGuestIds.length > 0) or.push({ id: { in: terms.confirmationGuestIds } });
    and.push({ OR: or });
  }
  if (after) {
    and.push({
      OR: [
        { lastName: { gt: after.lastName } },
        { lastName: after.lastName, firstName: { gt: after.firstName } },
        { lastName: after.lastName, firstName: after.firstName, id: { gt: after.id } },
      ],
    });
  }
  return tx.guest.findMany({
    where: { AND: and },
    select: guestSummarySelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    take: limit,
  });
}

const termsOf = (q: string, ids: string[] = []): GuestSearchTerms => ({
  nameTokens: normalizeName(q).split(" ").filter(Boolean).slice(0, 5),
  raw: q,
  digits: q.replace(/\D/g, ""),
  confirmationGuestIds: ids,
});

let org: FixtureOrg;
let other: FixtureOrg;
let vipId: string;
const ids: Record<string, string> = {};
const zamans: string[] = [];
let seq = 0;

async function guest(
  o: FixtureOrg,
  firstName: string,
  lastName: string,
  extra: Partial<Prisma.GuestUncheckedCreateInput> & { contactEmail?: string } = {},
) {
  const { contactEmail, ...data } = extra;
  seq += 1;
  const row = await prisma.guest.create({
    data: {
      organizationId: o.organizationId,
      profileNumber: `GS${o.suffix}${String(seq).padStart(4, "0")}`.slice(0, 20),
      firstName,
      lastName,
      searchName: guestSearchName(firstName, lastName),
      ...data,
    },
    select: { id: true },
  });
  if (contactEmail) {
    await prisma.guestContact.create({
      data: { guestId: row.id, type: "EMAIL", value: contactEmail },
    });
  }
  return row.id;
}

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: [
      { key: "A", timezone: "Asia/Karachi" },
      { key: "B", timezone: "Asia/Karachi" },
      { key: "OFF", timezone: "Asia/Karachi" },
    ],
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  vipId = (
    await prisma.vipLevel.create({
      data: { organizationId: org.organizationId, code: "GLD", name: "Gold" },
      select: { id: true },
    })
  ).id;
  // Shared surnames cluster in name order (as in real data); several pages each.
  const firsts = [
    "Aisha",
    "Bilal",
    "Hamza",
    "Hina",
    "Omar",
    "Sara",
    "Usman",
    "Zara",
    "Ali",
    "Noor",
  ];
  for (const last of ["Ahmed", "Khan", "Malik", "Zaman"]) {
    for (const first of firsts) {
      const id = await guest(org, first, last);
      if (last === "Zaman") zamans.push(id);
    }
    for (const first of firsts.slice(0, 3)) await guest(org, first, last); // same names twice
  }
  for (let i = 0; i < 40; i++) await guest(org, `Filler${i}`, `Babar${String(i).padStart(2, "0")}`);
  ids.vip = await guest(org, "Vera", "Khan", {
    vipLevelId: vipId,
    isRestricted: true,
    title: "Dr",
  });
  ids.accented = await guest(org, "Ávila", "Núñez");
  ids.apostrophe = await guest(org, "Sean", "O'Brien");
  ids.email = await guest(org, "Mail", "Person", { primaryEmail: "mail.person@example.test" });
  ids.contact = await guest(org, "Listed", "Contact", { contactEmail: "listed@example.test" });
  // Matches two branches at once (primary and listed e-mail): must appear once.
  ids.both = await guest(org, "Both", "Mailer", {
    primaryEmail: "both@example.test",
    contactEmail: "both@example.test",
  });
  ids.phone = await guest(org, "Phone", "Holder", {
    primaryPhone: "+92 300 7654321",
    phoneDigits: phoneDigits("+92 300 7654321"),
  });
  ids.inactive = await guest(org, "Hamza", "Khan", { status: "INACTIVE" });
  ids.deleted = await guest(org, "Deleted", "Khan", { deletedAt: new Date() });
  // Another organization: same names, same e-mail as a listed contact here.
  ids.otherKhan = await guest(other, "Aisha", "Khan");
  ids.otherMail = await guest(other, "Other", "Mail", { primaryEmail: "listed@example.test" });
}, 120_000);

describe("result equivalence with the previous statement", () => {
  it("returns the same pages for every search, window size, status and page size", async () => {
    const searches: [string, GuestSearchTerms][] = [
      ...["khan", "ahmed", "malik", "zaman", "aisha", "zara", "noor", "babar", "filler1"].map(
        (q) => [q, termsOf(q)] as [string, GuestSearchTerms],
      ),
      ...["kh", "za", "ma", "ah", "an", "o'", "zz"].map(
        (q) => [q, termsOf(q)] as [string, GuestSearchTerms],
      ),
      ["two words", termsOf("aisha khan")],
      ["reversed words", termsOf("khan hina")],
      ["three words", termsOf("noor khan ahmed")],
      ["accented", termsOf("NUNEZ ávila")],
      ["apostrophe", termsOf("o'brien")],
      ["no match", termsOf("nobody-here")],
      ["profile number", termsOf(`GS${org.suffix}0005`.toLowerCase())],
      ["primary e-mail", termsOf("MAIL.person@example.test")],
      ["listed e-mail", termsOf("listed@example.test")],
      ["phone digits", termsOf("7654321")],
      ["short digits", termsOf("765")],
      ["confirmation ids", termsOf("100001", [ids.vip!, ids.accented!, ids.inactive!])],
      ["confirmation ids + name", termsOf("zaman", [ids.vip!, ids.otherKhan!])],
      // The same guests through two branches (name and confirmation ids; both e-mails).
      ["overlapping branches", termsOf("zaman", zamans.slice(0, 6))],
      ["primary and listed e-mail", termsOf("both@example.test")],
    ];
    let pages = 0;
    for (const [label, terms] of searches) {
      for (const status of ["ACTIVE", "INACTIVE"] as const) {
        for (const limit of [2, 4, 11]) {
          for (const [window, cap] of [
            [1, 0],
            [3, 2],
            [7, 1_000],
            [25, 5],
            [3_000, 1],
            [3_000, 1_000],
            [1, 1_000],
          ] as const) {
            let after: After = null;
            for (let page = 0; page < 40; page++) {
              const expected = await previousSearch(
                prisma,
                org.organizationId,
                status,
                terms,
                after,
                limit,
              );
              const actual = await searchGuests(
                prisma,
                org.organizationId,
                status,
                terms,
                after,
                limit,
                { window, cap },
              );
              pages += 1;
              expect(
                actual,
                `${label} ${status} limit ${limit} window ${window} cap ${cap} page ${page}`,
              ).toEqual(expected);
              if (expected.length < limit) break;
              const last = expected[limit - 2]!;
              after = { lastName: last.lastName, firstName: last.firstName, id: last.id };
            }
          }
        }
      }
    }
    expect(pages).toBeGreaterThan(1_000);
  }, 300_000);

  it("keeps the list without search terms unchanged", async () => {
    let after: After = null;
    for (let page = 0; page < 30; page++) {
      const expected = await previousSearch(prisma, org.organizationId, "ACTIVE", null, after, 9);
      expect(await searchGuests(prisma, org.organizationId, "ACTIVE", null, after, 9)).toEqual(
        expected,
      );
      if (expected.length < 9) break;
      const last = expected[7]!;
      after = { lastName: last.lastName, firstName: last.firstName, id: last.id };
    }
  });

  it("never returns another organization's, inactive or deleted guests", async () => {
    for (const sizes of [{ window: 1, cap: 0 }, { window: 3_000, cap: 0 }, { cap: 1_000 }]) {
      const khan = await searchGuests(
        prisma,
        org.organizationId,
        "ACTIVE",
        termsOf("khan"),
        null,
        200,
        sizes,
      );
      const found = new Set(khan.map((g) => g.id));
      expect(found.has(ids.otherKhan!)).toBe(false);
      expect(found.has(ids.inactive!)).toBe(false);
      expect(found.has(ids.deleted!)).toBe(false);
      expect(found.has(ids.vip!)).toBe(true);
      // The other organization's guest with the same e-mail is not this organization's.
      const mail = await searchGuests(
        prisma,
        org.organizationId,
        "ACTIVE",
        termsOf("listed@example.test"),
        null,
        11,
        sizes,
      );
      expect(mail.map((g) => g.id)).toEqual([ids.contact]);
      // Confirmation ids of another organization's guest are ignored.
      const conf = await searchGuests(
        prisma,
        org.organizationId,
        "ACTIVE",
        termsOf("100001", [ids.otherKhan!]),
        null,
        11,
        sizes,
      );
      expect(conf).toEqual([]);
    }
  });
});

describe("guest search through the API", () => {
  let gm: CookieJar;
  let agentA: CookieJar;
  let housekeeper: CookieJar;
  let outsider: CookieJar;
  let splitUser: CookieJar;
  const find = async (jar: CookieJar, q: string, extra = "") =>
    call(searchRoute as Handler, {
      path: `/api/v1/guests?q=${encodeURIComponent(q)}${extra}`,
      jar,
    });

  beforeAll(async () => {
    await prisma.property.update({
      where: { id: org.properties.OFF!.id },
      data: { status: "INACTIVE" },
    });
    gm = await loginAs(
      (await createUser(org, "gs-gm", [{ role: "GENERAL_MANAGER" }])).email,
      TEST_PASSWORD,
    );
    agentA = await loginAs(
      (await createUser(org, "gs-agent", [{ role: "FRONT_DESK_AGENT", property: "A" }])).email,
      TEST_PASSWORD,
    );
    housekeeper = await loginAs(
      (await createUser(org, "gs-hk", [{ role: "HOUSEKEEPER", property: "A" }])).email,
      TEST_PASSWORD,
    );
    outsider = await loginAs(
      (await createUser(other, "gs-out", [{ role: "GENERAL_MANAGER" }])).email,
      TEST_PASSWORD,
    );
    // guests:read at B only, nothing at A.
    splitUser = await loginAs(
      (await createCustomUser(org, "gs-split", [{ permissions: ["guests:read"], property: "B" }]))
        .email,
      TEST_PASSWORD,
    );
  });

  it("answers organization users, single-property users and split permissions alike", async () => {
    for (const jar of [gm, agentA, splitUser]) {
      const r = await find(jar, "khan", "&limit=50");
      expect(r.status).toBe(200);
      const got = r.body.data.map((g: { id: string }) => g.id);
      expect(got).toContain(ids.vip);
      expect(got).not.toContain(ids.otherKhan);
      expect(got).not.toContain(ids.inactive);
    }
  });

  it("refuses users without guests:read and never shows another organization", async () => {
    expect((await find(housekeeper, "khan")).status).toBe(403);
    const r = await find(outsider, "khan", "&limit=50");
    expect(r.status).toBe(200);
    expect(r.body.data.map((g: { id: string }) => g.id)).toEqual([ids.otherKhan]);
  });

  it("keeps the response contract (fields, order, cursor pages)", async () => {
    const r = await find(gm, "vera khan");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([
      {
        id: ids.vip,
        profileNumber: expect.any(String),
        title: "Dr",
        firstName: "Vera",
        lastName: "Khan",
        fullName: "Dr Vera Khan",
        email: null,
        phone: null,
        nationalityCode: null,
        vip: { code: "GLD", name: "Gold" },
        isRestricted: true,
      },
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const p: {
        status: number;
        body: { data: { id: string }[]; meta: { nextCursor: string | null } };
      } = await find(gm, "khan", `&limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      expect(p.status).toBe(200);
      seen.push(...p.body.data.map((g) => g.id));
      cursor = p.body.meta.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(14); // 13 Khans + Dr Vera Khan; inactive and deleted excluded
    const empty = await find(gm, "nobody-at-all");
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta.nextCursor).toBeNull();
  });

  it("validates input as before", async () => {
    expect((await find(gm, "k")).status).toBe(400);
    expect((await find(gm, "khan", "&cursor=garbage")).status).toBe(400);
    expect((await find(gm, "khan", `&limit=${randomUUID().length + 100}`)).status).toBe(400);
  });
});
