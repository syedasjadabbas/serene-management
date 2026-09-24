import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // `server-only` throws outside a React Server environment; tests run server code directly.
    alias: { "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)) },
    testTimeout: 30_000,
  },
});
