import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_JSON_BODY_BYTES } from "@/lib/response";
import { app, call, route } from "./support/http";

/**
 * Production-readiness audit: an anonymous request must not make the process
 * buffer and parse an arbitrarily large body before validation.
 */
const login = route("POST", "/auth/login");

describe("JSON request body limit (1 MiB)", () => {
  it("refuses a body whose declared length is too large, with 413", async () => {
    const big = JSON.stringify({ email: "a@b.test", password: "x".repeat(MAX_JSON_BODY_BYTES) });
    const res = await call(login, { rawBody: big });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE", details: { limitBytes: MAX_JSON_BODY_BYTES } },
    });
  });

  describe("chunked bodies without a length", () => {
    let server: http.Server;
    let port: number;
    beforeAll(async () => {
      server = http.createServer(app());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    it("answers 413 once the stream passes the limit, without waiting for the end", async () => {
      const chunk = Buffer.alloc(64 * 1024, "x");
      let written = 0;
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: "/api/v1/auth/login",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "transfer-encoding": "chunked",
              "x-forwarded-for": "198.51.100.9",
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
            req.destroy();
          },
        );
        req.on("error", (error) => {
          // The server may close the connection once it has answered.
          if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return;
          reject(error);
        });
        req.write('{"email":"a@b.test","password":"');
        // An endless body: only the limit can end it (capped so a failure cannot hang).
        const pump = () => {
          if (written > 16 * MAX_JSON_BODY_BYTES) return;
          written += chunk.byteLength;
          if (req.write(chunk)) setImmediate(pump);
          else req.once("drain", pump);
        };
        pump();
      });
      expect(status).toBe(413);
      expect(written).toBeLessThan(8 * MAX_JSON_BODY_BYTES);
    });
  });

  it("still accepts a normal body and reports malformed JSON as 400", async () => {
    const normal = await call(login, {
      body: { email: "nobody@limits.test", password: "Wrong-password-123" },
    });
    expect(normal.status).toBe(401);
    const malformed = await call(login, { rawBody: "{not json" });
    expect(malformed.status).toBe(400);
    const notJson = await call(login, { rawBody: "email=x", contentType: "text/plain" });
    expect(notJson.status).toBe(400);
  });
});
