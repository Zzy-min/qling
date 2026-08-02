import type { SessionEventEnvelope, SessionSnapshot, SessionState } from "./types.js";

const STATES = new Set<SessionState>([
  "initializing", "idle", "queued", "running", "waiting_approval", "compacting", "verifying",
  "recovering", "paused", "completed", "failed", "canceled", "closing",
]);

function objectPayload(event: SessionEventEnvelope): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

export function projectSessionEvents(base: SessionSnapshot, events: readonly SessionEventEnvelope[]): SessionSnapshot {
  const snapshot = structuredClone(base);
  for (const event of events) {
    if (event.sequence <= snapshot.sequence) continue;
    const payload = objectPayload(event);
    const nested = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
      ? payload.payload as Record<string, unknown>
      : {};
    const data = { ...payload, ...nested };
    if (event.type === "prompt_queued") {
      const id = String(data.promptId ?? "");
      const prompt = String(data.prompt ?? "");
      const priority = data.priority === "interjection" ? "interjection" : "normal";
      if (id && prompt && !snapshot.promptQueue.some((item) => item.id === id)) {
        snapshot.promptQueue.push({ id, prompt, priority, queuedAt: event.timestamp });
      }
      if (snapshot.state === "idle") snapshot.state = "queued";
      else if (snapshot.activeRun) snapshot.state = "running";
    } else if (event.type === "prompt_started") {
      const id = String(data.promptId ?? "");
      const index = snapshot.promptQueue.findIndex((item) => item.id === id);
      const queued = index >= 0 ? snapshot.promptQueue.splice(index, 1)[0] : undefined;
      if (event.runId && event.turnId && queued) {
        snapshot.activeRun = { runId: event.runId, turnId: event.turnId, prompt: queued.prompt, startedAt: event.timestamp };
      }
      snapshot.state = "running";
    } else if (["prompt_completed", "prompt_failed", "prompt_canceled"].includes(event.type)) {
      snapshot.activeRun = null;
    } else if (event.type === "ui_resized") {
      const columns = Number(data.columns);
      const rows = Number(data.rows);
      if (Number.isFinite(columns) && Number.isFinite(rows)) snapshot.viewport = { columns, rows };
    } else {
      const state = typeof data.state === "string" && STATES.has(data.state as SessionState)
        ? data.state as SessionState
        : undefined;
      if (state) snapshot.state = state;
    }
    snapshot.sequence = event.sequence;
    snapshot.updatedAt = event.timestamp;
  }
  return snapshot;
}
