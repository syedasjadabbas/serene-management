import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Shared workspace: isomorphic code only. Nothing here may import Prisma, node:*,
// React, next/* or server-only (docs/SERVER_SPLIT_PLAN.md §2).
const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "next",
                "next/*",
                "server-only",
                "@prisma/*",
                "prisma",
                "**/generated/**",
                "@/*",
              ],
              message:
                "shared/ must stay isomorphic: no Node, React, Next.js, Prisma or server-only imports, and no @/ alias (it resolves per consuming workspace).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores(["node_modules/**"]),
]);

export default eslintConfig;
