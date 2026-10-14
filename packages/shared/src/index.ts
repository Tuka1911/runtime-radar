export type EventType = "metric" | "log" | "http" | "error" | "anomaly" | "lifecycle";
export type Severity = "info" | "warning" | "critical";

export interface RuntimeEvent<T extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  timestamp: number;
  sessionId: string;
  source: string;
  type: EventType;
  severity?: Severity;
  data: T;
}

export interface RuntimeFingerprint {
  appName: string;
  appVersion: string;
  gitCommit: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  pid: number;
  processTitle: string;
}

export interface MetricData extends Record<string, unknown> {
  pid: number;
  cpuPercent: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  eventLoopLagMs: number;
}

export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number | null;
  endedReason: string | null;
  processName: string;
  pid: number;
  fingerprint: RuntimeFingerprint | null;
  eventCount: number;
}

export interface AnomalyThresholds {
  rssGrowthPercent: number;
  eventLoopLagMs: number;
  http5xxCount: number;
  httpLatencyMs: number;
  httpSlowCount: number;
  httpWindowMs: number;
  windowSamples: number;
}

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  rssGrowthPercent: 25,
  eventLoopLagMs: 100,
  http5xxCount: 5,
  httpLatencyMs: 500,
  httpSlowCount: 3,
  httpWindowMs: 60_000,
  windowSamples: 60
};

const eventTypes = new Set<EventType>(["metric", "log", "http", "error", "anomaly", "lifecycle"]);
const severities = new Set<Severity>(["info", "warning", "critical"]);
const MAX_SERIALIZED_EVENT_BYTES = 64 * 1024;

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "string" || event.id.length === 0 || event.id.length > 128 ||
    typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp) ||
    typeof event.sessionId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(event.sessionId) ||
    typeof event.source !== "string" || event.source.length === 0 || event.source.length > 128 ||
    typeof event.type !== "string" || !eventTypes.has(event.type as EventType) ||
    !event.data || typeof event.data !== "object" || Array.isArray(event.data)
  ) return false;
  if (event.severity !== undefined && !severities.has(event.severity as Severity)) return false;
  const data = event.data as Record<string, unknown>;
  const finite = (key: string): boolean => typeof data[key] === "number" && Number.isFinite(data[key]);
  switch (event.type as EventType) {
    case "metric":
      if (!["cpuPercent", "rssBytes", "heapUsedBytes", "heapTotalBytes", "externalBytes", "eventLoopLagMs", "pid"].every(finite)) return false;
      if (Number(data.pid) <= 0 || Number(data.rssBytes) < 0 || Number(data.heapUsedBytes) < 0 ||
          Number(data.heapTotalBytes) < 0 || Number(data.externalBytes) < 0 || Number(data.eventLoopLagMs) < 0) return false;
      break;
    case "log":
      if (!["info", "warn", "error"].includes(String(data.level)) ||
          typeof data.message !== "string" || data.message.length > 8_000) return false;
      break;
    case "http":
      if (typeof data.method !== "string" || !/^[A-Z!#$%&'*+.^_`|~-]{1,32}$/.test(data.method) ||
          typeof data.route !== "string" || !data.route.startsWith("/") || data.route.length > 256 ||
          !finite("statusCode") || !Number.isInteger(data.statusCode) || Number(data.statusCode) < 100 ||
          Number(data.statusCode) > 599 || !finite("durationMs") || Number(data.durationMs) < 0) return false;
      break;
    case "error":
      if (typeof data.name !== "string" || typeof data.message !== "string" ||
          data.name.length > 256 || data.message.length > 8_000 ||
          (data.stack !== undefined && typeof data.stack !== "string")) return false;
      break;
    case "anomaly":
      if (typeof data.key !== "string" || typeof data.title !== "string" ||
          typeof data.details !== "string" || data.title.length > 256 || data.details.length > 2_000) return false;
      break;
    case "lifecycle":
      if (data.state === "stopped") {
        if (typeof data.reason !== "string") return false;
      } else if (data.state === "started") {
        const fingerprint = data.fingerprint;
        if (!fingerprint || typeof fingerprint !== "object" || Array.isArray(fingerprint)) return false;
        const runtime = fingerprint as Record<string, unknown>;
        if (!["appName", "appVersion", "gitCommit", "nodeVersion", "platform", "arch", "processTitle"]
          .every((key) => typeof runtime[key] === "string") ||
          typeof runtime.pid !== "number" || !Number.isInteger(runtime.pid) || runtime.pid <= 0) return false;
      } else return false;
      break;
  }
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SERIALIZED_EVENT_BYTES;
  } catch {
    return false;
  }
}

export function createEvent<T extends Record<string, unknown>>(
  sessionId: string,
  source: string,
  type: EventType,
  data: T,
  severity?: Severity
): RuntimeEvent<T> {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`,
    timestamp: Date.now(),
    sessionId,
    source,
    type,
    ...(severity ? { severity } : {}),
    data
  };
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[MaxDepth]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitive(item, depth + 1));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      result[key] = /password|passwd|secret|token|authorization|cookie|api[-_]?key/i.test(key)
        ? "[REDACTED]"
        : redactSensitive(item, depth + 1);
    }
    return result;
  }
  if (typeof value === "string") {
    return value
      .replace(/\b(authorization\s*[:=]\s*)Bearer\s+[\w.\-~+/]+=*/gi, "$1[REDACTED]")
      .replace(/\b(Bearer\s+)[\w.\-~+/]+=*/gi, "$1[REDACTED]")
      .replace(/((?:password|passwd|secret|token|authorization|cookie|api[-_]?key)\s*[:=]\s*)[^,\s;]+/gi, "$1[REDACTED]")
      .slice(0, 8_000);
  }
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  return String(value).slice(0, 1_000);
}
