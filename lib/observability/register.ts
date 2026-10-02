import "server-only";
import { gauge, startProcessMetrics } from "./metrics";

/**
 * Process-wide gauges, registered once per process (instrumentation-node.ts
 * for application instances, the worker command for worker processes).
 * Counters and histograms register themselves where they are recorded.
 */
export function registerProcessMetrics(role: "web" | "worker"): void {
  const holder = globalThis as unknown as { __sereneProcessMetricsRole?: string };
  if (holder.__sereneProcessMetricsRole) return;
  holder.__sereneProcessMetricsRole = role;
  startProcessMetrics();

  gauge("serene_instance_info", "Constant 1, labelled with this process's identity", async () => {
    const { instanceId } = await import("@/lib/lifecycle/shutdown");
    return [{ labels: { instance: instanceId(), role }, value: 1 }];
  });

  if (role === "web") {
    gauge("http_server_active_requests", "API requests in progress", async () => {
      const { inFlightRequests } = await import("@/lib/lifecycle/shutdown");
      return [{ labels: {}, value: inFlightRequests() }];
    });
    gauge("serene_instance_draining", "1 while shutting down (readiness 503)", async () => {
      const { isDraining } = await import("@/lib/lifecycle/shutdown");
      return [{ labels: {}, value: isDraining() ? 1 : 0 }];
    });
    gauge("realtime_streams_active", "Event streams open on this instance", async () => {
      const { existingRealtimeHub } = await import("@/lib/realtime/hub");
      return [{ labels: {}, value: existingRealtimeHub()?.subscribers ?? 0 }];
    });
    gauge(
      "realtime_listener_up",
      "1 while this instance's LISTEN connection is up (0 also before the first stream)",
      async () => {
        const { existingRealtimeHub } = await import("@/lib/realtime/hub");
        return [{ labels: {}, value: existingRealtimeHub()?.live ? 1 : 0 }];
      },
    );
  }

  // The cluster's queue, read from PostgreSQL at most every 10 s per process
  // (the same numbers on every instance: aggregate with max, not sum).
  let cached: { at: number; samples: { labels: Record<string, string>; value: number }[] } | null =
    null;
  const queue = async () => {
    if (cached && Date.now() - cached.at < 10_000) return cached.samples;
    const { jobQueueStats } = await import("@/modules/jobs/jobs.service");
    const stats = await jobQueueStats();
    cached = {
      at: Date.now(),
      samples: [
        { labels: { state: "queued" }, value: stats.queued },
        { labels: { state: "due" }, value: stats.due },
        { labels: { state: "running" }, value: stats.running },
        { labels: { state: "expired_lease" }, value: stats.expiredLeases },
        { labels: { state: "failed_24h" }, value: stats.failedLast24h },
        { labels: { state: "oldest_due_seconds" }, value: stats.oldestDueSeconds ?? 0 },
      ],
    };
    return cached.samples;
  };
  gauge(
    "jobs_queue",
    "Cluster job queue from PostgreSQL: counts by state and the oldest due job's age (state=oldest_due_seconds)",
    queue,
  );
}
