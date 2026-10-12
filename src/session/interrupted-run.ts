// Interrupted-run detection. Reads only the tail of a run trace and appends a
// closing event; it never deletes saved tool results.
import { open } from "node:fs/promises";
import type { ExecutionEvent } from "../execution/types.js";
import type { Message } from "../types.js";

export const EVENTS_TAIL_BYTES = 256 * 1024;

export const INTERRUPTED_RUN_REMINDER =
  "上一轮在完成前被中断（进程退出或重启），已保存的工具结果保留，之后的工作可能丢失；请先核对状态再继续。";

export const INTERRUPTED_RUN_KEY = "interrupted-run-v1";

export interface InterruptedActiveRun {
  runId: string;
  sessionId: string;
  originalTask: string;
  startedAt: number;
}

export interface InterruptedRunTraceStore {
  getRunPath(sessionId: string, runId: string): string;
  append(value: object): Promise<void>;
}

export interface InterruptedRunReconcileResult {
  interrupted: boolean;
  activeRun: InterruptedActiveRun | null;
  messages: Message[];
  reminderAdded: boolean;
}

export function detectInterruptedRun(events: Array<{ type?: string }>): boolean {
  let started = false;
  let completed = false;
  for (const event of events) {
    if (event.type === "run_started") started = true;
    if (event.type === "run_completed") completed = true;
  }
  return started && !completed;
}

/** Drop a leading partial line when the buffer is a mid-file tail slice. */
export function decodeTraceTail(buffer: Buffer, truncated: boolean): string {
  const text = buffer.toString("utf8");
  if (!truncated) return text;
  const newline = text.indexOf("\n");
  if (newline < 0) return "";
  return text.slice(newline + 1);
}

export function parseTraceEvents(text: string): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ExecutionEvent;
      if (parsed && typeof parsed === "object") events.push(parsed);
    } catch {
      // Ignore a leftover partial JSON line.
    }
  }
  return events;
}

export async function readRunEventsTail(filePath: string, maxBytes = EVENTS_TAIL_BYTES): Promise<ExecutionEvent[]> {
  const limit = Math.max(1, Math.floor(maxBytes));
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const info = await handle.stat();
    const scanned = Math.min(info.size, limit);
    const buffer = Buffer.alloc(scanned);
    if (scanned > 0) {
      await handle.read(buffer, 0, scanned, info.size - scanned);
    }
    return parseTraceEvents(decodeTraceTail(buffer, info.size > limit));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  } finally {
    await handle?.close();
  }
}

export function hasInterruptedReminder(messages: Message[]): boolean {
  return messages.some((message) =>
    message.synthetic_key === INTERRUPTED_RUN_KEY
    || (typeof message.content === "string" && message.content.includes(INTERRUPTED_RUN_REMINDER))
  );
}

export function interruptedReminderMessage(): Message {
  return {
    role: "user",
    content: INTERRUPTED_RUN_REMINDER,
    synthetic_reason: "interrupted_run",
    synthetic_key: INTERRUPTED_RUN_KEY,
  };
}

/**
 * If the snapshot still points at a run whose trace has run_started and no
 * run_completed, close that trace as interrupted and append one reminder.
 * An intentional recovery (`recovering`) is left untouched. Idempotent:
 * a second call does not append another reminder.
 */
export async function reconcileInterruptedSession(input: {
  activeRun: InterruptedActiveRun | null;
  recoveryStatus?: string | null;
  messages: Message[];
  traceStore: InterruptedRunTraceStore;
  now?: () => number;
  tailBytes?: number;
}): Promise<InterruptedRunReconcileResult> {
  const activeRun = input.activeRun;
  if (!activeRun || input.recoveryStatus === "recovering") {
    return { interrupted: false, activeRun, messages: input.messages, reminderAdded: false };
  }

  const events = await readRunEventsTail(
    input.traceStore.getRunPath(activeRun.sessionId, activeRun.runId),
    input.tailBytes ?? EVENTS_TAIL_BYTES,
  );
  if (!detectInterruptedRun(events)) {
    return { interrupted: false, activeRun, messages: input.messages, reminderAdded: false };
  }

  try {
    await input.traceStore.append({
      type: "run_completed",
      status: "interrupted",
      runId: activeRun.runId,
      sessionId: activeRun.sessionId,
      timestamp: (input.now ?? Date.now)(),
    });
  } catch (error) {
    console.warn(
      `[interrupted-run] 未能写入 interrupted run_completed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const reminderAdded = !hasInterruptedReminder(input.messages);
  return {
    interrupted: true,
    activeRun: null,
    messages: reminderAdded ? [...input.messages, interruptedReminderMessage()] : input.messages,
    reminderAdded,
  };
}
