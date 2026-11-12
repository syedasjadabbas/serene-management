import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/config/prisma";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { REFRESH_COOKIE, Session, call, loginAs, route } from "./support/http";

const meRoute = route("GET", "/me");
const mePatch = route("PATCH", "/me");
const avatarGet = route("GET", "/me/avatar");
const avatarPut = route("PUT", "/me/avatar");
const avatarDelete = route("DELETE", "/me/avatar");

/**
 * Self-service profile: display name (PATCH /me) and profile picture
 * (/me/avatar). The picture is stored server-side, so it survives signing
 * out and in again; only its owner can read or change it; the server checks
 * the image signature and size, and every change is audited without bytes.
 */

// Smallest valid images of each type (signature + minimal body).
const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

let org: FixtureOrg;
let alice: { id: string; email: string };
let bob: { id: string; email: string };
let aliceJar: Session;
let bobJar: Session;

const me = (jar: Session) => call(meRoute, { jar });
const getAvatar = (jar: Session) => call(avatarGet, { jar });
const putAvatar = (jar: Session, body: unknown) => call(avatarPut, { jar, body });
const deleteAvatar = (jar: Session) => call(avatarDelete, { jar });

async function auditActions(userId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { resourceType: "User", resourceId: userId, action: { startsWith: "user." } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true, before: true, after: true },
  });
  return rows;
}

beforeAll(async () => {
  org = await createFixtureOrg({ properties: [{ key: "A", timezone: "Asia/Karachi" }] });
  alice = await createUser(org, "alice-profile", [{ role: "FRONT_DESK_AGENT", property: "A" }]);
  bob = await createUser(org, "bob-profile", [{ role: "HOUSEKEEPER", property: "A" }]);
  aliceJar = await loginAs(alice.email, TEST_PASSWORD);
  bobJar = await loginAs(bob.email, TEST_PASSWORD);
});

