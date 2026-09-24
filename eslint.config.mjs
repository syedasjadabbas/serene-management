import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architectural boundaries (docs/ARCHITECTURE.md §Dependency rules):
//  - UI code (app/** except api routes, components/, hooks/, store/) may import
//    a module's contract (*.schema.ts, *.types.ts) but never its service,
//    repository or the database client.
//  - Server-only files also `import "server-only"`, so a violation fails the
//    build even if lint is skipped.
const serverOnlyImports = {
  patterns: [
    {
      group: [
        "@/modules/*/*.service",
        "@/modules/*/*.repository",
        "@/lib/db/*",
        "@/lib/auth/server/*",
        "@/lib/http/*",
        "@/generated/prisma/*",
      ],
      message:
        "Server-only code. UI code talks to the server through RTK Query endpoints (see docs/ARCHITECTURE.md).",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "hooks/**/*.{ts,tsx}",
      "store/**/*.{ts,tsx}",
    ],
    ignores: ["app/api/**"],
    rules: { "no-restricted-imports": ["error", serverOnlyImports] },
  },
  {
    // Route handlers stay thin: no direct database access, go through services.
    files: ["app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/db/*", "@/modules/*/*.repository"],
              message: "Route handlers call services; services own data access.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "generated/**", "next-env.d.ts"]),
]);

export default eslintConfig;
