import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createEvent,
  isRuntimeEvent,
  redactSensitive,
  type RuntimeEvent,
  type RuntimeFingerprint
} from "@runtime-radar/shared";
import { collectMetrics, disableMetrics, enableMetrics } from "./metrics.js";
import { AgentTransport } from "./transport.js";

export interface AgentOptions {
  url?: string;
  token?: string;
  intervalMs?: number;
  appName?: string;
  appVersion?: string;
  gitCommit?: string;
  captureConsole?: boolean;
}

export interface RuntimeRadarAgent {
  sessionId: string;
  captureError(error: unknown, context?: Record<string, unknown>): void;
  captureHttp(data: Record<string, unknown>, severity?: "info" | "warning" | "critical"): void;
  stop(): void;
}

let agentStarted = false;

function fingerprint(options: AgentOptions): RuntimeFingerprint {
  return {
    appName: options.appName ?? process.env.RUNTIME_RADAR_APP_NAME ?? process.title,
    appVersion: options.appVersion ?? process.env.RUNTIME_RADAR_APP_VERSION ?? "unknown",
    gitCommit: options.gitCommit ?? process.env.RUNTIME_RADAR_GIT_COMMIT ?? "unknown",
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    processTitle: process.title
  };
}

export function startAgent(options: AgentOptions = {}): RuntimeRadarAgent {
  if (agentStarted) throw new Error("Only one Runtime Radar agent can be started per Node.js process.");
  const sessionId = randomUUID();
  const url = options.url ?? process.env.RUNTIME_RADAR_URL ?? "ws://127.0.0.1:4318/agent";
  const token = options.token ?? process.env.RUNTIME_RADAR_TOKEN;
  const configuredInterval = options.intervalMs !== undefined
    ? options.intervalMs
    : process.env.RUNTIME_RADAR_INTERVAL_MS !== undefined
      ? Number(process.env.RUNTIME_RADAR_INTERVAL_MS)
      : 1_000;
  if (!Number.isFinite(configuredInterval) || configuredInterval <= 0) {
    agentStarted = false;
    throw new Error("Runtime Radar interval must be a positive number.");
  }
  if (token && token.length < 32) {
    throw new Error("Runtime Radar token must contain at least 32 characters.");
  }
  if (url) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("Runtime Radar URL must be an absolute ws:// or wss:// URL.");
    }
    if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
      throw new Error("Runtime Radar URL must use the ws:// or wss:// protocol.");
    }
  }
  agentStarted = true;
  const intervalMs = Math.max(250, Math.min(60_000, configuredInterval));
  const transport = url && token ? new AgentTransport(url, token) : undefined;
  if (!transport) {
    process.stderr.write("[Runtime Radar] Agent is not connected: set RUNTIME_RADAR_URL and RUNTIME_RADAR_TOKEN.\n");
  }
  const send = (event: RuntimeEvent): void => {
    if (!transport) return;
    if (!isRuntimeEvent(event)) {
      process.stderr.write("[Runtime Radar] Dropped an invalid or oversized event.\n");
      return;
    }
    transport.send(event);
  };
  const emit = (type: RuntimeEvent["type"], data: Record<string, unknown>, severity?: RuntimeEvent["severity"]): void => {
    send(createEvent(sessionId, "node-agent", type, redactSensitive(data) as Record<string, unknown>, severity));
  };

  try {
    transport?.start();
  } catch (error) {
    agentStarted = false;
    throw error;
  }
  enableMetrics();
  emit("lifecycle", { state: "started", fingerprint: fingerprint(options) });

  const timer = setInterval(() => {
    try {
      emit("metric", collectMetrics());
    } catch (error) {
      emit("error", {
        name: "MetricCollectionError",
        message: error instanceof Error ? error.message : String(error)
      }, "warning");
    }
  }, intervalMs);
  timer.unref();

  let originals: Map<"log" | "info" | "warn" | "error" | "debug", (...args: unknown[]) => void> | undefined;
  let wrappers: Map<"log" | "info" | "warn" | "error" | "debug", typeof console.log> | undefined;
  if (options.captureConsole !== false) {
    originals = new Map();
    wrappers = new Map();
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      const original = console[level] as (...args: unknown[]) => void;
      originals.set(level, original);
      const wrapper = ((...args: unknown[]) => {
        original.apply(console, args);
        try {
          emit("log", {
            level: level === "log" || level === "info" || level === "debug" ? "info" : level,
            message: args.map((item) => {
              if (item instanceof Error) return `${item.name}: ${item.message}`;
              return typeof item === "string" ? item : JSON.stringify(redactSensitive(item));
            }).join(" ").slice(0, 8_000)
          }, level === "error" ? "warning" : "info");
        } catch (error) {
          process.stderr.write(`[Runtime Radar] Failed to capture console output: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }) as typeof console.log;
      wrappers.set(level, wrapper);
      console[level] = wrapper;
    }
  }

  const onUncaughtException = (error: Error): void => {
    emit("error", {
      name: error.name.slice(0, 256),
      message: error.message.slice(0, 8_000),
      stack: error.stack?.slice(0, 16_000)
    }, "critical");
  };
  process.on("uncaughtExceptionMonitor", onUncaughtException);

  const captureError = (error: unknown, context: Record<string, unknown> = {}): void => {
    emit("error", {
      name: error instanceof Error ? error.name : "Error",
      message: (error instanceof Error ? error.message : String(error)).slice(0, 8_000),
      stack: error instanceof Error ? error.stack?.slice(0, 16_000) : undefined,
      context
    }, "critical");
  };

  let stopped = false;
  return {
    sessionId,
    captureError,
    captureHttp(data, severity = "info") {
      emit("http", data, severity);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.off("uncaughtExceptionMonitor", onUncaughtException);
      if (originals) {
        for (const [level, original] of originals) {
          if (console[level] === wrappers?.get(level)) {
            console[level] = original as typeof console[typeof level];
          }
        }
      }
      emit("lifecycle", { state: "stopped", reason: "agent.stop()" });
      transport?.stop();
      disableMetrics();
      agentStarted = false;
    }
  };
}

export function httpMiddleware(agent: RuntimeRadarAgent) {
  return (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void): void => {
    const startedAt = process.hrtime.bigint();
    const route = (request as IncomingMessage & {
      route?: { path?: string | string[] };
    });
    const onFinish = (): void => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const routePath = route.route?.path;
      const normalizedRoute = routePath
        ? Array.isArray(routePath) ? routePath[0] : routePath
        : "/unmatched";
      const statusCode = response.statusCode;
      const severity = statusCode >= 500 ? "critical" : statusCode >= 400 ? "warning" : "info";
      agent.captureHttp({
        method: request.method?.toUpperCase() ?? "UNKNOWN",
        route: normalizedRoute.slice(0, 256),
        statusCode,
        durationMs: Number(durationMs.toFixed(2))
      }, severity);
    };
    response.once("finish", onFinish);
    next();
  };
}
