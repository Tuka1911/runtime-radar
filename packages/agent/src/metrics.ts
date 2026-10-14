import { monitorEventLoopDelay } from "node:perf_hooks";
import type { MetricData } from "@runtime-radar/shared";

const eventLoop = monitorEventLoopDelay({ resolution: 20 });
let previousCpu = process.cpuUsage();
let previousTime = process.hrtime.bigint();
let enabled = false;

export function enableMetrics(): void {
  if (enabled) return;
  eventLoop.enable();
  previousCpu = process.cpuUsage();
  previousTime = process.hrtime.bigint();
  enabled = true;
}

export function collectMetrics(): MetricData {
  enableMetrics();
  const now = process.hrtime.bigint();
  const elapsedMicros = Number(now - previousTime) / 1_000;
  const cpu = process.cpuUsage(previousCpu);
  const memory = process.memoryUsage();
  const cpuPercent = elapsedMicros > 0 ? ((cpu.user + cpu.system) / elapsedMicros) * 100 : 0;
  const lag = eventLoop.mean / 1e6;

  previousCpu = process.cpuUsage();
  previousTime = now;
  eventLoop.reset();

  return {
    pid: process.pid,
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    eventLoopLagMs: Number.isFinite(lag) ? lag : 0
  };
}

export function disableMetrics(): void {
  if (!enabled) return;
  eventLoop.disable();
  enabled = false;
}