describe("profile picture", () => {
  it("starts without a picture", async () => {
    expect((await me(aliceJar)).body.data.user.avatarUrl).toBeNull();
    expect((await getAvatar(aliceJar)).status).toBe(404);
  });

  it("stores a picture that survives signing out and in again", async () => {
    const saved = await putAvatar(aliceJar, { contentType: "image/png", data: PNG_1PX });
    expect(saved.status).toBe(200);
    expect(saved.body.data.avatarUrl).toMatch(/^\/api\/v1\/me\/avatar\?v=\d+$/);

    // Signing in again replaces the earlier web session (one per platform).
    const fresh = await loginAs(alice.email, TEST_PASSWORD);
    aliceJar = fresh;
    const view = await me(fresh);
    expect(view.body.data.user.avatarUrl).toBe(saved.body.data.avatarUrl);

    const image = await getAvatar(fresh);
    expect(image.status).toBe(200);
    expect(image.response.headers.get("content-type")).toBe("image/png");
    expect(image.response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.response.headers.get("content-length")).toBe(
      String(Buffer.from(PNG_1PX, "base64").byteLength),
    );
  });

  it("keeps each user's picture private to them", async () => {
    // Bob has none, and there is no way to address Alice's picture.
    expect((await getAvatar(bobJar)).status).toBe(404);
    expect((await me(bobJar)).body.data.user.avatarUrl).toBeNull();
  });

  it("rejects files whose signature does not match, unsupported types and oversize images", async () => {
    const mismatch = await putAvatar(aliceJar, {
      contentType: "image/jpeg",
      data: PNG_1PX,
    });
    expect(mismatch.status).toBe(400);
    const html = await putAvatar(aliceJar, {
      contentType: "image/png",
      data: Buffer.from("<html><script>alert(1)</script></html>").toString("base64"),
    });
    expect(html.status).toBe(400);
    const svg = await putAvatar(aliceJar, { contentType: "image/svg+xml", data: PNG_1PX });
    expect(svg.status).toBe(400);
    const huge = Buffer.concat([JPEG_HEADER, Buffer.alloc(262_144)]).toString("base64");
    expect((await putAvatar(aliceJar, { contentType: "image/jpeg", data: huge })).status).toBe(400);
    // The stored picture is unchanged.
    const stored = await prisma.userAvatar.findUnique({ where: { userId: alice.id } });
    expect(stored?.contentType).toBe("image/png");
  });

  it("replaces and removes the picture, auditing type and size but never the bytes", async () => {
    const jpeg = Buffer.concat([JPEG_HEADER, Buffer.alloc(64, 1)]).toString("base64");
    expect((await putAvatar(aliceJar, { contentType: "image/jpeg", data: jpeg })).status).toBe(200);
    expect((await getAvatar(aliceJar)).response.headers.get("content-type")).toBe("image/jpeg");

    const removed = await deleteAvatar(aliceJar);
    expect(removed.body.data).toEqual({ removed: true });
    expect((await getAvatar(aliceJar)).status).toBe(404);
    expect((await me(aliceJar)).body.data.user.avatarUrl).toBeNull();
    expect((await deleteAvatar(aliceJar)).body.data).toEqual({ removed: false });

    const audits = await auditActions(alice.id);
    const avatarAudits = audits.filter((a) => a.action.startsWith("user.avatar"));
    expect(avatarAudits.map((a) => a.action)).toEqual([
      "user.avatar_update",
      "user.avatar_update",
      "user.avatar_remove",
    ]);
    expect(avatarAudits[1]!.after).toMatchObject({ contentType: "image/jpeg", byteSize: 76 });
    expect(JSON.stringify(avatarAudits)).not.toContain(jpeg.slice(0, 20));
  });

  it("is authenticated by the Bearer token only: a refresh cookie alone changes nothing", async () => {
    const cookieOnly = new Session();
    cookieOnly.set(REFRESH_COOKIE, bobJar.refreshToken!);
    const result = await call(avatarPut, {
      jar: cookieOnly,
      body: { contentType: "image/png", data: PNG_1PX },
      headers: {
        cookie: `${REFRESH_COOKIE}=${bobJar.refreshToken}`,
        origin: "https://evil.example",
      },
      noOrigin: true,
    });
    expect(result.status).toBe(401);
    expect(await prisma.userAvatar.findUnique({ where: { userId: bob.id } })).toBeNull();
  });

  it("serves the image bytes", async () => {
    const image = await getAvatar(aliceJar);
    expect(image.status).toBe(404);
    await putAvatar(aliceJar, { contentType: "image/png", data: PNG_1PX });
    const served = await getAvatar(aliceJar);
    expect(Buffer.isBuffer(served.body)).toBe(true);
    expect((served.body as unknown as Buffer).toString("base64")).toBe(PNG_1PX);
    await deleteAvatar(aliceJar);
  });
});

describe("display name", () => {
  it("renames the signed-in user and audits before and after", async () => {
    const result = await call(mePatch, {
      jar: bobJar,
      body: { displayName: "  Bob Housekeeping  " },
    });
    expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ displayName: "Bob Housekeeping" });
    expect((await me(bobJar)).body.data.user.displayName).toBe("Bob Housekeeping");
    const audits = await auditActions(bob.id);
    const rename = audits.find((a) => a.action === "user.profile_update");
    expect(rename?.after).toEqual({ displayName: "Bob Housekeeping" });
  });

  it("rejects empty, over-long and control-character names", async () => {
    for (const displayName of ["   ", "x".repeat(121), "Bob\u0000", "Bob​Bob"]) {
      const result = await call(mePatch, {
        jar: bobJar,
        body: { displayName },
      });
      expect(result.status).toBe(400);
    }
    const other = await call(mePatch, {
      jar: bobJar,
      body: { displayName: "Bob", email: "evil@example.com" },
    });
    expect(other.status).toBe(400);
    const row = await prisma.user.findUnique({ where: { id: bob.id }, select: { email: true } });
    expect(row?.email).toBe(bob.email);
  });
});
