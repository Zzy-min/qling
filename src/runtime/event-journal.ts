import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  RuntimeToolCallRecord,
  SessionEventEnvelope,
  SessionSnapshot,
  JsonValue,
} from "./types.js";

interface JournalOptions {
  stateDir: string;
  sessionId: string;
  now?: () => number;
}

interface PendingEvent {
  type: string;
  payload?: JsonValue;
  runId?: string;
  turnId?: string;
  causationId?: string;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultSnapshot(sessionId: string, now: number): SessionSnapshot {
  return {
    sessionId,
    state: "idle",
    sequence: 0,
    promptQueue: [],
    activeRun: null,
    pendingApproval: null,
    activeTools: [],
    recentEvidence: [],
    budget: {},
    updatedAt: now,
  };
}

export class RuntimeEventJournal {
  private readonly dbPath: string;
  private readonly sessionId: string;
  private readonly now: () => number;
  private db: Database.Database | null = null;
  private sequence = 0;

  constructor(options: JournalOptions) {
    this.dbPath = path.join(options.stateDir, "runtime.db");
    this.sessionId = options.sessionId;
    this.now = options.now ?? (() => Date.now());
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    await fs.chmod(this.dbPath, 0o600).catch(() => undefined);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_events (
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        run_id TEXT,
        turn_id TEXT,
        causation_id TEXT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        checksum TEXT NOT NULL,
        PRIMARY KEY (session_id, sequence),
        UNIQUE (event_id)
      );
      CREATE TABLE IF NOT EXISTS runtime_snapshots (
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS runtime_tool_calls (
        session_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        arguments_hash TEXT NOT NULL,
        side_effect TEXT NOT NULL,
        idempotent INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        PRIMARY KEY (session_id, tool_call_id)
      );
      CREATE TABLE IF NOT EXISTS runtime_event_quarantine (
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        raw_event TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (session_id, sequence)
      );
    `);
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM runtime_events WHERE session_id = ?")
      .get(this.sessionId) as { sequence: number };
    this.sequence = Number(row.sequence ?? 0);
  }

  async append(event: PendingEvent): Promise<SessionEventEnvelope> {
    const db = this.requireDb();
    const timestamp = this.now();
    const payload = event.payload ?? {};
    const serializedPayload = JSON.stringify(payload);
    const insert = db.transaction(() => {
      const row = db
        .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM runtime_events WHERE session_id = ?")
        .get(this.sessionId) as { sequence: number };
      const sequence = Number(row.sequence ?? 0) + 1;
      const base = {
        eventId: `evt_${timestamp.toString(36)}_${sequence.toString(36)}_${randomUUID().slice(0, 8)}`,
        sequence,
        sessionId: this.sessionId,
        ...(event.runId ? { runId: event.runId } : {}),
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.causationId ? { causationId: event.causationId } : {}),
        type: event.type,
        timestamp,
        payload,
      };
      const eventChecksum = checksum(base);
      db.prepare(`
      INSERT INTO runtime_events (
        session_id, sequence, event_id, run_id, turn_id, causation_id,
        type, timestamp, payload, checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.sessionId,
        sequence,
        base.eventId,
        base.runId ?? null,
        base.turnId ?? null,
        base.causationId ?? null,
        base.type,
        timestamp,
        serializedPayload,
        eventChecksum
      );
      return { ...base, checksum: eventChecksum };
    });
    const inserted = insert();
    this.sequence = Math.max(this.sequence, inserted.sequence);
    return inserted;
  }

