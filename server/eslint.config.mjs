import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// Server workspace: plain TypeScript rules (no Next.js / React / jsx-a11y).
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
    },
  },
  {
    // The server never imports UI code.
    files: ["**/*.{ts,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/client/**", "@serene/client/**"],
              message:
                "The server must not import client code; share contracts via @serene/shared.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores(["node_modules/**", "dist/**", "coverage/**", "generated/**"]),
]);

export default eslintConfig;
