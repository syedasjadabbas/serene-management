/**
 * Demo seed safety (M7). The demo organization creates an Organization Admin
 * and staff accounts that share one password, so it must never run against
 * a production database. There is deliberately NO override: production
 * access is created with `npm run ops:bootstrap` (docs/DEPLOYMENT.md).
 */

export const DEMO_PASSWORD_MIN_LENGTH = 16;
const PLACEHOLDERS = ["change-me", "changeme", "password", "serene", "example", "demo"];

export type DemoSeedDecision = { run: false } | { run: true; password: string };

export class DemoSeedRefused extends Error {}

export function demoSeedDecision(env: Record<string, string | undefined>): DemoSeedDecision {
  if (env.SEED_DEMO !== "true") return { run: false };
  if (env.NODE_ENV === "production") {
    throw new DemoSeedRefused(
      "Refusing to seed demo data: NODE_ENV=production. The demo organization creates " +
        "administrator accounts with a shared password and is never allowed in production. " +
        "Use `npm run ops:bootstrap` to create the first organization and administrator.",
    );
  }
  const password = env.SEED_DEMO_PASSWORD ?? "";
  const lower = password.toLowerCase();
  if (
    password.length < DEMO_PASSWORD_MIN_LENGTH ||
    password.length > 256 ||
    new Set(password).size < 8 ||
    PLACEHOLDERS.some((word) => lower === word || lower.startsWith(`${word}-`))
  ) {
    throw new DemoSeedRefused(
      `SEED_DEMO=true needs SEED_DEMO_PASSWORD: at least ${DEMO_PASSWORD_MIN_LENGTH} characters, ` +
        "varied, not a placeholder. It is never printed; every demo user signs in with it.",
    );
  }
  return { run: true, password };
}
