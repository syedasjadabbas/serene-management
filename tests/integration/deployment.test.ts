import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { GET as healthRoute } from "@/app/api/health/route";
import { GET as liveRoute } from "@/app/api/health/live/route";
import { GET as readyRoute } from "@/app/api/health/ready/route";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resetLifecycleForTests, shutdown } from "@/lib/lifecycle/shutdown";
import { loadGrantedPermissions } from "@/modules/access/access.service";
import { BootstrapRefused, bootstrapFirstOrganization } from "@/modules/access/bootstrap.service";
import { createProperty } from "@/modules/properties/properties.service";
import { seedReferenceData } from "@/prisma/seed/reference";
import { createFixtureOrg } from "./support/fixtures";
import { call } from "./support/http";

/**
 * Phase 10 batch 2: deployment foundation. Bootstrap runs against throwaway
 * databases created on the same native PostgreSQL server (migrated from
 * scratch, then dropped), never against the shared test database's data.
 */

const PASSWORD = "Bootstrap-Pw-7q!Lr2x";
const baseUrl = new URL(process.env.DATABASE_URL!);
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const TEMPLATE_DB = `serene_deploy_${suffix}_test`;
const CLONE_DB = `serene_deploy_${suffix}_b_test`;
const urlFor = (name: string) => {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${name}`;
  return url.toString();
};
const clients: PrismaClient[] = [];

function clientFor(name: string) {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlFor(name), options: "-c TimeZone=UTC" }),
  });
  clients.push(client);
  return client;
}

async function admin(sql: string) {
  const url = new URL(baseUrl.toString());
  url.pathname = "/postgres";
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const input = (overrides: Record<string, string> = {}) => ({
  organizationCode: "FIRSTORG",
  organizationName: "First Hotel Group",
  baseCurrency: "PKR",
  adminEmail: `owner.${suffix}@example.com`,
  adminDisplayName: "First Owner",
  adminPassword: PASSWORD,
  ...overrides,
});

function runNode(args: string[], env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, args, {
    env: { ...process.env, ...env },
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

let db: PrismaClient;

beforeAll(async () => {
  // Compiled operational commands (H11): plain node, no tsx.
  execFileSync(process.execPath, ["scripts/ops/build.mjs"], { stdio: "pipe" });
  await admin(`CREATE DATABASE "${TEMPLATE_DB}" TEMPLATE template0 ENCODING 'UTF8'`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: {
      ...process.env,
      DATABASE_URL: urlFor(TEMPLATE_DB),
      MIGRATION_DATABASE_URL: urlFor(TEMPLATE_DB),
    },
    stdio: "pipe",
  });
  db = clientFor(TEMPLATE_DB);
  await seedReferenceData(db);
}, 180_000);

afterAll(async () => {
  for (const client of clients) await client.$disconnect();
  for (const name of [CLONE_DB, TEMPLATE_DB]) {
    await admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
}, 60_000);

// --- L28 -----------------------------------------------------------------------------------

describe("L28 health checks", () => {
  it("reports ready with the database available, on both readiness paths", async () => {
    const live = await call(liveRoute, { path: "/api/health/live" });
    expect(live.status).toBe(200);
    expect(live.body).toEqual({ data: { status: "ok" } });
    expect(live.response.headers.get("cache-control")).toBe("no-store");
    for (const route of [readyRoute, healthRoute]) {
      const ready = await call(route, { path: "/api/health/ready" });
      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({ data: { status: "ready" } });
    }
  });

  it("fails readiness while draining for shutdown, without touching liveness (phase 9)", async () => {
    // A fresh lifecycle without hooks: draining must not close this test process's pools.
    resetLifecycleForTests();
    const query = vi.spyOn(prisma, "$queryRaw");
    try {
      await shutdown("SIGTERM", { drainMs: 0, timeoutMs: 1_000, owner: false, log: () => {} });
      for (const route of [readyRoute, healthRoute]) {
        const ready = await call(route, { path: "/api/health/ready" });
        expect(ready.status).toBe(503);
        expect(ready.body).toEqual({ status: "draining" });
      }
      // Draining answers without asking the database.
      expect(query).not.toHaveBeenCalled();
      const live = await call(liveRoute, { path: "/api/health/live" });
      expect(live.status).toBe(200);
    } finally {
      query.mockRestore();
      resetLifecycleForTests();
    }
  });

  it("stays alive but not ready when the database fails, revealing nothing", async () => {
    const secret = "postgres://serene:Sup3r-Secret-Pw@db.internal:5432";
    const spy = vi
      .spyOn(prisma, "$queryRaw")
      .mockRejectedValue(new Error(`connect ECONNREFUSED ${secret}`));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const live = await call(liveRoute, { path: "/api/health/live" });
      expect(live.status).toBe(200);
      for (const route of [readyRoute, healthRoute]) {
        const ready = await call(route, { path: "/api/health/ready" });
        expect(ready.status).toBe(503);
        expect(ready.body).toEqual({ status: "unavailable" });
        expect(JSON.stringify(ready.body)).not.toMatch(/ECONNREFUSED|Secret|db\.internal/);
      }
      // Logged, but redacted (G12).
      expect(JSON.stringify(errors.mock.calls)).not.toContain("Sup3r-Secret-Pw");
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
  });
});

// --- H1 ------------------------------------------------------------------------------------

describe("H1 production bootstrap", () => {
  it("validates the password policy and input before writing anything", async () => {
    await expect(bootstrapFirstOrganization(db, input({ adminPassword: "short" }))).rejects.toThrow(
      ZodError,
    );
    await expect(
      bootstrapFirstOrganization(db, input({ organizationCode: "1bad" })),
    ).rejects.toThrow(ZodError);
    const refused = await bootstrapFirstOrganization(db, input({ baseCurrency: "XYZ" })).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(BootstrapRefused);
    expect((refused as BootstrapRefused).reason).toBe("UNKNOWN_CURRENCY");
    expect(await db.organization.count()).toBe(0);
    expect(await db.user.count()).toBe(0);
  });

  it("rolls back completely when a step fails after the organization was created", async () => {
    const template = await db.role.findFirstOrThrow({
      where: { organizationId: null, code: "ORGANIZATION_ADMIN" },
    });
    await db.rolePermission.deleteMany({ where: { roleId: template.id } });
    await db.role.delete({ where: { id: template.id } });
    const refused = await bootstrapFirstOrganization(db, input()).catch((e: unknown) => e);
    expect((refused as BootstrapRefused).reason).toBe("REFERENCE_DATA_MISSING");
    expect(await db.organization.count()).toBe(0);
    expect(await db.role.count({ where: { organizationId: { not: null } } })).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
    await seedReferenceData(db); // restores the template
  });

  it("refuses to seed the demo organization in production (M7)", async () => {
    const result = runNode(
      ["--conditions=react-server", "--import", "tsx", "prisma/seed/index.ts"],
      {
        DATABASE_URL: urlFor(TEMPLATE_DB),
        NODE_ENV: "production",
        APP_URL: "https://pms.example-hotel.com",
        TRUSTED_PROXY_HOPS: "1",
        SEED_DEMO: "true",
        SEED_DEMO_PASSWORD: "Vx7!pQ2m-Rk9#Lt4w",
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to seed demo data");
    expect(`${result.stdout}${result.stderr}`).not.toContain("Vx7!pQ2m-Rk9#Lt4w");
    expect(await db.organization.count()).toBe(0);
  });

  it("creates exactly one organization and administrator, once, even when raced", async () => {
    // A clone of the migrated, seeded, still empty database.
    await db.$disconnect();
    await admin(`CREATE DATABASE "${CLONE_DB}" TEMPLATE "${TEMPLATE_DB}"`);
    const clone = clientFor(CLONE_DB);
    db = clientFor(TEMPLATE_DB);

    const outcomes = await Promise.allSettled([
      bootstrapFirstOrganization(clone, input()),
      bootstrapFirstOrganization(
        clone,
        input({ organizationCode: "OTHER", adminEmail: `other.${suffix}@example.com` }),
      ),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as BootstrapRefused).reason).toBe("ALREADY_BOOTSTRAPPED");
    expect(await clone.organization.count()).toBe(1);

    const user = await clone.user.findFirstOrThrow();
    expect(user.status).toBe("ACTIVE");
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
    const assignment = await clone.userRoleAssignment.findFirstOrThrow({
      where: { userId: user.id },
      include: { role: true },
    });
    expect(assignment).toMatchObject({ scope: "ORGANIZATION", propertyId: null });
    expect(assignment.role.code).toBe("ORGANIZATION_ADMIN");
    expect(assignment.role.organizationId).toBe(user.organizationId);
    const granted = await clone.$transaction((tx) =>
      loadGrantedPermissions(tx, user.id, user.organizationId),
    );
    for (const permission of ["users:manage", "roles:manage", "properties:manage"] as const) {
      expect(granted.organizationPermissions.has(permission)).toBe(true);
    }
    const audit = await clone.auditLog.findFirstOrThrow({
      where: { action: "organization.bootstrap" },
    });
    expect(audit.risk).toBe("HIGH");
    expect(audit.actorType).toBe("SYSTEM");
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);

    // Any later run is refused.
    const again = await bootstrapFirstOrganization(
      clone,
      input({ organizationCode: "LATER", adminEmail: `later.${suffix}@example.com` }),
    ).catch((e: unknown) => e);
    expect((again as BootstrapRefused).reason).toBe("ALREADY_BOOTSTRAPPED");
  });

  it("runs as a compiled command: explicit confirmation, no password in any output", () => {
    const common = {
      DATABASE_URL: urlFor(TEMPLATE_DB),
      BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
    };
    const args = [
      "--conditions=react-server",
      "dist/ops/bootstrap.mjs",
      "--org-code",
      "CLIORG",
      "--org-name",
      "CLI Hotels",
      "--currency",
      "PKR",
      "--admin-email",
      `cli.${suffix}@example.com`,
      "--admin-name",
      "CLI Owner",
    ];
    const unconfirmed = runNode(args, common);
    expect(unconfirmed.status).toBe(3);

    const created = runNode([...args, "--confirm"], common);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain("Organization and administrator created.");
    expect(created.stdout).toContain("CLIORG");

    const refused = runNode([...args, "--confirm"], common);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("ALREADY_BOOTSTRAPPED");

    const invalid = runNode([...args, "--confirm"], {
      ...common,
      BOOTSTRAP_ADMIN_PASSWORD: "tiny",
    });
    expect(invalid.status).toBe(2);
    for (const run of [unconfirmed, created, refused, invalid]) {
      expect(`${run.stdout}${run.stderr}`).not.toContain(PASSWORD);
      expect(`${run.stdout}${run.stderr}`).not.toContain("tiny");
    }
  });
});

// --- First property of a fresh installation (D49) -------------------------------------------

describe("first property starter setup", () => {
  it("gives an organization's first property the standard reference setup, and only the first", async () => {
    const fresh = await createFixtureOrg({ properties: [] });
    const make = (code: string) =>
      createProperty(fresh.adminCtx, {
        code: `${code}${fresh.suffix.slice(0, 6)}`.toUpperCase(),
        name: `Starter ${code}`,
        timezone: "Asia/Karachi",
        currencyCode: "PKR",
        countryCode: "PK",
        checkInTime: "14:00",
        checkOutTime: "12:00",
        reason: "Fresh installation",
      });
    const first = await make("F");
    const second = await make("S");

    const counts = async (propertyId: string) => ({
      codes: await prisma.transactionCode.count({ where: { propertyId } }),
      payments: await prisma.paymentMethod.count({ where: { propertyId } }),
      reasons: await prisma.reasonCode.count({ where: { propertyId } }),
      reservationTypes: await prisma.reservationType.count({ where: { propertyId } }),
      policies: await prisma.cancellationPolicy.count({ where: { propertyId } }),
      blockStatuses: await prisma.blockStatus.count({ where: { propertyId } }),
      taskTypes: await prisma.housekeepingTaskType.count({ where: { propertyId } }),
      markets: await prisma.marketCode.count({ where: { propertyId } }),
    });
    const starter = await counts(first.id);
    for (const [key, value] of Object.entries(starter)) {
      expect(value, key).toBeGreaterThan(0);
    }
    expect(
      await prisma.paymentMethod.findMany({
        where: { propertyId: first.id },
        select: { code: true },
        orderBy: { code: "asc" },
      }),
    ).toEqual([{ code: "BANK" }, { code: "CARD" }, { code: "CASH" }]);
    // Night audit is configured against the property's own codes.
    const config = await prisma.propertyConfiguration.findUniqueOrThrow({
      where: { propertyId: first.id },
      include: { noShowTransactionCode: true, noShowReasonCode: true },
    });
    expect(config.noShowTransactionCode).toMatchObject({ propertyId: first.id, code: "1090" });
    expect(config.noShowReasonCode).toMatchObject({ propertyId: first.id, code: "AUTO" });
    // Currency-neutral, and never physical or commercial setup.
    expect(
      await prisma.transactionCode.count({
        where: { propertyId: first.id, defaultPrice: { not: null } },
      }),
    ).toBe(0);
    expect(await prisma.taxRule.count({ where: { propertyId: first.id } })).toBe(0);
    expect(await prisma.roomType.count({ where: { propertyId: first.id } })).toBe(0);
    expect(await prisma.ratePlan.count({ where: { propertyId: first.id } })).toBe(0);

    // Later properties start empty and copy a sibling's setup (D37).
    expect(Object.values(await counts(second.id)).every((n) => n === 0)).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { action: "property.create", resourceId: { in: [first.id, second.id] } },
      select: { resourceId: true, after: true },
    });
    const flag = (id: string) =>
      (audits.find((a) => a.resourceId === id)!.after as { starterSetup: boolean }).starterSetup;
    expect(flag(first.id)).toBe(true);
    expect(flag(second.id)).toBe(false);
  });
});

// --- H11 -----------------------------------------------------------------------------------

describe("H11 production dependencies", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };

  it("compiled operational commands import only production dependencies", () => {
    const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
    const bundles = readdirSync("dist/ops").filter((name) => name.endsWith(".mjs"));
    expect(bundles).toEqual(
      expect.arrayContaining([
        "seed.mjs",
        "bootstrap.mjs",
        "maintenance.mjs",
        "backup.mjs",
        "db-check.mjs",
      ]),
    );
    for (const file of bundles.map((name) => `dist/ops/${name}`)) {
      const source = readFileSync(file, "utf8");
      const specifiers = new Set<string>();
      // Static imports start a line in esbuild output; dynamic ones are import("…").
      const patterns = [
        /^import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["'];?$/gm,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          if (!match[1]!.startsWith(".")) specifiers.add(match[1]!);
        }
      }
      expect(specifiers.size).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        if (builtins.has(specifier)) continue;
        const name = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]!;
        expect(pkg.dependencies, `${file} imports ${name}`).toHaveProperty([name]);
      }
    }
  });

  it("keeps deployment tooling in dependencies and dev tooling out of the deploy path", () => {
    // Needed on the production host: client generation (postinstall) and migrate deploy.
    expect(pkg.dependencies).toHaveProperty(["prisma"]);
    for (const dev of ["tsx", "vitest", "typescript", "dotenv", "esbuild"]) {
      expect(pkg.dependencies).not.toHaveProperty([dev]);
    }
    expect(readFileSync("prisma.config.ts", "utf8")).not.toMatch(
      /from ["']dotenv|import ["']dotenv/,
    );
    const deployPath = ["start", "db:deploy", "postinstall"].concat(
      Object.keys(pkg.scripts).filter((name) => name.startsWith("ops:")),
    );
    for (const script of deployPath) {
      expect(pkg.scripts[script]).not.toMatch(/tsx|vitest|esbuild/);
    }
  });
});
