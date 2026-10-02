import "server-only";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import pg from "pg";
import { pgPoolConfig } from "@/lib/db/pool-config";
import { describeError, logServerError } from "@/lib/http/log";
import { serverEnv } from "@/lib/env";
import { counter, gauge, histogram } from "@/lib/observability/metrics";
import {
  JobFailure,
  LeaseLostError,
  afterFailure,
  heartbeatIntervalMs,
} from "@/modules/jobs/jobs.policy";
import {
  type ClaimedJobRow,
  type JobFence,
  assertJobLease,
  claimJob,
  finishJob,
  loadFailedJob,
  reclaimExpiredLeases,
  recordJobFailure,
  renewJobLease,
  reportJobProgress,
} from "@/modules/jobs/jobs.service";
import type { JobHandler, JobRun } from "@/modules/jobs/jobs.types";

/**
 * Background job worker (docs/SCALABILITY.md §33, ARCHITECTURE D65). Runs in
 * an application process (JOB_WORKER=inline) or alone (`npm run worker`);
 * any number of either may run at once against one database.
 *
 * Loop: reclaim expired leases → claim due jobs up to the concurrency → run
 * each with a heartbeat that renews its lease. Woken by `serene_jobs`
 * notifications (an insert announces itself) and by a poll timer, so a lost
 * LISTEN connection only delays jobs by the poll interval. A job whose
 * handler fails is retried with exponential backoff up to its attempts, then
 * FAILED and handed to the handler's `onGiveUp`.
 *
 * Crash safety: nothing is held in memory that the database does not also
 * know. A worker that dies (or loses the database) stops renewing; its lease
 * expires and any worker re-claims the job. Every write a worker makes is
 * fenced on its lease, so a worker that comes back late changes nothing.
 */

export interface WorkerEvent {
  type: "finished" | "retry" | "failed" | "lease-lost" | "reclaimed";
  jobId: string;
  kind: string;
  attempt?: number;
  /** Created → claimed, ms (first attempts only; retries wait their backoff on purpose). */
  queueWaitMs?: number;
  runMs?: number;
  /** The request that queued the job (payload.requestId), for log correlation. */
  requestId?: string;
}

const jobOutcomes = () =>
  counter("jobs_total", "Job attempts by kind and outcome (finished, retry, failed, lease-lost)");
const jobDuration = () =>
  histogram("job_duration_seconds", "Job attempt execution time by kind and outcome");
const jobQueueWait = () =>
  histogram("job_queue_wait_seconds", "Created → claimed for first attempts, by kind");
const workersHolder = globalThis as unknown as { __sereneJobWorkers?: Set<JobWorker> };

export interface WorkerOptions {
  concurrency: number;
  pollIntervalMs: number;
  leaseMs: number;
  /** Session connection for LISTEN; null polls only. */
  listenUrl?: string | null;
  /** Only this property's jobs (tests, an operator draining one hotel). */
  propertyId?: string | null;
  onEvent?: (event: WorkerEvent) => void;
}

