import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvent } from "@runtime-radar/shared";
import { EventStore } from "./store.js";

const directories: string[] = [];
const stores: EventStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("SQLite event history", () => {
  it("persists sessions, fingerprints, events, and counts a duplicate only once", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-radar-test-"));
    directories.push(directory);
    const store = new EventStore(directory);
    stores.push(store);
    const sessionId = "session-test";
    const start = createEvent(sessionId, "agent", "lifecycle", {
      state: "started",
      fingerprint: {
        appName: "fixture",
        appVersion: "1.0.0",
        gitCommit: "abc123",
        nodeVersion: "v22.0.0",
        platform: "win32",
        arch: "x64",
        pid: 42,
        processTitle: "fixture"
      }
    });
    const sample = createEvent(sessionId, "agent", "metric", {
      pid: 42, cpuPercent: 10, rssBytes: 1_000, heapUsedBytes: 200,
      heapTotalBytes: 500, externalBytes: 0, eventLoopLagMs: 2
    });
    store.ingest(start);
    store.ingest(sample);
    store.ingest(sample);
    const session = store.getSession(sessionId);
    expect(session?.processName).toBe("fixture");
    expect(session?.fingerprint?.gitCommit).toBe("abc123");
    expect(session?.eventCount).toBe(2);
    expect(store.events({ sessionId })).toHaveLength(2);
  });
});
