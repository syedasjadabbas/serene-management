import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ quiet: true });

/**
 * Integration tests run against a dedicated database on the same PostgreSQL
 * server: the development DATABASE_URL with the database name suffixed
 * "_test" (created by `npm run db:setup`). The dev database is never touched.
 * Exposed as SERENE_TEST_DATABASE_URL for the global setup, which runs in this
 * (main) process and does not receive the project's worker env.
 */
function testDatabaseUrl(devUrl: string | undefined): string {
  if (!devUrl) return "";
  const url = new URL(devUrl);
  const name = url.pathname.replace(/^\//, "");
  url.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return url.toString();
}
const TEST_DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL);
process.env.SERENE_TEST_DATABASE_URL = TEST_DATABASE_URL;

const alias = {
  "@": fileURLToPath(new URL("./", import.meta.url)),
};
// `server-only` throws outside a React Server environment; tests run server code directly.
const serverOnlyStub = {
  "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    testTimeout: 30_000,
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
          alias: serverOnlyStub,
          testTimeout: 30_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          alias: serverOnlyStub,
          globalSetup: ["tests/integration/global-setup.ts"],
          env: {
            NODE_ENV: "test",
            DATABASE_URL: TEST_DATABASE_URL,
            APP_URL: "http://localhost:3000",
            AUTH_ACCESS_TOKEN_TTL_SECONDS: "900",
          },
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