const LISTEN_CHANNEL = "serene_jobs";
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export class JobWorker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`.slice(0, 120);
  private readonly handlers: Map<string, JobHandler>;
  private readonly active = new Map<string, Promise<void>>();
  private readonly aborts = new Set<AbortController>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listener: pg.Client | null = null;
  private listenRetryMs = RETRY_MIN_MS;
  private listenTimer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private wakeAgain = false;
  private lastReclaim = 0;
  private stopping = false;

  constructor(
    handlers: JobHandler[],
    private readonly options: WorkerOptions,
  ) {
    this.handlers = new Map(handlers.map((handler) => [handler.kind, handler]));
  }

  private get filter() {
    return { propertyId: this.options.propertyId ?? null };
  }

  get kinds(): string[] {
    return [...this.handlers.keys()];
  }

  get running(): number {
    return this.active.size;
  }

  start(): void {
    workersHolder.__sereneJobWorkers ??= new Set();
    const workers = workersHolder.__sereneJobWorkers;
    workers.add(this);
    gauge("jobs_running", "Jobs this process is executing now, and its worker slots", () => [
      { labels: { state: "running" }, value: [...workers].reduce((n, w) => n + w.running, 0) },
      {
        labels: { state: "slots" },
        value: [...workers].reduce((n, w) => n + (w.stopping ? 0 : w.options.concurrency), 0),
      },
    ]);
    this.pollTimer = setInterval(() => void this.tick(), this.options.pollIntervalMs);
    this.pollTimer.unref?.();
    if (this.options.listenUrl) void this.listen(this.options.listenUrl);
    void this.tick();
  }

  /**
   * Stops claiming, then waits up to `graceMs` for running jobs. Jobs still
   * running after that keep their lease until it expires and are re-claimed
   * elsewhere; nothing is lost.
   */
  async stop(graceMs = 30_000): Promise<void> {
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.listenTimer) clearTimeout(this.listenTimer);
    const listener = this.listener;
    this.listener = null;
    await listener?.end().catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.active.values()]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
    clearTimeout(timer);
    for (const controller of this.aborts) controller.abort();
  }

  /**
   * Runs every due job one after another until none is left (tests and the
   * worker command's `--once`). Returns how many attempts ran.
   */
  async runDue(): Promise<number> {
    let count = 0;
    await this.reclaim(true);
    for (;;) {
      const job = await claimJob(this.id, this.kinds, this.options.leaseMs, this.filter);
      if (!job) return count;
      count += 1;
      await this.execute(job);
    }
  }

  /** Looks for work now (notification, timer). Overlapping calls coalesce. */
  async tick(): Promise<void> {
    if (this.stopping) return;
    if (this.ticking) {
      this.wakeAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.wakeAgain = false;
        await this.reclaim(false);
        while (!this.stopping && this.active.size < this.options.concurrency) {
          const job = await claimJob(this.id, this.kinds, this.options.leaseMs, this.filter);
          if (!job) break;
          const running = this.execute(job).finally(() => {
            this.active.delete(job.id);
            // A slot is free: look for the next job at once.
            if (!this.stopping) void this.tick();
          });
          this.active.set(job.id, running);
        }
      } while (this.wakeAgain && !this.stopping);
    } catch (error) {
      // The database is unreachable: the poll timer tries again.
      logServerError("job worker", error);
    } finally {
      this.ticking = false;
    }
  }

  private async reclaim(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastReclaim < this.options.pollIntervalMs) return;
    this.lastReclaim = now;
    const reclaimed = await reclaimExpiredLeases(50, this.filter);
    for (const job of reclaimed) {
      counter(
        "jobs_reclaimed_total",
        "Expired leases released (a worker died or lost the database)",
      ).inc({
        kind: job.kind,
      });
      this.options.onEvent?.({ type: "reclaimed", jobId: job.id, kind: job.kind });
      if (job.status === "FAILED") await this.giveUp(job.id, job.kind);
    }
  }

  private async execute(job: ClaimedJobRow): Promise<void> {
    const started = Date.now();
    const fence: JobFence = { id: job.id, workerId: this.id, attempt: job.attempts };
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      await recordJobFailure(fence, {
        retryInMs: null,
        errorCode: "UNKNOWN_JOB",
        errorMessage: "This job cannot be run",
        lastError: `No handler for kind ${job.kind}`,
      }).catch((error) => logServerError("job failure", error));
      return;
    }
    const controller = new AbortController();
    this.aborts.add(controller);
    let completedInTx = false;
    const heartbeat = setInterval(() => {
      renewJobLease(fence, this.options.leaseMs)
        .then((state) => {
          if (state === "lost") controller.abort();
        })
        // Database unreachable: keep trying; if the lease expires meanwhile,
        // the job is re-claimed and this worker's writes are fenced out.
        .catch(() => undefined);
    }, heartbeatIntervalMs(this.options.leaseMs));
    heartbeat.unref?.();

    const run: JobRun = {
      id: job.id,
      kind: job.kind,
      organizationId: job.organizationId,
      propertyId: job.propertyId,
      createdById: job.createdById,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      payload: job.payload,
      signal: controller.signal,
      progress: async (progress) => {
        await reportJobProgress(fence, progress).catch(() => undefined);
      },
      assertLease: (tx) => assertJobLease(tx, fence),
      completeIn: async (tx, result) => {
        await finishJob(fence, result, tx);
        completedInTx = true;
      },
    };
    const payload = job.payload as { requestId?: unknown } | null;
    const requestId =
      typeof payload?.requestId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(payload.requestId)
        ? payload.requestId
        : undefined;
    const queueWaitMs = job.attempts === 1 ? started - job.createdAt.getTime() : undefined;
    if (queueWaitMs !== undefined) {
      jobQueueWait().observe({ kind: job.kind }, Math.max(0, queueWaitMs) / 1000);
    }
    const event = (type: Exclude<WorkerEvent["type"], "reclaimed">) => {
      const runMs = Date.now() - started;
      jobOutcomes().inc({ kind: job.kind, outcome: type });
      jobDuration().observe({ kind: job.kind, outcome: type }, runMs / 1000);
      this.options.onEvent?.({
        type,
        jobId: job.id,
        kind: job.kind,
        attempt: job.attempts,
        runMs,
        ...(queueWaitMs !== undefined ? { queueWaitMs } : {}),
        ...(requestId ? { requestId } : {}),
      });
    };

    try {
      const result = await handler.run(run);
      try {
        await finishJob(fence, result);
      } catch (error) {
        // Already finished by the handler's own transaction.
        if (!(error instanceof LeaseLostError && completedInTx)) throw error;
      }
      event("finished");
    } catch (error) {
      if (error instanceof LeaseLostError || controller.signal.aborted) {
        event("lease-lost");
        return;
      }
      const final = error instanceof JobFailure;
      const decision = afterFailure(job.attempts, job.maxAttempts, !final);
      if (!final) logServerError(`job ${job.kind} attempt ${job.attempts}`, error);
      try {
        const recorded = await recordJobFailure(fence, {
          retryInMs: decision.retry ? decision.delayMs : null,
          errorCode: final ? error.code : decision.retry ? "RETRY_SCHEDULED" : "JOB_FAILED",
          errorMessage: final
            ? error.message
            : decision.retry
              ? `Attempt ${job.attempts} of ${job.maxAttempts} failed; retrying automatically`
              : "The job failed after every attempt",
          lastError: JSON.stringify(describeError(error)),
        });
        if (recorded) {
          event(decision.retry ? "retry" : "failed");
          if (!decision.retry) await this.giveUp(job.id, job.kind);
        }
      } catch (recordError) {
        // The lease expires and the job is retried by whoever reclaims it.
        logServerError("job failure", recordError);
      }
    } finally {
      clearInterval(heartbeat);
      this.aborts.delete(controller);
    }
  }

  private async giveUp(jobId: string, kind: string): Promise<void> {
    const handler = this.handlers.get(kind);
    if (!handler?.onGiveUp) return;
    try {
      const job = await loadFailedJob(jobId);
      if (job) await handler.onGiveUp(job);
    } catch (error) {
      logServerError(`job ${kind} give-up`, error);
    }
  }

  private async listen(url: string): Promise<void> {
    if (this.stopping) return;
    const settings = pgPoolConfig({ ...serverEnv(), DATABASE_URL: url, DATABASE_POOLER: "none" });
    const client = new pg.Client({
      connectionString: settings.connectionString,
      connectionTimeoutMillis: settings.connectionTimeoutMillis,
      application_name: "serene-management-jobs",
      options: settings.options,
      keepAlive: true,
    });
    const lost = () => {
      if (this.listener !== client) return;
      this.listener = null;
      this.retryListen(url);
    };
    client.on("error", () => {
      lost();
      void client.end().catch(() => undefined);
    });
    client.on("end", lost);
    client.on("notification", (message) => {
      if (message.channel === LISTEN_CHANNEL && this.handlers.has(message.payload ?? "")) {
        void this.tick();
      }
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${LISTEN_CHANNEL}`);
      if (this.stopping) {
        await client.end();
        return;
      }
      this.listener = client;
      this.listenRetryMs = RETRY_MIN_MS;
      // Jobs inserted while not listening.
      void this.tick();
    } catch {
      await client.end().catch(() => undefined);
      this.retryListen(url);
    }
  }

  private retryListen(url: string) {
    if (this.stopping || this.listenTimer) return;
    const delay = Math.round(this.listenRetryMs * (0.75 + Math.random() * 0.5));
    this.listenRetryMs = Math.min(this.listenRetryMs * 2, RETRY_MAX_MS);
    this.listenTimer = setTimeout(() => {
      this.listenTimer = null;
      void this.listen(url);
    }, delay);
    this.listenTimer.unref?.();
  }
}

/** Worker settings from the environment. */
export function workerOptionsFromEnv(onEvent?: WorkerOptions["onEvent"]): WorkerOptions {
  const env = serverEnv();
  return {
    concurrency: env.JOB_WORKER_CONCURRENCY,
    pollIntervalMs: env.JOB_POLL_INTERVAL_MS,
    leaseMs: env.JOB_LEASE_MS,
    // LISTEN needs a session connection: not through a transaction pooler.
    listenUrl:
      env.REALTIME_DATABASE_URL ??
      (env.DATABASE_POOLER === "pgbouncer-transaction" ? null : env.DATABASE_URL),
    onEvent,
  };
}
