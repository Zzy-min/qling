import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_MAX_ENTRY_CHARS = 8000;
const SENSITIVE_INPUT_PATTERN =
  /\b(api[_-]?key|token|password|passwd|secret|authorization|bearer)\b|sk-[A-Za-z0-9_-]{8,}/i;

export interface InputHistoryOptions {
  stateDir: string;
  maxEntries?: number;
  maxEntryChars?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export function resolveInputHistoryPath(stateDir: string): string {
  return join(stateDir, "input-history.json");
}

function isHistoryEnabled(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): boolean {
  return String(env.QLING_TUI_HISTORY_ENABLED ?? "true").toLowerCase() !== "false";
}

function resolveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

export function shouldPersistInputHistory(input: string, maxEntryChars = DEFAULT_MAX_ENTRY_CHARS): boolean {
  const value = input.trim();
  if (!value) return false;
  if (value.length > maxEntryChars) return false;
  return !SENSITIVE_INPUT_PATTERN.test(value);
}

function normalizeHistory(entries: unknown[], options: InputHistoryOptions): string[] {
  const maxEntries = resolveLimit(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxEntryChars = resolveLimit(options.maxEntryChars, DEFAULT_MAX_ENTRY_CHARS);
  let deduped: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const value = entry.trim();
    if (!shouldPersistInputHistory(value, maxEntryChars)) continue;
    deduped = [...deduped.filter((item) => item !== value), value];
  }

  return deduped.slice(-maxEntries);
}

export async function loadInputHistory(options: InputHistoryOptions): Promise<string[]> {
  if (!isHistoryEnabled(options.env)) return [];
  try {
    const raw = await readFile(resolveInputHistoryPath(options.stateDir), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeHistory(parsed, options);
  } catch {
    return [];
  }
}

export async function appendInputHistory(input: string, options: InputHistoryOptions): Promise<string[]> {
  if (!isHistoryEnabled(options.env)) return [];
  const maxEntryChars = resolveLimit(options.maxEntryChars, DEFAULT_MAX_ENTRY_CHARS);
  const value = input.trim();
  const current = await loadInputHistory(options);
  if (!shouldPersistInputHistory(value, maxEntryChars)) return current;

  const next = normalizeHistory([...current, value], options);
  const file = resolveInputHistoryPath(options.stateDir);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    return current;
  }
  return next;
}
