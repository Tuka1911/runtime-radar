import { createEvent, DEFAULT_THRESHOLDS, type AnomalyThresholds, type RuntimeEvent } from "@runtime-radar/shared";

export class AnomalyDetector {
  private readonly metricWindows = new Map<string, Array<{ timestamp: number; rss: number; lag: number }>>();
  private readonly errors = new Map<string, number[]>();
  private readonly slowRequests = new Map<string, number[]>();
  private readonly emitted = new Map<string, number>();

  constructor(
    private readonly publish: (event: RuntimeEvent) => void,
    private readonly thresholds: AnomalyThresholds = DEFAULT_THRESHOLDS
  ) {}

  dropSession(sessionId: string): void {
    this.metricWindows.delete(sessionId);
    this.errors.delete(sessionId);
    this.slowRequests.delete(sessionId);
    for (const key of this.emitted.keys()) {
      if (key.startsWith(`${sessionId}:`)) this.emitted.delete(key);
    }
  }

  accept(event: RuntimeEvent): void {
    if (event.type === "metric") this.acceptMetric(event);
    if (event.type === "http") {
      if (Number(event.data.statusCode) >= 500) this.acceptHttpError(event);
      if (Number(event.data.durationMs) >= this.thresholds.httpLatencyMs) this.acceptSlowRequest(event);
    }
  }

  private alert(event: RuntimeEvent, key: string, title: string, details: string): void {
    const eventKey = `${event.sessionId}:${key}`;
    const last = this.emitted.get(eventKey);
    if (last !== undefined && event.timestamp - last < 60_000) return;
    this.emitted.set(eventKey, event.timestamp);
    this.publish(createEvent(event.sessionId, "anomaly-detector", "anomaly", {
      key,
      title,
      details,
      relatedEventId: event.id
    }, "warning"));
  }

  private acceptMetric(event: RuntimeEvent): void {
    const rss = Number(event.data.rssBytes);
    const lag = Number(event.data.eventLoopLagMs);
    if (!Number.isFinite(rss) || !Number.isFinite(lag)) return;

    const samples = this.metricWindows.get(event.sessionId) ?? [];
    samples.push({ timestamp: event.timestamp, rss, lag });
    while (samples.length > Math.max(this.thresholds.windowSamples, 12)) samples.shift();
    this.metricWindows.set(event.sessionId, samples);

    if (lag >= this.thresholds.eventLoopLagMs) {
      const consecutive = [...samples].reverse().slice(0, 3).every((sample) =>
        sample.lag >= this.thresholds.eventLoopLagMs
      );
      if (consecutive) {
        this.alert(event, "event-loop-lag", "Event loop is persistently delayed",
          `Event-loop lag exceeded ${this.thresholds.eventLoopLagMs} ms for at least three samples.`);
      }
    }

    if (samples.length >= this.thresholds.windowSamples) {
      const first = samples[0];
      const increasePercent = first.rss > 0 ? ((rss - first.rss) / first.rss) * 100 : 0;
      if (increasePercent >= this.thresholds.rssGrowthPercent) {
        this.alert(event, "rss-growth", "Rapid RSS growth detected",
          `RSS increased ${increasePercent.toFixed(1)}% across ${samples.length} samples.`);
      }
    }
  }

  private acceptHttpError(event: RuntimeEvent): void {
    const timestamps = this.errors.get(event.sessionId) ?? [];
    timestamps.push(event.timestamp);
    const cutoff = event.timestamp - this.thresholds.httpWindowMs;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    this.errors.set(event.sessionId, timestamps);
    if (timestamps.length >= this.thresholds.http5xxCount) {
      this.alert(event, "http-5xx-spike", "HTTP 5xx spike detected",
        `${timestamps.length} server errors occurred in the last ${Math.round(this.thresholds.httpWindowMs / 1_000)} seconds.`);
    }
  }

  private acceptSlowRequest(event: RuntimeEvent): void {
    const timestamps = this.slowRequests.get(event.sessionId) ?? [];
    timestamps.push(event.timestamp);
    const cutoff = event.timestamp - this.thresholds.httpWindowMs;
    while (timestamps.length && timestamps[0] < cutoff) timestamps.shift();
    this.slowRequests.set(event.sessionId, timestamps);
    if (timestamps.length >= this.thresholds.httpSlowCount) {
      this.alert(event, "http-latency-spike", "Slow HTTP responses detected",
        `${timestamps.length} requests exceeded ${this.thresholds.httpLatencyMs} ms in the last ${Math.round(this.thresholds.httpWindowMs / 1_000)} seconds.`);
    }
  }
}
