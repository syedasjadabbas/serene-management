import "server-only";
import { serverEnv } from "@/lib/env";
import { inlineWorker } from "@/lib/jobs/inline";
import { existingRealtimeHub } from "@/lib/realtime/hub";
import { inFlightRequests, instanceId, isDraining, uptimeSeconds } from "./shutdown";

/**
 * This instance's status for operators and load tests (readiness body with
 * SERVER_TIMING=1). Counts and states only: no host names of dependencies,
 * no connection strings, no user data.
 */
export function instanceStatus() {
  const env = serverEnv();
  const hub = existingRealtimeHub();
  const worker = inlineWorker();
  return {
    instance: instanceId(),
    uptimeSeconds: uptimeSeconds(),
    draining: isDraining(),
    inFlightRequests: inFlightRequests(),
    realtime:
      env.REALTIME_ENABLED === "1"
        ? { listening: hub?.live ?? false, streams: hub?.subscribers ?? 0 }
        : { enabled: false },
    jobs:
      env.JOB_WORKER === "inline"
        ? { worker: "inline", running: worker?.running ?? 0 }
        : { worker: "off" },
  };
}
