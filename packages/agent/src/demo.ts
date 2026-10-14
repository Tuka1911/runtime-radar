import { startAgent } from "./index.js";

const agent = startAgent({ appName: "runtime-radar-demo" });
let requestCount = 0;
const interval = setInterval(() => {
  requestCount++;
  if (requestCount % 10 === 0) console.warn("Demo warning: periodic synthetic warning");
  if (requestCount % 20 === 0) agent.captureError(new Error("Synthetic demo error"), { requestCount });
}, 1_000);

function shutdown(): void {
  clearInterval(interval);
  agent.stop();
  process.exitCode = 0;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
