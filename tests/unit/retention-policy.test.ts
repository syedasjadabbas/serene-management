import { describe, expect, it } from "vitest";
import {
  OUTBOX_PENDING_RETAINED,
  RETENTION_DAYS,
  RETENTION_TARGETS,
  retentionCutoff,
} from "@/modules/retention/retention.policy";

describe("retention policy (H6)", () => {
  const now = new Date("2031-03-15T12:00:00.000Z");

  it("computes each cutoff from a pinned clock", () => {
    expect(retentionCutoff("authSessions", now).toISOString()).toBe("2031-02-13T12:00:00.000Z");
    expect(retentionCutoff("passwordResetTokens", now).toISOString()).toBe(
      "2031-03-08T12:00:00.000Z",
    );
    expect(retentionCutoff("idempotencyKeys", now).toISOString()).toBe("2031-03-08T12:00:00.000Z");
    expect(retentionCutoff("outboxPublished", now).toISOString()).toBe("2031-02-13T12:00:00.000Z");
    expect(retentionCutoff("outboxFailed", now).toISOString()).toBe("2030-12-15T12:00:00.000Z");
  });

  it("keeps idempotency keys well past their 24-hour replay window and never prunes pending events", () => {
    expect(RETENTION_DAYS.idempotencyKeys).toBeGreaterThanOrEqual(2);
    expect(OUTBOX_PENDING_RETAINED).toBe(true);
    expect(RETENTION_TARGETS).not.toContain("outboxPending");
    expect(RETENTION_DAYS.outboxFailed).toBeGreaterThan(RETENTION_DAYS.outboxPublished);
  });
});
