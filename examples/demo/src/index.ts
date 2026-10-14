import express from "express";
import { httpMiddleware, startAgent } from "@runtime-radar/agent";

const app = express();
const agent = startAgent({ appName: "runtime-radar-demo", appVersion: "0.1.0" });
const retainedBuffers: Buffer[] = [];

app.use(httpMiddleware(agent));

app.use((request, response, next) => {
  response.once("finish", () => {
    console.info("Demo response", {
      route: request.route?.path ?? "/unmatched",
      statusCode: response.statusCode
    });
  });
  next();
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok", now: Date.now() });
});

app.get("/slow", async (_request, response) => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  response.json({ status: "slow", durationMs: 800 });
});

app.get("/busy", (request, response) => {
  const duration = Math.max(10, Math.min(1_000, Number(request.query.ms) || 250));
  const end = Date.now() + duration;
  while (Date.now() < end) Math.sqrt(Math.random() * 10_000);
  response.json({ status: "busy", durationMs: duration });
});

app.get("/memory", (request, response) => {
  const megabytes = Math.max(1, Math.min(16, Number(request.query.mb) || 4));
  const allocation = Buffer.alloc(megabytes * 1024 * 1024, 7);
  retainedBuffers.push(allocation);
  setTimeout(() => {
    const index = retainedBuffers.indexOf(allocation);
    if (index >= 0) retainedBuffers.splice(index, 1);
  }, 30_000).unref();
  response.json({ status: "allocated", megabytes, releasedAfterSeconds: 30 });
});

app.get("/fail", (_request, response) => {
  const error = new Error("Synthetic demo failure");
  agent.captureError(error, { route: "/fail", synthetic: true });
  response.status(500).json({ error: error.message, synthetic: true });
});

const port = Number(process.env.DEMO_PORT) || 4320;
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Demo app listening on http://127.0.0.1:${port}`);
});

function shutdown(): void {
  server.close(() => {
    agent.stop();
    process.exitCode = 0;
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
