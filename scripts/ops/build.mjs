/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * Compiles the operational commands (scripts/ops/*.ts) to plain JavaScript in
 * dist/ops, so production runs them with `node` alone — no tsx, no
 * TypeScript, no dev dependencies (H11, docs/DEPLOYMENT.md). Application
 * code and the generated Prisma client are bundled; npm packages stay
 * external and resolve from the production node_modules.
 */
import { build } from "esbuild";

await build({
  entryPoints: [
    "scripts/ops/seed.ts",
    "scripts/ops/bootstrap.ts",
    "scripts/ops/maintenance.ts",
    "scripts/ops/backup.ts",
    "scripts/ops/db-check.ts",
    "scripts/ops/worker.ts",
  ],
  outdir: "dist/ops",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: false,
  logLevel: "warning",
  // Bundled CommonJS helpers may call require(); ESM has none by default.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
console.log("Built dist/ops: seed, bootstrap, maintenance, backup, db-check, worker");
