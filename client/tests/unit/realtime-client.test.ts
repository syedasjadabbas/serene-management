import { describe, expect, it } from "vitest";
import { parseEventBlock } from "@/global/lib/realtime/client";

describe("server-sent event parsing (client)", () => {
  it("reads the event name and data, ignoring comments", () => {
    expect(parseEventBlock('event: change\ndata: {"t":["rooms"],"x":"7"}')).toEqual({
      event: "change",
      data: '{"t":["rooms"],"x":"7"}',
    });
    expect(parseEventBlock(": ping")).toBeNull();
    expect(parseEventBlock("retry: 5000")).toBeNull();
    expect(parseEventBlock("data: a\ndata: b")).toEqual({ event: "message", data: "a\nb" });
  });
});
