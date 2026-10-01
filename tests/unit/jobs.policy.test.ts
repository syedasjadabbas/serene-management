import { describe, expect, it } from "vitest";
import {
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  afterFailure,
  heartbeatIntervalMs,
  isTerminalJobStatus,
  retryDelayMs,
  toJobView,
} from "@/modules/jobs/jobs.policy";

/** Background job rules (docs/SCALABILITY.md §33). */
describe("job retry schedule", () => {
  it("doubles the wait per attempt, with 50-100 % jitter, up to the cap", () => {
    const low = () => 0;
    const high = () => 0.999_999;
    expect(retryDelayMs(1, low)).toBe(RETRY_BASE_MS / 2);
    expect(retryDelayMs(1, high)).toBe(RETRY_BASE_MS);
    expect(retryDelayMs(2, high)).toBe(RETRY_BASE_MS * 2);
    expect(retryDelayMs(4, high)).toBe(RETRY_BASE_MS * 8);
    expect(retryDelayMs(30, high)).toBe(RETRY_MAX_MS);
    expect(retryDelayMs(1_000, low)).toBe(RETRY_MAX_MS / 2);
    for (let attempt = 1; attempt < 12; attempt++) {
      const delay = retryDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(
        Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1)) / 2,
      );
      expect(delay).toBeLessThanOrEqual(RETRY_MAX_MS);
    }
  });

  it("retries only retryable failures with attempts left", () => {
    expect(afterFailure(1, 3, true, () => 0)).toEqual({ retry: true, delayMs: RETRY_BASE_MS / 2 });
    expect(afterFailure(3, 3, true)).toEqual({ retry: false });
    expect(afterFailure(1, 3, false)).toEqual({ retry: false });
    expect(afterFailure(1, 1, true)).toEqual({ retry: false });
  });

  it("renews a lease three times per lease period", () => {
    expect(heartbeatIntervalMs(60_000)).toBe(20_000);
    expect(heartbeatIntervalMs(1_500)).toBe(1_000);
  });

  it("knows the terminal states", () => {
    expect(["SUCCEEDED", "FAILED", "CANCELLED"].every((s) => isTerminalJobStatus(s as never))).toBe(
      true,
    );
    expect(isTerminalJobStatus("QUEUED")).toBe(false);
    expect(isTerminalJobStatus("RUNNING")).toBe(false);
  });
});

describe("job view", () => {
  const base = {
    id: "0190a000-0000-7000-8000-000000000001",
    kind: "night_audit.run",
    propertyId: "0190a000-0000-7000-8000-000000000002",
    attempts: 1,
    maxAttempts: 3,
    progress: { stage: "COMMIT", done: 2, total: 5, secret: "x" },
    result: { runId: "r" },
    errorCode: null,
    errorMessage: null,
    createdAt: new Date("2031-01-01T00:00:00Z"),
    startedAt: new Date("2031-01-01T00:00:01Z"),
    finishedAt: null,
    runAfter: new Date("2031-01-01T00:00:00Z"),
  };

  it("shows progress only while running, and only its public fields", () => {
    const running = toJobView({ ...base, status: "RUNNING" });
    expect(running.progress).toEqual({ stage: "COMMIT", done: 2, total: 5 });
    expect(running.result).toBeNull();
    expect(running.runAfter).toBeNull();
    expect(
      toJobView({ ...base, status: "RUNNING", progress: { stage: "<script>" } }).progress,
    ).toBe(null);
  });

  it("shows the result only on success, and errors otherwise", () => {
    expect(toJobView({ ...base, status: "SUCCEEDED" }).result).toEqual({ runId: "r" });
    const retrying = toJobView({
      ...base,
      status: "QUEUED",
      errorCode: "RETRY_SCHEDULED",
      errorMessage: "Attempt 1 of 3 failed; retrying automatically",
    });
    expect(retrying.error?.code).toBe("RETRY_SCHEDULED");
    expect(retrying.runAfter).toBe("2031-01-01T00:00:00.000Z");
    expect(retrying.progress).toBeNull();
  });

  it("never carries internal fields", () => {
    const view = toJobView({
      ...base,
      status: "FAILED",
      errorCode: "JOB_FAILED",
      errorMessage: "x",
    });
    expect(Object.keys(view).sort()).toEqual(
      [
        "attempts",
        "createdAt",
        "error",
        "finishedAt",
        "id",
        "kind",
        "maxAttempts",
        "progress",
        "propertyId",
        "result",
        "runAfter",
        "startedAt",
        "status",
      ].sort(),
    );
  });
});
