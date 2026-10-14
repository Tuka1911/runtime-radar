import { describe, expect, it } from "vitest";
import { collectMetrics, disableMetrics } from "./metrics.js";

describe("process metrics collector", () => {
  it("returns finite CPU and event-loop values with process memory counters", () => {
    const first = collectMetrics();
    const second = collectMetrics();
    expect(first.pid).toBe(process.pid);
    expect(second.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(second.cpuPercent)).toBe(true);
    expect(second.rssBytes).toBeGreaterThan(0);
    expect(second.heapUsedBytes).toBeGreaterThan(0);
    expect(Number.isFinite(second.eventLoopLagMs)).toBe(true);
    disableMetrics();
  });
});
