/* eslint-disable no-console -- build command: prints its result to the terminal */
/**
 * Bundles the Express server (index.ts) to dist/index.mjs so production runs it
 * with `node dist/index.mjs` alone (no tsx, no TypeScript). Application code,
 * @serene/shared (TypeScript source) and the generated Prisma client are
 * bundled; npm packages stay external and resolve from node_modules.
 */
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const externalPackages = Object.keys({ ...pkg.dependencies }).filter(
  (name) => name !== "@serene/shared",
);

await build({
  entryPoints: ["index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...externalPackages, ...externalPackages.map((name) => `${name}/*`)],
  tsconfig: "tsconfig.json",
  sourcemap: false,
  logLevel: "warning",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
console.log("Built dist/index.mjs");
