/* eslint-disable no-console -- operator command: prints its result to the terminal */
/**
 * Compiles the operational commands (scripts/ops/*.ts) to plain JavaScript in
 * dist/ops and the job worker (workers/worker.ts) to dist/workers, so production runs them with `node` alone — no tsx,
 * no TypeScript, no dev dependencies (H11, docs/DEPLOYMENT.md). Application
 * code and the generated Prisma client are bundled; npm packages stay
 * external and resolve from the production node_modules.
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";

// npm packages stay external; @serene/shared (TypeScript source) is bundled.
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const externalPackages = Object.keys(pkg.dependencies).filter((name) => name !== "@serene/shared");

const common = {
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...externalPackages, ...externalPackages.map((name) => `${name}/*`)],
  tsconfig: "tsconfig.json",
  sourcemap: false,
  logLevel: "warning",
  // Bundled CommonJS helpers may call require(); ESM has none by default.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
};

await build({
  ...common,
  entryPoints: [
    "scripts/ops/seed.ts",
    "scripts/ops/bootstrap.ts",
    "scripts/ops/maintenance.ts",
    "scripts/ops/backup.ts",
    "scripts/ops/db-check.ts",
  ],
  outdir: "dist/ops",
});
// The durable job worker is a separate process (workers/worker.ts).
await build({ ...common, entryPoints: ["workers/worker.ts"], outdir: "dist/workers" });
console.log("Built dist/ops: seed, bootstrap, maintenance, backup, db-check; dist/workers: worker");
