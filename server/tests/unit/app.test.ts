import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "@/app";
import { MAX_JSON_BODY_BYTES } from "@/lib/response";

/** The Express pipeline without a database: envelope, CORS, body limits, guards. */
const app = createApp();
const ORIGIN = "http://localhost:3000";

describe("Express pipeline", () => {
  it("answers liveness in the success envelope with a request id", async () => {
    const res = await request(app).get("/api/health/live").set("x-request-id", "trace-12345678");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "OK", data: { status: "ok" } });
    expect(res.headers["x-request-id"]).toBe("trace-12345678");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers unknown routes with the error envelope", async () => {
    const res = await request(app).get("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "NOT_FOUND", requestId: res.headers["x-request-id"] },
    });
  });

  it("applies CORS with credentials for allowed origins, including /api/health", async () => {
    const res = await request(app)
      .options("/api/health/live")
      .set("origin", ORIGIN)
      .set("access-control-request-method", "GET")
      .set("access-control-request-headers", "authorization,idempotency-key,x-client-platform");
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    for (const header of [
      "authorization",
      "idempotency-key",
      "x-client-platform",
      "x-request-id",
    ]) {
      expect(res.headers["access-control-allow-headers"]?.toLowerCase()).toContain(header);
    }
    const get = await request(app).get("/api/health/live").set("origin", ORIGIN);
    expect(get.headers["access-control-expose-headers"]).toMatch(/Retry-After/i);
  });

  it("sends no CORS headers to foreign origins", async () => {
    const res = await request(app).get("/api/health/live").set("origin", "https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("requires a Bearer token with a reason code", async () => {
    const none = await request(app).get("/api/v1/me");
    expect(none.status).toBe(401);
    expect(none.body.error).toMatchObject({
      code: "UNAUTHENTICATED",
      details: { reason: "TOKEN_MISSING" },
    });
    const bad = await request(app).get("/api/v1/me").set("authorization", "Bearer not-a-jwt");
    expect(bad.body.error.details.reason).toBe("TOKEN_INVALID");
  });

  it("checks the Origin only on the cookie endpoints", async () => {
    const refresh = await request(app).post("/api/v1/auth/refresh");
    expect(refresh.status).toBe(403);
    expect(refresh.body.error.code).toBe("FORBIDDEN");
    const logout = await request(app)
      .post("/api/v1/auth/logout")
      .set("origin", "https://evil.example");
    expect(logout.status).toBe(403);
  });

  it("refuses non-JSON, malformed and oversized bodies in the envelope", async () => {
    const text = await request(app)
      .post("/api/v1/auth/password/reset")
      .set("content-type", "text/plain")
      .send("hello");
    expect(text.status).toBe(400);
    expect(text.body.error.code).toBe("VALIDATION_FAILED");

    const malformed = await request(app)
      .post("/api/v1/auth/password/reset")
      .set("content-type", "application/json")
      .send("{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.message).toBe("Malformed JSON request body");

    const big = JSON.stringify({ token: "x".repeat(MAX_JSON_BODY_BYTES) });
    const large = await request(app)
      .post("/api/v1/auth/password/reset")
      .set("content-type", "application/json")
      .send(big);
    expect(large.status).toBe(413);
    expect(large.body.error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: { limitBytes: MAX_JSON_BODY_BYTES },
    });
  });

  it("reports field errors of strict schemas", async () => {
    const res = await request(app)
      .post("/api/v1/auth/password/reset")
      .set("content-type", "application/json")
      .send({ token: "", newPassword: "x", extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details.fields).toBeDefined();
  });

  it("hides the metrics endpoint without the scrape token", async () => {
    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(404);
  });
});
