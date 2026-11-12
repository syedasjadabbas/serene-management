import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// Architectural boundaries (docs/SERVER_SPLIT_PLAN.md, docs/ARCHITECTURE.md §Dependency rules):
//  - The client never imports server code: nothing from server/, no Prisma client,
//    and no server-only module files. Contracts come from @serene/shared.
const serverOnlyImports = {
  patterns: [
    {
      group: [
        "**/server/**",
        "@serene/server/**",
        "@/modules/*/*.service",
        "@/modules/*/*.repository",
        "@/generated/**",
        "server-only",
      ],
      message:
        "Server-only code. The client talks to the server through RTK Query endpoints and shares contracts via @serene/shared.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Full jsx-a11y recommended set (Next enables only a handful). The plugin
    // itself is registered by eslint-config-next.
    files: ["**/*.tsx"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // autoFocus is used only to move focus into a freshly opened dialog,
      // wizard step or the sign-in form, which is the intended focus target.
      "jsx-a11y/no-autofocus": "off",
      // Scrollable table frames (role="region") must be focusable so keyboard
      // users can scroll them (axe: scrollable-region-focusable).
      "jsx-a11y/no-noninteractive-tabindex": ["error", { tags: [], roles: ["tabpanel", "region"] }],
    },
  },
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
    files: ["**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", serverOnlyImports] },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "generated/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
