import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { GET as jobRoute } from "@/app/api/v1/jobs/[jobId]/route";
import { POST as startRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/route";
import { GET as runRoute } from "@/app/api/v1/properties/[propertyId]/night-audits/[runId]/route";
import { prisma } from "@/lib/db/prisma";
import type { PropertyContext } from "@/lib/http/context";
import { isConnectionError } from "@/lib/db/transaction";
import { AppError } from "@/lib/http/errors";
import { ALL_PERMISSIONS } from "@/lib/permissions/catalog";
import { fromDateOnly, toDateOnly } from "@/modules/business-date/business-date.policy";
import { type JobKind, JobFailure, LeaseLostError } from "@/modules/jobs/jobs.policy";
import {
  type ClaimedJobRow,
  assertJobLease,
  claimJob,
  finishJob,
  recordJobFailure,
  reportJobProgress,
} from "@/modules/jobs/jobs.service";
import type { FailedJob, JobHandler, JobRun } from "@/modules/jobs/jobs.types";
import {
  NIGHT_AUDIT_JOB,
  executeNightAudit,
  getRun,
  nightAuditJob,
  recoverRun,
  startNightAudit,
} from "@/modules/night-audit/night-audit.service";
import {
  type FixtureOrg,
  TEST_PASSWORD,
  buildFixtureInventory,
  createFixtureOrg,
  createUser,
} from "./support/fixtures";
import { type CookieJar, call, loginAs } from "./support/http";
import { drainJobs, testWorker } from "./support/jobs";

/**
 * Background jobs (scalability phase 6, docs/SCALABILITY.md §33): the
 * PostgreSQL queue under concurrent workers, crashes (expired leases), late
 * workers (fencing), retries with backoff, giving up, duplicate delivery,
 * cancellation, idempotent starts, the starter's permission re-checked at
 * execution, and who may read a job. Each test uses its own property, and
 * every worker here is limited to that property's jobs.
 */

type Handler = typeof startRoute;

let org: FixtureOrg;
let other: FixtureOrg;
let fom: CookieJar; // front office manager at every property of `org`
let auditor: CookieJar; // auditor at P: reads runs, did not start them
let outsider: CookieJar; // a user of another organization
let revocable: { id: string; jar: CookieJar }; // front office manager at V only
const P = () => org.properties.P!.id;
const Q = () => org.properties.Q!.id;
const R = () => org.properties.R!.id;
const S = () => org.properties.S!.id;
const T = () => org.properties.T!.id;
const U = () => org.properties.U!.id;
const V = () => org.properties.V!.id;
const W = () => org.properties.W!.id;

const key = () => `job-${randomUUID()}`;
/** A few nights later: the audit may close the date (the calendar has passed it). */
const later = () => new Date(Date.now() + 3 * 24 * 3_600_000);

function ctxFor(propertyId: string): PropertyContext {
  return {
    ...org.adminCtx,
    access: { ...org.adminCtx.access, byProperty: { [propertyId]: ALL_PERMISSIONS } },
    propertyId,
    propertyCode: "TEST",
    timezone: "Asia/Karachi",
    currencyCode: "PKR",
    businessDate: null,
  };
}

async function currentDate(propertyId: string) {
  const row = await prisma.businessDate.findFirstOrThrow({
    where: { propertyId, isCurrent: true },
    select: { date: true, status: true },
  });
  return { date: toDateOnly(row.date), status: row.status };
}

/** Phase A through the service (the clock moved on, so the date may close). */
async function startAudit(propertyId: string, idempotencyKey = key()) {
  const ctx = { ...ctxFor(propertyId), businessDate: (await currentDate(propertyId)).date };
  const run = await startNightAudit(
    ctx,
    { reason: "Background job test" },
    { key: idempotencyKey, route: "POST /test", requestHash: "a".repeat(64) },
    { now: later() },
  );
  return { ctx, run };
}

const jobOf = (runId: string) =>
  prisma.backgroundJob.findFirstOrThrow({
    where: { kind: NIGHT_AUDIT_JOB, payload: { path: ["subjectId"], equals: runId } },
  });

/** Seconds until a queued job is due, by the database clock. */
async function dueInSeconds(jobId: string) {
  const rows = await prisma.$queryRaw<{ s: number }[]>`
    SELECT EXTRACT(EPOCH FROM "run_after" - now())::float8 AS "s"
    FROM "background_jobs" WHERE "id" = ${jobId}::uuid`;
  return rows[0]!.s;
}

const makeDue = (jobId: string) =>
  prisma.$executeRaw`UPDATE "background_jobs" SET "run_after" = now() WHERE "id" = ${jobId}::uuid`;

/** A worker that crashes right after its claim: its lease simply runs out. */
const expireLease = (jobId: string) =>
  prisma.$executeRaw`
    UPDATE "background_jobs" SET "locked_until" = now() - interval '1 second'
    WHERE "id" = ${jobId}::uuid AND "status" = 'RUNNING'`;

/** What a slow worker that claimed `job` would do with its (by now stale) lease. */
function lateRun(job: ClaimedJobRow, workerId: string): JobRun {
  const fence = { id: job.id, workerId, attempt: job.attempts };
  return {
    id: job.id,
    kind: job.kind,
    organizationId: job.organizationId,
    propertyId: job.propertyId,
    createdById: job.createdById,
    attempt: job.attempts,
    maxAttempts: job.maxAttempts,
    payload: job.payload,
    signal: new AbortController().signal,
    progress: async (progress) => {
      await reportJobProgress(fence, progress);
    },
    assertLease: (tx) => assertJobLease(tx, fence),
    completeIn: (tx, result) => finishJob(fence, result, tx),
  };
}

function getJob(jar: CookieJar, jobId: string) {
  return call(jobRoute as unknown as Handler, {
    path: `/api/v1/jobs/${jobId}`,
    params: { jobId },
    jar,
  });
}

beforeAll(async () => {
  org = await createFixtureOrg({
    properties: ["P", "Q", "R", "S", "T", "U", "V", "W"].map((k) => ({
      key: k,
      timezone: "Asia/Karachi",
    })),
  });
  other = await createFixtureOrg({ properties: [{ key: "X", timezone: "Asia/Karachi" }] });
  for (const k of ["P", "Q", "R", "S", "U", "V", "W"]) {
    await buildFixtureInventory(org, k, [{ code: "KNG", rooms: 2 }]);
  }
  const manager = await createUser(
    org,
    "jobs-fom",
    ["P", "Q", "R", "S", "T", "U", "V"].map((property) => ({
      role: "FRONT_OFFICE_MANAGER" as const,
      property,
    })),
  );
  const reader = await createUser(org, "jobs-auditor", [{ role: "AUDITOR", property: "P" }]);
  const stranger = await createUser(other, "jobs-stranger", [
    { role: "FRONT_OFFICE_MANAGER", property: "X" },
  ]);
  const limited = await createUser(org, "jobs-limited", [
    { role: "FRONT_OFFICE_MANAGER", property: "V" },
  ]);
  fom = await loginAs(manager.email, TEST_PASSWORD);
  auditor = await loginAs(reader.email, TEST_PASSWORD);
  outsider = await loginAs(stranger.email, TEST_PASSWORD);
  revocable = { id: limited.id, jar: await loginAs(limited.email, TEST_PASSWORD) };
});

describe("night audit as a background job (API)", () => {
  it("answers 202 at once and shows the job only to the user who started it", async () => {
    const date = (await currentDate(P())).date;
    const started = await call(startRoute as Handler, {
      method: "POST",
      path: `/api/v1/properties/${P()}/night-audits`,
      params: { propertyId: P() },
      body: { reason: "Close the day" },
      jar: fom,
      headers: { "idempotency-key": key() },
    });
    expect(started.status).toBe(202);
    expect(started.body.data.status).toBe("RUNNING");
    expect(started.body.data.job).toMatchObject({ status: "QUEUED", attempts: 0, maxAttempts: 3 });
    expect(await currentDate(P())).toEqual({ date, status: "IN_AUDIT" });
    const jobId = started.body.data.job.id as string;

    // The starter sees status only: no payload, reason, request data, worker or lease.
    const queued = await getJob(fom, jobId);
    expect(queued.status).toBe(200);
    expect(queued.body.data).toMatchObject({
      id: jobId,
      kind: NIGHT_AUDIT_JOB,
      status: "QUEUED",
      propertyId: P(),
    });
    const text = JSON.stringify(queued.body);
    for (const hidden of ["payload", "lastError", "lockedBy", "lockedUntil", "dedupeKey"]) {
      expect(text).not.toContain(hidden);
    }
    expect(text).not.toContain("Close the day");
    expect(text).not.toContain("vitest-integration");

    // Anyone else: as if it did not exist.
    expect((await getJob(auditor, jobId)).status).toBe(404);
    expect((await getJob(outsider, jobId)).status).toBe(404);
    expect((await getJob(fom, randomUUID())).status).toBe(404);
    expect((await getJob(fom, "not-a-uuid")).status).toBe(400);

    // Polling many times changes nothing.
    const polls = await Promise.all(Array.from({ length: 20 }, () => getJob(fom, jobId)));
    expect(polls.every((p) => p.status === 200 && p.body.data.status === "QUEUED")).toBe(true);

    expect(await drainJobs(P())).toBe(1);
    const done = await getJob(fom, jobId);
    expect(done.body.data).toMatchObject({
      status: "SUCCEEDED",
      attempts: 1,
      result: { runId: started.body.data.id, status: "COMPLETED" },
      error: null,
    });
    const run = await call(runRoute as unknown as Handler, {
      path: `/api/v1/properties/${P()}/night-audits/${started.body.data.id}`,
      params: { propertyId: P(), runId: started.body.data.id },
      jar: auditor,
    });
    expect(run.body.data.status).toBe("COMPLETED");
    expect(run.body.data.job.status).toBe("SUCCEEDED");
    expect((await currentDate(P())).status).toBe("OPEN");
    // The auditor reads the run (nightaudit:read at P), never the job resource itself.
    expect(run.body.data.job).not.toHaveProperty("payload");
  });

  it("re-checks the starter's permission when the job runs", async () => {
    const date = (await currentDate(V())).date;
    const started = await call(startRoute as Handler, {
      method: "POST",
      path: `/api/v1/properties/${V()}/night-audits`,
      params: { propertyId: V() },
      body: { reason: "Close the day" },
      jar: revocable.jar,
      headers: { "idempotency-key": key() },
    });
    expect(started.status).toBe(202);
    // The role is taken away while the job waits.
    await prisma.userRoleAssignment.deleteMany({ where: { userId: revocable.id } });
    expect(await drainJobs(V())).toBe(1);
    const run = await getRun(ctxFor(V()), started.body.data.id);
    expect(run.status).toBe("FAILED");
    expect(run.errorCode).toBe("PERMISSION_REVOKED");
    expect(run.job?.status).toBe("SUCCEEDED");
    expect(await currentDate(V())).toEqual({ date, status: "OPEN" });
    expect(await prisma.folioItem.count({ where: { propertyId: V() } })).toBe(0);
    // Without access to the property, the job is no longer visible to them either.
    expect((await getJob(revocable.jar, started.body.data.job.id)).status).toBe(404);
  });
});

describe("delivery guarantees", () => {
  it("lets exactly one of several concurrent workers run a job, once", async () => {
    const { run } = await startAudit(Q());
    const workers = [testWorker(Q()), testWorker(Q()), testWorker(Q())];
    const counts = await Promise.all(workers.map((w) => w.runDue()));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    const job = await jobOf(run.id);
    expect(job).toMatchObject({ status: "SUCCEEDED", attempts: 1, lockedBy: null });
    expect((await getRun(ctxFor(Q()), run.id)).status).toBe("COMPLETED");
    expect(
      await prisma.dailyStatistic.count({
        where: { propertyId: Q(), businessDate: fromDateOnly(run.businessDate) },
      }),
    ).toBe(1);
  });

  it("runs the work once when the same job is delivered again", async () => {
    // Property Q's job above succeeded; deliver it again as if a worker had
    // crashed after the commit but before recording the job's end.
    const job = await prisma.backgroundJob.findFirstOrThrow({
      where: { propertyId: Q(), kind: NIGHT_AUDIT_JOB },
    });
    const before = {
      date: await currentDate(Q()),
      lines: await prisma.folioItem.count({ where: { propertyId: Q() } }),
      stats: await prisma.dailyStatistic.count({ where: { propertyId: Q() } }),
    };
    await prisma.$executeRaw`
      UPDATE "background_jobs" SET "status" = 'QUEUED', "finished_at" = NULL, "result" = NULL,
             "run_after" = now()
      WHERE "id" = ${job.id}::uuid`;
    expect(await drainJobs(Q())).toBe(1);
    const again = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(again).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect(again.result).toMatchObject({ status: "COMPLETED" });
    expect(await currentDate(Q())).toEqual(before.date);
    expect(await prisma.folioItem.count({ where: { propertyId: Q() } })).toBe(before.lines);
    expect(await prisma.dailyStatistic.count({ where: { propertyId: Q() } })).toBe(before.stats);
  });

  it("starts one run and one job for a retried request (Idempotency-Key)", async () => {
    const idempotencyKey = key();
    const first = await startAudit(U(), idempotencyKey);
    const second = await startAudit(U(), idempotencyKey);
    expect(second.run.id).toBe(first.run.id);
    expect(
      await prisma.backgroundJob.count({ where: { propertyId: U(), kind: NIGHT_AUDIT_JOB } }),
    ).toBe(1);
    // Cancel it before it starts (below, the same property is reused).
    const cancelled = await recoverRun(first.ctx, first.run.id, { reason: "Not tonight" });
    expect(cancelled.errorCode).toBe("CANCELLED");
  });
});

describe("crashes and late workers", () => {
  it("re-claims an expired lease after a backoff and fences the late worker out", async () => {
    const { run } = await startAudit(R());
    const crashed = testWorker(R());
    const claimed = (await claimJob(crashed.id, crashed.kinds, 30_000, { propertyId: R() }))!;
    expect(claimed.attempts).toBe(1);
    await expireLease(claimed.id);

    // The next worker reclaims it: queued again after the first retry delay.
    const next = testWorker(R());
    expect(await next.runDue()).toBe(0);
    const reclaimed = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(reclaimed).toMatchObject({
      status: "QUEUED",
      attempts: 1,
      lockedBy: null,
      errorCode: "WORKER_LOST",
    });
    const wait = await dueInSeconds(claimed.id);
    expect(wait).toBeGreaterThan(2);
    expect(wait).toBeLessThanOrEqual(5.1);
    const view = await getRun(ctxFor(R()), run.id);
    expect(view.job).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(view.job?.error?.code).toBe("WORKER_LOST");

    // The crashed worker comes back: every write it tries is refused.
    const late = lateRun(claimed, crashed.id);
    await expect(executeNightAudit(late)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(
      finishJob({ id: claimed.id, workerId: crashed.id, attempt: 1 }, {}),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(
      await recordJobFailure(
        { id: claimed.id, workerId: crashed.id, attempt: 1 },
        { retryInMs: null, errorCode: "X", errorMessage: "X", lastError: "X" },
      ),
    ).toBe(false);
    expect((await getRun(ctxFor(R()), run.id)).status).toBe("RUNNING");
    expect((await currentDate(R())).status).toBe("IN_AUDIT");

    // Due again: the second attempt completes the audit.
    await makeDue(claimed.id);
    expect(await next.runDue()).toBe(1);
    expect(await jobOf(run.id)).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect((await getRun(ctxFor(R()), run.id)).status).toBe("COMPLETED");
    expect((await currentDate(R())).status).toBe("OPEN");
  });

  it("gives up after the last attempt: the run fails and the date reopens", async () => {
    const { run } = await startAudit(S());
    const date = (await currentDate(S())).date;
    const worker = testWorker(S());
    for (let attempt = 1; attempt <= 3; attempt++) {
      const zombie = testWorker(S());
      const claimed = (await claimJob(zombie.id, zombie.kinds, 30_000, { propertyId: S() }))!;
      expect(claimed.attempts).toBe(attempt);
      await expireLease(claimed.id);
      expect(await worker.runDue()).toBe(0);
      if (attempt < 3) await makeDue(claimed.id);
    }
    const job = await jobOf(run.id);
    expect(job).toMatchObject({ status: "FAILED", attempts: 3, errorCode: "WORKER_LOST" });
    expect(job.finishedAt).not.toBeNull();
    const view = await getRun(ctxFor(S()), run.id);
    expect(view.status).toBe("FAILED");
    expect(view.errorCode).toBe("JOB_FAILED");
    expect(await currentDate(S())).toEqual({ date, status: "OPEN" });
    expect(await prisma.folioItem.count({ where: { propertyId: S() } })).toBe(0);
  });
});

describe("database connection lost", () => {
  it("classifies lost connections, not business or data errors", () => {
    const withCode = (code: string) => Object.assign(new Error("x"), { code });
    expect(isConnectionError(withCode("57P01"))).toBe(true);
    expect(isConnectionError(withCode("08006"))).toBe(true);
    expect(isConnectionError(withCode("P1017"))).toBe(true);
    expect(isConnectionError({ cause: new Error("Connection terminated unexpectedly") })).toBe(
      true,
    );
    expect(isConnectionError(withCode("23505"))).toBe(false);
    expect(isConnectionError(withCode("40001"))).toBe(false);
    expect(isConnectionError(new AppError("CONFLICT", "No"))).toBe(false);
    expect(isConnectionError(new Error("injected"))).toBe(false);
  });

  it("retries a commit that lost its connection; nothing half-done remains", async () => {
    const { run } = await startAudit(W());
    const date = (await currentDate(W())).date;
    let lose = true;
    const worker = testWorker(W(), [
      nightAuditJob({
        hooks: {
          beforeStep: (step) => {
            if (step !== "STATISTICS" || !lose) return;
            lose = false;
            throw Object.assign(new Error("terminating connection due to administrator command"), {
              code: "57P01",
            });
          },
        },
      }),
    ]);
    expect(await worker.runDue()).toBe(1);
    const job = await jobOf(run.id);
    expect(job).toMatchObject({ status: "QUEUED", attempts: 1, errorCode: "RETRY_SCHEDULED" });
    // The run waits for its retry: still RUNNING, the date still in audit, and
    // the rolled-back commit left nothing behind.
    expect((await getRun(ctxFor(W()), run.id)).status).toBe("RUNNING");
    expect(await currentDate(W())).toEqual({ date, status: "IN_AUDIT" });
    expect(await prisma.dailyStatistic.count({ where: { propertyId: W() } })).toBe(0);
    await makeDue(job.id);
    expect(await worker.runDue()).toBe(1);
    expect(await jobOf(run.id)).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
    expect((await getRun(ctxFor(W()), run.id)).status).toBe("COMPLETED");
    expect(await prisma.dailyStatistic.count({ where: { propertyId: W() } })).toBe(1);
  });
});

describe("cancellation", () => {
  it("cancels a queued audit at once and never runs it", async () => {
    const { ctx, run } = await startAudit(U());
    const cancelled = await recoverRun(ctx, run.id, { reason: "Started by mistake" });
    expect(cancelled.status).toBe("FAILED");
    expect(cancelled.errorCode).toBe("CANCELLED");
    expect(cancelled.job?.status).toBe("CANCELLED");
    expect((await currentDate(U())).status).toBe("OPEN");
    expect(await drainJobs(U())).toBe(0);
  });

  it("refuses to stop an audit a worker holds, and recovers it once the worker is gone", async () => {
    const { ctx, run } = await startAudit(U());
    const holder = testWorker(U());
    const claimed = (await claimJob(holder.id, holder.kinds, 30_000, { propertyId: U() }))!;
    expect((await getRun(ctx, run.id)).actions.recover).toBe(false);
    const refused = await recoverRun(ctx, run.id, { reason: "Stop" }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AppError);
    expect((refused as AppError).status).toBe(409);
    expect((refused as AppError).details?.reason).toBe("NIGHT_AUDIT_IN_PROGRESS");

    await expireLease(claimed.id);
    const recovered = await recoverRun(
      ctx,
      run.id,
      { reason: "The worker died" },
      new Date(Date.now() + 10 * 60_000),
    );
    expect(recovered.errorCode).toBe("RECOVERED");
    expect((await jobOf(run.id)).status).toBe("CANCELLED");
    // The worker that held it can no longer finish anything.
    await expect(
      finishJob({ id: claimed.id, workerId: holder.id, attempt: 1 }, null),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect((await currentDate(U())).status).toBe("OPEN");
  });
});

describe("retries", () => {
  const TEST_KIND = "test.flaky" as JobKind;

  async function enqueueTestJob(maxAttempts: number) {
    return prisma.backgroundJob.create({
      data: {
        organizationId: org.organizationId,
        propertyId: T(),
        kind: TEST_KIND,
        payload: { subjectId: randomUUID() },
        maxAttempts,
        createdById: org.adminId,
      },
    });
  }

  function handler(run: (job: JobRun) => Promise<Record<string, unknown> | null>) {
    const gaveUp: FailedJob[] = [];
    const h: JobHandler = {
      kind: TEST_KIND,
      maxAttempts: 3,
      run,
      onGiveUp: async (job) => {
        gaveUp.push(job);
      },
    };
    return { h, gaveUp };
  }

  it("retries a failed attempt with exponential backoff, then succeeds", async () => {
    const job = await enqueueTestJob(3);
    let calls = 0;
    const { h, gaveUp } = handler(async () => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return { ok: true };
    });
    const worker = testWorker(T(), [h]);
    expect(await worker.runDue()).toBe(1);
    const retrying = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(retrying).toMatchObject({
      status: "QUEUED",
      attempts: 1,
      errorCode: "RETRY_SCHEDULED",
      lockedBy: null,
    });
    expect(retrying.lastError).toContain("Error");
    const wait = await dueInSeconds(job.id);
    expect(wait).toBeGreaterThan(2);
    expect(wait).toBeLessThanOrEqual(5.1);
    expect(await worker.runDue()).toBe(0); // not due yet
    await makeDue(job.id);
    expect(await worker.runDue()).toBe(1);
    const done = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done).toMatchObject({ status: "SUCCEEDED", attempts: 2, errorCode: null });
    expect(done.result).toEqual({ ok: true });
    expect(gaveUp).toHaveLength(0);
  });

  it("fails after its last attempt and hands the job to the handler's compensation", async () => {
    const job = await enqueueTestJob(2);
    const { h, gaveUp } = handler(async () => {
      throw new Error("still down");
    });
    const worker = testWorker(T(), [h]);
    expect(await worker.runDue()).toBe(1);
    await makeDue(job.id);
    expect(await worker.runDue()).toBe(1);
    const failed = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed).toMatchObject({ status: "FAILED", attempts: 2, errorCode: "JOB_FAILED" });
    expect(failed.finishedAt).not.toBeNull();
    expect(gaveUp.map((j) => j.id)).toEqual([job.id]);
  });

  it("does not retry a final failure", async () => {
    const job = await enqueueTestJob(5);
    const { h, gaveUp } = handler(async () => {
      throw new JobFailure("INPUT_GONE", "The input no longer exists");
    });
    expect(await testWorker(T(), [h]).runDue()).toBe(1);
    const failed = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed).toMatchObject({
      status: "FAILED",
      attempts: 1,
      errorCode: "INPUT_GONE",
      errorMessage: "The input no longer exists",
    });
    expect(gaveUp).toHaveLength(1);
  });

  it("never claims a job of a kind it does not run", async () => {
    const job = await enqueueTestJob(1);
    expect(await testWorker(T(), [nightAuditJob()]).runDue()).toBe(0);
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      "QUEUED",
    );
    await prisma.backgroundJob.delete({ where: { id: job.id } });
  });
});
