import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/http/route";
import { ORIGIN } from "./support/http";

/**
 * Production-readiness audit: an anonymous request must not make the process
 * buffer and parse an arbitrarily large body before validation.
 */
function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/v1/auth/login", ORIGIN), {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      ...headers,
    },
    body,
    // Required by undici for streamed request bodies.
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

const call = (req: NextRequest) => loginRoute(req, { params: Promise.resolve({}) });

describe("JSON request body limit (1 MiB)", () => {
  it("refuses a body whose declared length is too large, with 413", async () => {
    const big = JSON.stringify({ email: "a@b.test", password: "x".repeat(MAX_JSON_BODY_BYTES) });
    const res = await call(request(big, { "content-length": String(big.length) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: { limitBytes: MAX_JSON_BODY_BYTES },
    });
  });

  it("stops reading a chunked body without a length once it passes the limit", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"email":"a@b.test","password":"'));
      },
      pull(controller) {
        pulled += chunk.byteLength;
        // An endless body: only the limit can end it.
        controller.enqueue(chunk);
      },
    });
    const res = await call(request(stream));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(MAX_JSON_BODY_BYTES + 4 * chunk.byteLength);
  });

  it("still accepts a normal body and reports malformed JSON as 400", async () => {
    const normal = await call(
      request(JSON.stringify({ email: "nobody@limits.test", password: "Wrong-password-123" })),
    );
    expect(normal.status).toBe(401);
    const malformed = await call(request("{not json"));
    expect(malformed.status).toBe(400);
  });
});
