/**
 * Runs once when a Next.js server instance starts, before it serves requests
 * (docs/DEPLOYMENT.md). Validates the server environment so a misconfigured
 * production process fails at startup rather than on the first request that
 * happens to read a variable (M6). Skipped while `next build` collects page
 * data: the build machine does not need production secrets.
 */
export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./instrumentation-node");
}
