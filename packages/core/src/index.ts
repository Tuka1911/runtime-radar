import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  isRuntimeEvent,
  redactSensitive,
  DEFAULT_THRESHOLDS,
  type AnomalyThresholds,
  type RuntimeEvent
} from "@runtime-radar/shared";
import { AnomalyDetector } from "./anomalies.js";
import { EventStore } from "./store.js";

const HOST = "127.0.0.1";
function configuredPort(): number {
  const raw = process.env.RUNTIME_RADAR_PORT;
  if (raw === undefined) return 4318;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("RUNTIME_RADAR_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function positiveIntegerSetting(name: string, fallback: number): number {
  const value = threshold(name, fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a positive integer.`);
  return value;
}

const PORT = configuredPort();
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const runtimeDirectory = path.resolve(process.env.RUNTIME_RADAR_DATA_DIR ?? path.join(projectRoot, ".runtime-radar"));
fs.mkdirSync(runtimeDirectory, { recursive: true });

function getToken(): string {
  if (process.env.RUNTIME_RADAR_TOKEN) return process.env.RUNTIME_RADAR_TOKEN;
  const tokenPath = path.join(runtimeDirectory, "token");
  try {
    const token = fs.readFileSync(tokenPath, "utf8").trim();
    if (token.length >= 32) return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600, flag: "wx" });
  return token;
}

function threshold(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

const token = getToken();
if (token.length < 32) throw new Error("Runtime Radar token must contain at least 32 characters.");
const store = new EventStore(runtimeDirectory);
const streamClients = new Set<WebSocket>();
const connectedAgents = new Map<WebSocket, string>();
const agentSockets = new Set<WebSocket>();
const thresholds: AnomalyThresholds = {
  rssGrowthPercent: threshold("RUNTIME_RADAR_RSS_GROWTH_PERCENT", DEFAULT_THRESHOLDS.rssGrowthPercent),
  eventLoopLagMs: threshold("RUNTIME_RADAR_EVENT_LOOP_LAG_MS", DEFAULT_THRESHOLDS.eventLoopLagMs),
  http5xxCount: positiveIntegerSetting("RUNTIME_RADAR_HTTP_5XX_COUNT", DEFAULT_THRESHOLDS.http5xxCount),
  httpLatencyMs: threshold("RUNTIME_RADAR_HTTP_LATENCY_MS", DEFAULT_THRESHOLDS.httpLatencyMs),
  httpSlowCount: positiveIntegerSetting("RUNTIME_RADAR_HTTP_SLOW_COUNT", DEFAULT_THRESHOLDS.httpSlowCount),
  httpWindowMs: threshold("RUNTIME_RADAR_HTTP_WINDOW_MS", DEFAULT_THRESHOLDS.httpWindowMs),
  windowSamples: positiveIntegerSetting("RUNTIME_RADAR_MEMORY_WINDOW_SAMPLES", DEFAULT_THRESHOLDS.windowSamples)
};
const detector = new AnomalyDetector((event) => {
  store.ingest(event);
  broadcast(event);
}, thresholds);
const dashboardPath = path.join(projectRoot, "apps", "dashboard", "dist");

function broadcast(event: RuntimeEvent): void {
  const message = JSON.stringify(event);
  for (const client of streamClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message, (error) => {
        if (error) client.terminate();
      });
    }
  }
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    return loopback && parsed.protocol === "http:" && [String(PORT), "5173"].includes(parsed.port || "80");
  } catch {
    return false;
  }
}

function isAuthorized(request: http.IncomingMessage): boolean {
  const auth = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((item) => item.trim());
  const protocolCredential = protocols?.[0] === "runtime-radar-auth" ? protocols[1] : undefined;
  const supplied = auth || protocolCredential;
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(json);
}

function markdownReport(sessionId: string): string | undefined {
  const session = store.getSession(sessionId);
  if (!session) return undefined;
  const events = store.events({ sessionId, limit: 2_000 });
  const metrics = events.filter((event) => event.type === "metric");
  const httpEvents = events.filter((event) => event.type === "http");
  const errors = events.filter((event) => event.type === "error" || event.type === "anomaly");
  const median = (values: number[]): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const metricValue = (key: string): number[] => metrics
    .map((event) => Number(event.data[key]))
    .filter(Number.isFinite);
  const httpDurations = httpEvents.map((event) => Number(event.data.durationMs)).filter(Number.isFinite);
  const lines = [
    `# Runtime Radar report: ${session.processName}`,
    "",
    `- **Session:** \`${session.id}\``,
    `- **Started:** ${new Date(session.startedAt).toISOString()}`,
    `- **Ended:** ${session.endedAt ? new Date(session.endedAt).toISOString() : "Still running / end unknown"}`,
    `- **End reason:** ${session.endedReason ?? "Unknown"}`,
    `- **Events:** ${session.eventCount}`,
    "",
    "## Runtime fingerprint",
    "```json",
    JSON.stringify(session.fingerprint, null, 2),
    "```",
    "",
    "## Summary",
    `- Median CPU (one logical core = 100%): ${median(metricValue("cpuPercent"))?.toFixed(1) ?? "n/a"}%`,
    `- Peak RSS: ${metricValue("rssBytes").length ? (Math.max(...metricValue("rssBytes")) / 1024 / 1024).toFixed(1) : "n/a"} MiB`,
    `- Median event-loop lag: ${median(metricValue("eventLoopLagMs"))?.toFixed(1) ?? "n/a"} ms`,
    `- Median HTTP latency: ${median(httpDurations)?.toFixed(1) ?? "n/a"} ms`,
    `- HTTP requests: ${httpEvents.length}`,
    "",
    "## Incidents and errors",
    ...(errors.length ? errors : []).map((event) =>
      `- ${new Date(event.timestamp).toISOString()} **${event.type}** ${String(event.data.title ?? event.data.message ?? "")}`),
    ...(errors.length ? [] : ["- None recorded."]),
    "",
    "## Recent timeline",
    ...events.filter((event) => event.type !== "metric").slice(-100).map((event) =>
      `- ${new Date(event.timestamp).toISOString()} **${event.type}** ${JSON.stringify(event.data)}`)
  ];
  return `${lines.join("\n")}\n`;
}

function compareSessions(currentId: string, baselineId: string): unknown {
  const current = store.getSession(currentId);
  const baseline = store.getSession(baselineId);
  if (!current || current.endedAt !== null || !baseline || baseline.id === current.id) {
    return { error: "An active session and a different, valid baseline session are required." };
  }
  const metricsFor = (sessionId: string): Record<string, number[]> => {
    const events = store.events({ sessionId, types: ["metric", "http"], limit: 2_000 });
    const values: Record<string, number[]> = {
      cpuPercent: [],
      rssBytes: [],
      heapUsedBytes: [],
      eventLoopLagMs: [],
      httpLatencyMs: []
    };
    for (const event of events) {
      const key = event.type === "http" ? "httpLatencyMs" : "";
      if (key) {
        const value = Number(event.data.durationMs);
        if (Number.isFinite(value)) values[key].push(value);
      } else {
        for (const metric of ["cpuPercent", "rssBytes", "heapUsedBytes", "eventLoopLagMs"]) {
          const value = Number(event.data[metric]);
          if (Number.isFinite(value)) values[metric].push(value);
        }
      }
    }
    return values;
  };
  const median = (values: number[]): number | null => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const currentValues = metricsFor(current.id);
  const baselineValues = metricsFor(baseline.id);
  const result: Record<string, { current: number | null; baseline: number | null; changePercent: number | null }> = {};
  for (const key of Object.keys(currentValues)) {
    const now = median(currentValues[key]);
    const before = median(baselineValues[key]);
    result[key] = {
      current: now,
      baseline: before,
      changePercent: now === null || before === null || before === 0 ? null : ((now - before) / before) * 100
    };
  }
  return { currentSessionId: current.id, baselineSessionId: baseline.id, metrics: result };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (!isLoopbackHost(request.headers.host) || !isLoopbackOrigin(request.headers.origin)) {
    sendJson(response, 403, { error: "Loopback requests only." });
    return;
  }
  if (url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", agents: connectedAgents.size, now: Date.now() });
    return;
  }
  if (url.pathname === "/api/bootstrap") {
    sendJson(response, 200, { token, streamPath: "/stream" });
    return;
  }
  if (url.pathname.startsWith("/api/") && !isAuthorized(request)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/sessions") {
    sendJson(response, 200, { sessions: store.sessions(Number(url.searchParams.get("limit")) || 50) });
  } else if (request.method === "GET" && url.pathname === "/api/events") {
    const types = url.searchParams.get("types")?.split(",").filter(Boolean);
    sendJson(response, 200, {
      events: store.events({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        after: url.searchParams.has("after") ? Number(url.searchParams.get("after")) : undefined,
        types,
        limit: Number(url.searchParams.get("limit")) || 500
      })
    });
  } else if (request.method === "GET" && url.pathname === "/api/regression") {
    const baselineId = url.searchParams.get("baselineId") ?? "";
    const currentId = url.searchParams.get("sessionId") ?? "";
    const comparison = compareSessions(currentId, baselineId) as { error?: string };
    sendJson(response, comparison.error ? 400 : 200, comparison);
  } else if (request.method === "GET" && url.pathname === "/api/export") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const format = url.searchParams.get("format") ?? "json";
    const session = store.getSession(sessionId);
    if (!session) {
      sendJson(response, 404, { error: "Session not found." });
    } else if (format === "markdown") {
      const report = markdownReport(sessionId) ?? "";
      response.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": "attachment; filename=\"runtime-radar-report.md\"",
        "content-length": Buffer.byteLength(report),
        "cache-control": "no-store"
      });
      response.end(report);
    } else if (format === "json") {
      const report = JSON.stringify({
        exportedAt: new Date().toISOString(),
        session,
        events: store.events({ sessionId, limit: 2_000 })
      }, null, 2);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": "attachment; filename=\"runtime-radar-report.json\"",
        "content-length": Buffer.byteLength(report),
        "cache-control": "no-store"
      });
      response.end(report);
    } else {
      sendJson(response, 400, { error: "Format must be json or markdown." });
    }
  } else if (request.method === "GET" && url.pathname === "/api/summary") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const events = store.events({ sessionId, types: ["metric", "http", "error", "anomaly"], limit: 2_000 });
    const metrics = events.filter((event) => event.type === "metric");
    const requests = events.filter((event) => event.type === "http");
    sendJson(response, 200, {
      metrics: metrics.slice(-60),
      requests: requests.slice(-100),
      incidents: events.filter((event) => event.type === "error" || event.type === "anomaly").slice(-100)
    });
  } else {
    let assetPath: string;
    try {
      assetPath = path.resolve(dashboardPath, `.${decodeURIComponent(url.pathname)}`);
    } catch {
      sendJson(response, 400, { error: "Invalid URL path." });
      return;
    }
    const requestedPath = url.pathname === "/" ? path.join(dashboardPath, "index.html") : assetPath;
    const withinDashboard = requestedPath.startsWith(`${dashboardPath}${path.sep}`);
    if (withinDashboard && fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
      const contentType = requestedPath.endsWith(".html") ? "text/html; charset=utf-8"
        : requestedPath.endsWith(".js") ? "text/javascript; charset=utf-8"
        : requestedPath.endsWith(".css") ? "text/css"
          : requestedPath.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
      response.writeHead(200, { "content-type": contentType, "x-content-type-options": "nosniff" });
      fs.createReadStream(requestedPath).pipe(response);
    } else {
      sendJson(response, 404, { error: "Not found." });
    }
  }
});

const wsServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
  if (!isLoopbackHost(request.headers.host) || !isLoopbackOrigin(request.headers.origin) ||
      !["/agent", "/stream"].includes(url.pathname) || !isAuthorized(request)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (url.pathname === "/agent" && agentSockets.size >= 32) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wsServer.handleUpgrade(request, socket, head, (websocket) => {
    wsServer.emit("connection", websocket, request);
  });
});

wsServer.on("connection", (websocket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
  if (url.pathname === "/stream") {
    streamClients.add(websocket);
    websocket.once("close", () => streamClients.delete(websocket));
    return;
  }
  agentSockets.add(websocket);
  let eventCount = 0;
  let windowStart = Date.now();
  websocket.on("message", (raw) => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      eventCount = 0;
    }
    if (++eventCount > 6_000) {
      websocket.close(1008, "Event rate limit exceeded");
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      websocket.close(1007, "Invalid JSON");
      return;
    }
    if (!isRuntimeEvent(event)) {
      websocket.close(1008, "Invalid runtime event");
      return;
    }
    const safeEvent = {
      ...event,
      data: redactSensitive(event.data) as Record<string, unknown>
    };
    const attachedSession = connectedAgents.get(websocket);
    if (attachedSession && attachedSession !== safeEvent.sessionId) {
      websocket.close(1008, "An agent connection cannot switch sessions.");
      return;
    }
    if (!attachedSession) connectedAgents.set(websocket, safeEvent.sessionId);
    try {
      store.ingest(safeEvent);
      detector.accept(safeEvent);
    } catch (error) {
      console.error("Failed to persist runtime event:", error);
      websocket.close(1011, "Failed to persist runtime event");
      return;
    }
    broadcast(safeEvent);
    if (safeEvent.type === "lifecycle" && safeEvent.data.state === "stopped") {
      connectedAgents.delete(websocket);
    }
  });
  websocket.once("close", () => {
    const sessionId = connectedAgents.get(websocket);
    if (sessionId) {
      store.markDisconnected(sessionId);
      detector.dropSession(sessionId);
    }
    connectedAgents.delete(websocket);
    agentSockets.delete(websocket);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Runtime Radar Core listening on http://${HOST}:${PORT}`);
  console.log(`Agent WebSocket: ws://${HOST}:${PORT}/agent`);
  console.log(`Local agent token: ${token}`);
  if (fs.existsSync(path.join(dashboardPath, "index.html"))) {
    console.log(`Dashboard: http://${HOST}:${PORT}`);
  } else {
    console.log("Dashboard dev server: http://127.0.0.1:5173");
  }
});

function shutdown(): void {
  for (const client of wsServer.clients) client.close(1001, "Core shutting down");
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
