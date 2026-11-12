import { describe, expect, it } from "vitest";
import {
  CACHEABLE_REPORT_KEYS,
  buildReportCacheKey,
  buildStatisticsCacheKey,
  isCacheableReport,
} from "@/lib/report-cache";

const base = {
  propertyId: "p1",
  reportKey: "occupancy",
  businessDate: "2026-11-12",
  from: "2026-11-01",
  to: "2026-11-05",
  currencyCode: "PKR",
  financial: true,
  canExport: false,
};

describe("report cache keys", () => {
  it("is deterministic and prefixed", () => {
    expect(buildReportCacheKey(base)).toBe(buildReportCacheKey({ ...base }));
    expect(buildReportCacheKey(base).startsWith("rpt:v1:")).toBe(true);
  });

  it("changes with every input that changes the result", () => {
    const key = buildReportCacheKey(base);
    const variants = [
      { propertyId: "p2" },
      { reportKey: "tax" },
      { businessDate: "2026-11-13" },
      { from: "2026-11-02" },
      { to: "2026-11-06" },
      { roomTypeId: "rt1" },
      { risk: "HIGH" },
      { currencyCode: "USD" },
      { financial: false },
      { canExport: true },
    ];
    for (const v of variants) expect(buildReportCacheKey({ ...base, ...v })).not.toBe(key);
  });

  it("treats missing and null optional filters alike", () => {
    expect(buildReportCacheKey({ ...base, roomTypeId: null, risk: null })).toBe(
      buildReportCacheKey(base),
    );
  });

  it("keys statistics windows by property, open date and range", () => {
    const k = buildStatisticsCacheKey("p1", "2026-11-12", "2026-11-01", "2026-11-05");
    expect(k).not.toBe(buildStatisticsCacheKey("p1", "2026-11-13", "2026-11-01", "2026-11-05"));
    expect(k).not.toBe(buildStatisticsCacheKey("p2", "2026-11-12", "2026-11-01", "2026-11-05"));
  });
});

describe("cacheability", () => {
  it("caches only whitelisted reports over fully closed ranges", () => {
    expect(isCacheableReport("occupancy", "2026-11-11", "2026-11-12")).toBe(true);
    expect(isCacheableReport("occupancy", "2026-11-12", "2026-11-12")).toBe(false);
    expect(isCacheableReport("occupancy", "2026-11-20", "2026-11-12")).toBe(false);
    for (const live of ["in-house", "room-status", "arrivals", "audit-trail", "payments"]) {
      expect(CACHEABLE_REPORT_KEYS.has(live)).toBe(false);
      expect(isCacheableReport(live, "2026-01-01", "2026-11-12")).toBe(false);
    }
  });
});
