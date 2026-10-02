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

// Graceful shutdown for multi-instance deployment (docs/SCALABILITY.md §37):
// drains readiness, ends event streams, stops job claims, closes the pools.
void import("./lib/lifecycle/register")
  .then(({ registerShutdown }) => registerShutdown())
  .catch((error: unknown) => {
    console.error(
      "Shutdown handler failed to install",
      error instanceof Error ? error.name : error,
    );
  });

// Background job worker inside this process (JOB_WORKER=inline, the default;
// docs/SCALABILITY.md §33). Started after the environment check passed.
if (serverEnv().JOB_WORKER === "inline") {
  void import("./lib/jobs/inline")
    .then(({ startInlineWorker }) => startInlineWorker())
    .catch((error: unknown) => {
      console.error("Job worker failed to start", error instanceof Error ? error.name : error);
    });
}

// Process, request, pool, job and realtime metrics for GET /api/metrics
// (docs/OPERATIONS.md §11). In-memory only; nothing is sent anywhere.
void import("./lib/observability/register")
  .then(({ registerProcessMetrics }) => registerProcessMetrics("web"))
  .catch((error: unknown) => {
    console.error("Metrics failed to start", error instanceof Error ? error.name : error);
  });
