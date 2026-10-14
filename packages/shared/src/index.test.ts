import { describe, expect, it } from "vitest";
import { createEvent, isRuntimeEvent, redactSensitive } from "./index.js";

describe("runtime event contract", () => {
  it("accepts a valid event and rejects oversized or malformed messages", () => {
    const event = createEvent("session-1", "test", "log", { level: "info", message: "ready" });
    expect(isRuntimeEvent(event)).toBe(true);
    expect(isRuntimeEvent({ ...event, timestamp: Number.NaN })).toBe(false);
    expect(isRuntimeEvent({ ...event, data: { level: "info", message: "x".repeat(65_000) } })).toBe(false);
    expect(isRuntimeEvent({ ...event, type: "metric", data: { rssBytes: "large" } })).toBe(false);
  });

  it("redacts sensitive fields and bearer credentials recursively", () => {
    expect(redactSensitive({
      token: "abc",
      nested: { password: "secret" },
      message: "Authorization: Bearer abc.def.ghi"
    })).toEqual({
      token: "[REDACTED]",
      nested: { password: "[REDACTED]" },
      message: "Authorization: [REDACTED]"
    });
  });
});
