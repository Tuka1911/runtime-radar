import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { RuntimeEvent, RuntimeFingerprint, SessionSummary } from "@runtime-radar/shared";

export class EventStore {
  private readonly db: Database.Database;
  private writesSincePrune = 0;

  constructor(directory = path.resolve(process.cwd(), ".runtime-radar")) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new Database(path.join(directory, "events.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        ended_reason TEXT,
        process_name TEXT NOT NULL DEFAULT 'Node.js app',
        pid INTEGER NOT NULL DEFAULT 0,
        fingerprint_json TEXT,
        event_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        source TEXT NOT NULL,
        data_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session_time ON events(session_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS events_type_time ON events(type, timestamp DESC);
    `);
  }

  ingest(event: RuntimeEvent): void {
    const lifecycle = event.type === "lifecycle" ? event.data : undefined;
    const fingerprint = lifecycle?.fingerprint as RuntimeFingerprint | undefined;
    const state = lifecycle?.state;
    const processName = fingerprint?.appName ?? "Node.js app";
    const pid = typeof fingerprint?.pid === "number" ? fingerprint.pid : 0;
    const insertSession = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, started_at, process_name, pid, fingerprint_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO events (id, session_id, timestamp, type, severity, source, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => {
      insertSession.run(
        event.sessionId,
        event.timestamp,
        processName,
        pid,
        fingerprint ? JSON.stringify(fingerprint) : null
      );
      const inserted = insertEvent.run(
        event.id,
        event.sessionId,
        event.timestamp,
        event.type,
        event.severity ?? "info",
        event.source,
        JSON.stringify(event.data)
      );
      if (inserted.changes) {
        this.db.prepare("UPDATE sessions SET event_count = event_count + 1 WHERE id = ?").run(event.sessionId);
      }
      if (state === "stopped") {
        this.db.prepare("UPDATE sessions SET ended_at = ?, ended_reason = ? WHERE id = ?")
          .run(event.timestamp, String(lifecycle?.reason ?? "agent_stopped"), event.sessionId);
      }
      return inserted.changes;
    });
    if (transaction()) {
      this.writesSincePrune++;
    }
    if (this.writesSincePrune >= 1_000) {
      this.writesSincePrune = 0;
      this.db.exec(`
        DELETE FROM events
        WHERE id IN (
          SELECT id FROM events ORDER BY timestamp DESC LIMIT -1 OFFSET 100000
        );
        DELETE FROM sessions
        WHERE id NOT IN (SELECT DISTINCT session_id FROM events)
          AND id NOT IN (SELECT id FROM sessions ORDER BY started_at DESC LIMIT 200);
      `);
    }
  }

  markDisconnected(sessionId: string): void {
    this.db.prepare(`
      UPDATE sessions SET ended_at = ?, ended_reason = 'connection_lost_unknown'
      WHERE id = ? AND ended_at IS NULL
    `).run(Date.now(), sessionId);
  }

  sessions(limit = 50): SessionSummary[] {
    const rows = this.db.prepare(`
      SELECT id, started_at, ended_at, ended_reason, process_name, pid, fingerprint_json, event_count
      FROM sessions ORDER BY started_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      startedAt: Number(row.started_at),
      endedAt: row.ended_at === null ? null : Number(row.ended_at),
      endedReason: row.ended_reason === null ? null : String(row.ended_reason),
      processName: String(row.process_name),
      pid: Number(row.pid),
      fingerprint: row.fingerprint_json ? JSON.parse(String(row.fingerprint_json)) as RuntimeFingerprint : null,
      eventCount: Number(row.event_count)
    }));
  }

  getSession(id: string): SessionSummary | undefined {
    return this.sessions(200).find((session) => session.id === id);
  }

  events(options: {
    sessionId?: string;
    after?: number;
    types?: string[];
    limit?: number;
  } = {}): RuntimeEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.sessionId) {
      clauses.push("session_id = ?");
      params.push(options.sessionId);
    }
    if (options.after !== undefined && Number.isFinite(options.after)) {
      clauses.push("timestamp > ?");
      params.push(options.after);
    }
    if (options.types?.length) {
      clauses.push(`type IN (${options.types.map(() => "?").join(",")})`);
      params.push(...options.types);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(2_000, options.limit ?? 500));
    const rows = this.db.prepare(`
      SELECT id, timestamp, session_id, source, type, severity, data_json
      FROM events ${where} ORDER BY timestamp DESC LIMIT ?
    `).all(...params, limit) as Array<Record<string, unknown>>;
    return rows.reverse().map((row) => ({
      id: String(row.id),
      timestamp: Number(row.timestamp),
      sessionId: String(row.session_id),
      source: String(row.source),
      type: String(row.type) as RuntimeEvent["type"],
      severity: String(row.severity) as RuntimeEvent["severity"],
      data: JSON.parse(String(row.data_json)) as Record<string, unknown>
    }));
  }

  close(): void {
    this.db.close();
  }
}
