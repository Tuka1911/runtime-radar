import { describe, expect, it } from "vitest";
import { createEvent, DEFAULT_THRESHOLDS, type AnomalyThresholds, type RuntimeEvent } from "@runtime-radar/shared";
import { AnomalyDetector } from "./anomalies.js";

function metric(sessionId: string, timestamp: number, rssBytes: number, lagMs: number): RuntimeEvent {
  return {
    ...createEvent(sessionId, "test", "metric", {
      pid: 1,
      cpuPercent: 1,
      rssBytes,
      heapUsedBytes: rssBytes / 2,
      heapTotalBytes: rssBytes,
      externalBytes: 0,
      eventLoopLagMs: lagMs
    }),
    timestamp
  };
}

describe("explainable anomaly rules", () => {
  it("raises an event-loop delay incident after three consecutive samples", () => {
    const alerts: RuntimeEvent[] = [];
    const thresholds: AnomalyThresholds = { ...DEFAULT_THRESHOLDS, windowSamples: 3, eventLoopLagMs: 80 };
    const detector = new AnomalyDetector((event) => alerts.push(event), thresholds);
    for (let i = 0; i < 3; i++) detector.accept(metric("session-a", 1_000 + i * 1_000, 100, 90));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data.key).toBe("event-loop-lag");
  });

  it("detects sustained RSS growth and rate-limits duplicate alerts", () => {
    const alerts: RuntimeEvent[] = [];
    const detector = new AnomalyDetector((event) => alerts.push(event), {
      ...DEFAULT_THRESHOLDS,
      windowSamples: 3,
      rssGrowthPercent: 25,
      eventLoopLagMs: 100_000
    });
    detector.accept(metric("session-b", 1_000, 100, 0));
    detector.accept(metric("session-b", 2_000, 120, 0));
    detector.accept(metric("session-b", 3_000, 140, 0));
    detector.accept(metric("session-b", 4_000, 150, 0));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data.key).toBe("rss-growth");
  });

  it("groups repeated slow HTTP responses into an anomaly", () => {
    const alerts: RuntimeEvent[] = [];
    const thresholds: AnomalyThresholds = {
      ...DEFAULT_THRESHOLDS,
      httpLatencyMs: 250,
      httpSlowCount: 2
    };
    const detector = new AnomalyDetector((event) => alerts.push(event), thresholds);
    for (let index = 0; index < 2; index++) {
      detector.accept(createEvent("session-c", "test", "http", {
        method: "GET", route: "/slow", statusCode: 200, durationMs: 300
      }));
    }
    expect(alerts).toHaveLength(1);
    expect(alerts[0].data.key).toBe("http-latency-spike");
  });
});
