import { beforeAll, describe, expect, it } from "vitest";
import {
  DELETE as avatarDelete,
  GET as avatarGet,
  PUT as avatarPut,
} from "@/app/api/v1/me/avatar/route";
import { GET as meRoute, PATCH as mePatch } from "@/app/api/v1/me/route";
import { prisma } from "@/lib/db/prisma";
import { type FixtureOrg, TEST_PASSWORD, createFixtureOrg, createUser } from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";

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
let aliceJar: CookieJar;
let bobJar: CookieJar;

const me = (jar: CookieJar) => call(meRoute, { path: "/api/v1/me", jar });
const getAvatar = (jar: CookieJar) => call(avatarGet, { path: "/api/v1/me/avatar", jar });
const putAvatar = (jar: CookieJar, body: unknown) =>
  call(avatarPut, { method: "PUT", path: "/api/v1/me/avatar", jar, body });
const deleteAvatar = (jar: CookieJar) =>
  call(avatarDelete, { method: "DELETE", path: "/api/v1/me/avatar", jar });

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

    const fresh = await loginAs(alice.email, TEST_PASSWORD);
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

  it("requires the same-origin check like every other write", async () => {
    const result = await call(avatarPut, {
      method: "PUT",
      path: "/api/v1/me/avatar",
      jar: bobJar,
      body: { contentType: "image/png", data: PNG_1PX },
      noOrigin: true,
    });
    expect(result.status).toBe(403);
    expect(await prisma.userAvatar.findUnique({ where: { userId: bob.id } })).toBeNull();
  });
});

describe("display name", () => {
  it("renames the signed-in user and audits before and after", async () => {
    const result = await call(mePatch, {
      method: "PATCH",
      path: "/api/v1/me",
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
        method: "PATCH",
        path: "/api/v1/me",
        jar: bobJar,
        body: { displayName },
      });
      expect(result.status).toBe(400);
    }
    const other = await call(mePatch, {
      method: "PATCH",
      path: "/api/v1/me",
      jar: bobJar,
      body: { displayName: "Bob", email: "evil@example.com" },
    });
    expect(other.status).toBe(400);
    const row = await prisma.user.findUnique({ where: { id: bob.id }, select: { email: true } });
    expect(row?.email).toBe(bob.email);
  });
});
