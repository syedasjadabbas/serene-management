/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * `npm run ops:bootstrap` — first organization and administrator of a fresh
 * installation (H1, docs/DEPLOYMENT.md). Refuses when any organization
 * exists. There is no HTTP equivalent.
 *
 *   npm run ops:bootstrap -- --confirm \
 *     --org-code SERENE --org-name "Serene Hospitality" --currency PKR \
 *     --admin-email owner@example.com --admin-name "Owner Name"
 *
 * The password is never a command-line argument (it would end up in shell
 * history and process lists). It is read, in order, from:
 *   1. BOOTSTRAP_ADMIN_PASSWORD (removed from the environment once read), or
 *   2. a hidden interactive prompt (typed twice) when running in a terminal.
 * It is never printed or logged. Non-secret values may also come from
 * BOOTSTRAP_ORG_CODE, BOOTSTRAP_ORG_NAME, BOOTSTRAP_ORG_LEGAL_NAME,
 * BOOTSTRAP_CURRENCY, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME.
 *
 * Exit codes: 0 created · 1 error · 2 refused (already bootstrapped, invalid
 * input, missing reference data) · 3 not confirmed.
 */
import { parseArgs } from "node:util";
import { loadEnvFileIfPresent } from "./env-file";

const USAGE =
  "Usage: npm run ops:bootstrap -- --confirm --org-code CODE --org-name NAME " +
  "--currency XXX --admin-email EMAIL --admin-name NAME [--org-legal-name NAME]\n" +
  "Password: BOOTSTRAP_ADMIN_PASSWORD or the interactive prompt (never an argument).";

function readHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("No terminal: set BOOTSTRAP_ADMIN_PASSWORD instead."));
      return;
    }
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (fromEnv !== undefined) {
    delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    return fromEnv;
  }
  const first = await readHidden("Administrator password (not shown): ");
  const second = await readHidden("Repeat the password: ");
  if (first !== second) throw new Error("The passwords do not match; nothing was created.");
  return first;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      confirm: { type: "boolean", default: false },
      "org-code": { type: "string" },
      "org-name": { type: "string" },
      "org-legal-name": { type: "string" },
      currency: { type: "string" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (!values.confirm) {
    console.error(
      "Refusing to run without --confirm: this creates the first organization and its administrator.\n" +
        USAGE,
    );
    return 3;
  }

  loadEnvFileIfPresent();
  const { serverEnv } = await import("../../lib/env");
  const env = serverEnv();
  const { prisma } = await import("../../lib/db/prisma");
  const { bootstrapFirstOrganization, BootstrapRefused } =
    await import("../../modules/access/bootstrap.service");
  const { z } = await import("zod");

  const pick = (flag: string | undefined, variable: string) => flag ?? process.env[variable];
  try {
    const password = await readPassword();
    const result = await bootstrapFirstOrganization(prisma, {
      organizationCode: pick(values["org-code"], "BOOTSTRAP_ORG_CODE") ?? "",
      organizationName: pick(values["org-name"], "BOOTSTRAP_ORG_NAME") ?? "",
      organizationLegalName: pick(values["org-legal-name"], "BOOTSTRAP_ORG_LEGAL_NAME"),
      baseCurrency: pick(values.currency, "BOOTSTRAP_CURRENCY") ?? "",
      adminEmail: pick(values["admin-email"], "BOOTSTRAP_ADMIN_EMAIL") ?? "",
      adminDisplayName: pick(values["admin-name"], "BOOTSTRAP_ADMIN_NAME") ?? "",
      adminPassword: password,
    });
    console.log(
      [
        "Organization and administrator created.",
        `  Organization: ${result.organizationCode} (${result.organizationId})`,
        `  Administrator: ${result.adminEmail} (${result.adminUserId}), role ORGANIZATION_ADMIN`,
        `  Sign in at: ${new URL("/login", env.APP_URL).toString()}`,
        "  Next: Organization → Properties to create the first property.",
      ].join("\n"),
    );
    return 0;
  } catch (error) {
    if (error instanceof BootstrapRefused) {
      console.error(`Bootstrap refused (${error.reason}): ${error.message}`);
      return 2;
    }
    if (error instanceof z.ZodError) {
      // Field names and rules only; never the submitted values.
      const fields = error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`);
      console.error(`Invalid bootstrap input; nothing was created.\n${fields.join("\n")}`);
      return 2;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Bootstrap failed");
    process.exit(1);
  });
