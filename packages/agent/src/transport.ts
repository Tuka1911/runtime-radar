import WebSocket from "ws";
import type { RuntimeEvent } from "@runtime-radar/shared";

const MAX_BUFFERED_EVENTS = 250;

export class AgentTransport {
  private socket: WebSocket | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryMs = 500;
  private stopped = false;
  private readonly buffer: RuntimeEvent[] = [];

  constructor(private readonly url: string, private readonly token: string) {}

  start(): void {
    this.connect();
  }

  send(event: RuntimeEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(event));
      return;
    }
    if (this.buffer.length === MAX_BUFFERED_EVENTS) this.buffer.shift();
    this.buffer.push(event);
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.close(1000, "Agent stopped");
    this.socket = undefined;
    this.buffer.length = 0;
  }

  private connect(): void {
    if (this.stopped) return;
    this.socket = new WebSocket(this.url, {
      headers: { authorization: `Bearer ${this.token}` },
      maxPayload: 64 * 1024
    });
    this.socket.on("open", () => {
      this.retryMs = 500;
      while (this.buffer.length && this.socket?.readyState === WebSocket.OPEN) {
        const item = this.buffer.shift();
        if (item) this.socket.send(JSON.stringify(item));
      }
    });
    this.socket.on("error", (error) => {
      process.stderr.write(`[Runtime Radar] Connection failed; retrying: ${error.message}\n`);
    });
    this.socket.on("close", () => {
      this.socket = undefined;
      if (this.stopped) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retryMs);
      this.retryTimer.unref();
      this.retryMs = Math.min(this.retryMs * 2, 15_000);
    });
  }
}
