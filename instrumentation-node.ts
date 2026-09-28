import { serverEnv } from "./lib/env";

/**
 * Node.js-only startup checks, imported by instrumentation.ts (kept separate
 * so the Edge build never sees process.exit). Validates the server
 * environment (M6); on failure prints the problems — variable names and
 * rules, never values — and exits, because a failed register() would leave
 * `next start` running and answering 500 instead of letting the process
 * manager see the failure.
 */
try {
  serverEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid server environment");
  process.exit(1);
}
