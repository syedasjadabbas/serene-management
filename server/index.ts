import { createServer } from "node:http";
import { serverEnv } from "@/config/env";
import { registerShutdown } from "@/lib/lifecycle/register";
import { createApp } from "./app";

/**
 * Process entry: validates the environment (a misconfigured production
 * process fails here, naming variables, never values), starts the HTTP
 * server, the graceful shutdown (lib/lifecycle), the inline job worker
 * (JOB_WORKER=inline) and the process metrics.
 */
let env;
try {
  env = serverEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid server environment");
  process.exit(1);
}

const app = createApp();
const server = createServer(app);
// The whole request (headers and body) must arrive within a minute; this does not
// limit responses, so event streams are unaffected.
server.requestTimeout = 60_000;
server.keepAliveTimeout = 65_000;

registerShutdown(server);

server.listen(env.PORT, () => {
  console.warn(`serene server listening on :${env.PORT} (${env.NODE_ENV})`);
});

if (env.JOB_WORKER === "inline") {
  void import("@/lib/jobs/inline")
    .then(({ startInlineWorker }) => startInlineWorker())
    .catch((error: unknown) => {
      console.error("Job worker failed to start", error instanceof Error ? error.name : error);
    });
}

void import("@/lib/observability/register")
  .then(({ registerProcessMetrics }) => registerProcessMetrics("web"))
  .catch((error: unknown) => {
    console.error("Metrics failed to start", error instanceof Error ? error.name : error);
  });
