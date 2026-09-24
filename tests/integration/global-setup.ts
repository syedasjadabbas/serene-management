import { execFileSync } from "node:child_process";

/**
 * Brings the dedicated test database up to date once per run: applies pending
 * migrations (non-destructive `migrate deploy`) and the idempotent reference
 * seed (permission catalog, role templates, currencies). No reset is needed:
 * every test file creates its own uniquely named organization. Refuses to
 * run against any database whose name does not end in "_test".
 */
export default function setup() {
  // Set by vitest.config.mts in this (main) process.
  const url = process.env.SERENE_TEST_DATABASE_URL;
  if (!url) throw new Error("SERENE_TEST_DATABASE_URL is not set (DATABASE_URL missing in .env?)");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to reset "${name}": integration tests only run against a *_test database`,
    );
  }

  const env = { ...process.env, DATABASE_URL: url };
  const run = (args: string[]) =>
    execFileSync(process.execPath, args, { env, stdio: "pipe", cwd: process.cwd() });

  run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  run(["--conditions=react-server", "--import", "tsx", "prisma/seed/index.ts"]);
}