  async saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
    const db = this.requireDb();
    if (snapshot.sessionId !== this.sessionId) {
      throw new Error("runtime snapshot session mismatch");
    }
    const maxEvent = this.requireDb()
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM runtime_events WHERE session_id = ?")
      .get(this.sessionId) as { sequence: number };
    if (snapshot.sequence > Number(maxEvent.sequence ?? 0)) {
      throw new Error("runtime snapshot sequence exceeds durable event log");
    }
    const serialized = JSON.stringify(snapshot);
    db.prepare(`
      INSERT INTO runtime_snapshots (session_id, sequence, snapshot, checksum, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id, sequence) DO UPDATE SET
        snapshot = excluded.snapshot,
        checksum = excluded.checksum,
        created_at = excluded.created_at
    `).run(this.sessionId, snapshot.sequence, serialized, checksum(snapshot), this.now());
  }

  async replay(afterSequence = 0): Promise<SessionEventEnvelope[]> {
    const rows = this.requireDb().prepare(`
      SELECT * FROM runtime_events
      WHERE session_id = ? AND sequence > ?
      ORDER BY sequence ASC
    `).all(this.sessionId, afterSequence) as Array<Record<string, unknown>>;
    const events: SessionEventEnvelope[] = [];
    let expectedSequence = afterSequence + 1;
    for (const row of rows) {
      const event = this.rowToEvent(row);
      if (!event || event.sequence !== expectedSequence) {
        this.quarantineFrom(Number(row.sequence), "checksum_or_sequence_failure");
        break;
      }
      events.push(event);
      expectedSequence++;
    }
    return events;
  }

  async restore(): Promise<{
    snapshot: SessionSnapshot;
    events: SessionEventEnvelope[];
    truncatedAtSequence?: number;
  }> {
    const snapshotRows = this.requireDb().prepare(`
      SELECT * FROM runtime_snapshots
      WHERE session_id = ?
      ORDER BY sequence DESC
    `).all(this.sessionId) as Array<Record<string, unknown>>;
    let snapshot = defaultSnapshot(this.sessionId, this.now());
    const maxEventRow = this.requireDb()
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM runtime_events WHERE session_id = ?")
      .get(this.sessionId) as { sequence: number };
    const maxEventSequence = Number(maxEventRow.sequence ?? 0);
    for (const row of snapshotRows) {
      try {
        const candidate = JSON.parse(String(row.snapshot)) as SessionSnapshot;
        if (
          checksum(candidate) === String(row.checksum) &&
          this.isValidSnapshot(candidate, Number(row.sequence), maxEventSequence)
        ) {
          snapshot = candidate;
          break;
        }
      } catch {
        // Keep scanning older snapshots. Never replace good state with corrupt data.
      }
    }

    const rows = this.requireDb().prepare(`
      SELECT * FROM runtime_events
      WHERE session_id = ? AND sequence > ?
      ORDER BY sequence ASC
    `).all(this.sessionId, snapshot.sequence) as Array<Record<string, unknown>>;
    const events: SessionEventEnvelope[] = [];
    let truncatedAtSequence: number | undefined;
    let expectedSequence = snapshot.sequence + 1;
    for (const row of rows) {
      const event = this.rowToEvent(row);
      if (!event || event.sequence !== expectedSequence) {
        truncatedAtSequence = Number(row.sequence);
        this.quarantineFrom(truncatedAtSequence, "checksum_or_sequence_failure");
        break;
      }
      events.push(event);
      expectedSequence++;
    }
    return { snapshot, events, ...(truncatedAtSequence ? { truncatedAtSequence } : {}) };
  }

  async recordToolCall(record: RuntimeToolCallRecord): Promise<void> {
    this.requireDb().prepare(`
      INSERT INTO runtime_tool_calls (
        session_id, tool_call_id, tool, arguments_hash, side_effect,
        idempotent, status, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, tool_call_id) DO UPDATE SET
        tool = excluded.tool,
        arguments_hash = excluded.arguments_hash,
        side_effect = excluded.side_effect,
        idempotent = excluded.idempotent,
        status = excluded.status,
        started_at = COALESCE(excluded.started_at, runtime_tool_calls.started_at),
        completed_at = excluded.completed_at
    `).run(
      this.sessionId,
      record.toolCallId,
      record.tool,
      record.argumentsHash,
      record.sideEffect,
      record.idempotent ? 1 : 0,
      record.status,
      record.startedAt ?? this.now(),
      record.completedAt ?? null
    );
  }

  async inspectInterruptedTools(): Promise<{
    retryable: RuntimeToolCallRecord[];
    unknownOutcome: RuntimeToolCallRecord[];
  }> {
    const rows = this.requireDb().prepare(`
      SELECT * FROM runtime_tool_calls
      WHERE session_id = ? AND status IN ('queued', 'running')
      ORDER BY started_at ASC, tool_call_id ASC
    `).all(this.sessionId) as Array<Record<string, unknown>>;
    const retryable: RuntimeToolCallRecord[] = [];
    const unknownOutcome: RuntimeToolCallRecord[] = [];
    const markUnknown = this.requireDb().prepare(`
      UPDATE runtime_tool_calls SET status = 'unknown_outcome'
      WHERE session_id = ? AND tool_call_id = ?
    `);
    for (const row of rows) {
      const record = this.rowToToolCall(row);
      if (record.sideEffect === "none" && record.idempotent) {
        retryable.push(record);
      } else {
        record.status = "unknown_outcome";
        unknownOutcome.push(record);
        markUnknown.run(this.sessionId, record.toolCallId);
      }
    }
    return { retryable, unknownOutcome };
  }

  /** Test-only corruption hook; production recovery still validates every row. */
  async injectCorruptEventForTest(input: { sequence: number; checksum: string }): Promise<void> {
    const timestamp = this.now();
    this.requireDb().prepare(`
      INSERT INTO runtime_events (
        session_id, sequence, event_id, type, timestamp, payload, checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.sessionId,
      input.sequence,
      `corrupt_${input.sequence}`,
      "corrupt_test_event",
      timestamp,
      "{}",
      input.checksum
    );
    this.sequence = Math.max(this.sequence, input.sequence);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  async purgeSession(options: { beforeTimestamp?: number } = {}): Promise<number> {
    const db = this.requireDb();
    const before = options.beforeTimestamp ?? Number.POSITIVE_INFINITY;
    const purge = db.transaction(() => {
      const result = db.prepare(
        "DELETE FROM runtime_events WHERE session_id = ? AND timestamp < ?"
      ).run(this.sessionId, before);
      db.prepare("DELETE FROM runtime_snapshots WHERE session_id = ? AND created_at < ?")
        .run(this.sessionId, before);
      db.prepare("DELETE FROM runtime_tool_calls WHERE session_id = ? AND COALESCE(completed_at, started_at, 0) < ?")
        .run(this.sessionId, before);
      return result.changes;
    });
    return purge();
  }

  private rowToEvent(row: Record<string, unknown>): SessionEventEnvelope | null {
    try {
      const base = {
        eventId: String(row.event_id),
        sequence: Number(row.sequence),
        sessionId: String(row.session_id),
        ...(row.run_id ? { runId: String(row.run_id) } : {}),
        ...(row.turn_id ? { turnId: String(row.turn_id) } : {}),
        ...(row.causation_id ? { causationId: String(row.causation_id) } : {}),
        type: String(row.type),
        timestamp: Number(row.timestamp),
        payload: JSON.parse(String(row.payload)),
      };
      const storedChecksum = String(row.checksum);
      return checksum(base) === storedChecksum ? { ...base, checksum: storedChecksum } : null;
    } catch {
      return null;
    }
  }

  private rowToToolCall(row: Record<string, unknown>): RuntimeToolCallRecord {
    return {
      toolCallId: String(row.tool_call_id),
      tool: String(row.tool),
      argumentsHash: String(row.arguments_hash),
      sideEffect: String(row.side_effect) as RuntimeToolCallRecord["sideEffect"],
      idempotent: Number(row.idempotent) === 1,
      status: String(row.status) as RuntimeToolCallRecord["status"],
      ...(row.started_at ? { startedAt: Number(row.started_at) } : {}),
      ...(row.completed_at ? { completedAt: Number(row.completed_at) } : {}),
    };
  }

  private isValidSnapshot(candidate: SessionSnapshot, rowSequence: number, maxEventSequence: number): boolean {
    const validStates = new Set([
      "initializing", "idle", "queued", "running", "waiting_approval", "compacting",
      "verifying", "recovering", "paused", "completed", "failed", "canceled", "closing",
    ]);
    return Boolean(
      candidate &&
      candidate.sessionId === this.sessionId &&
      candidate.sequence === rowSequence &&
      candidate.sequence <= maxEventSequence &&
      validStates.has(candidate.state) &&
      Array.isArray(candidate.promptQueue) &&
      Array.isArray(candidate.activeTools) &&
      Array.isArray(candidate.recentEvidence)
    );
  }

  private quarantineFrom(sequence: number, reason: string): void {
    const db = this.requireDb();
    const quarantine = db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM runtime_events WHERE session_id = ? AND sequence >= ? ORDER BY sequence ASC
      `).all(this.sessionId, sequence) as Array<Record<string, unknown>>;
      const insert = db.prepare(`
        INSERT OR REPLACE INTO runtime_event_quarantine
          (session_id, sequence, raw_event, quarantined_at, reason)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(this.sessionId, Number(row.sequence), JSON.stringify(row), this.now(), reason);
      }
      db.prepare("DELETE FROM runtime_events WHERE session_id = ? AND sequence >= ?")
        .run(this.sessionId, sequence);
    });
    quarantine();
    this.sequence = Math.min(this.sequence, sequence - 1);
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("runtime journal is not initialized");
    return this.db;
  }
}
