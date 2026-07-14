import type { ProgressSnapshot } from "./types.js";

function normalizedTests(tests: string[] | undefined): string[] {
  return [...new Set(tests ?? [])].sort();
}

function normalizedFiles(files: string[] | undefined): string[] {
  return [...new Set(files ?? [])].sort();
}

export function hasExecutionProgress(before: ProgressSnapshot | undefined, after: ProgressSnapshot): boolean {
  if (!before) return true;
  if (before.diffHash !== after.diffHash) return true;
  if ((after.completedTodos ?? 0) > (before.completedTodos ?? 0)) return true;
  const previousTests = normalizedTests(before.failingTests);
  const currentTests = normalizedTests(after.failingTests);
  if (currentTests.length < previousTests.length) return true;
  const previousFiles = normalizedFiles(before.changedFiles);
  const currentFiles = normalizedFiles(after.changedFiles);
  if (previousFiles.join("\0") !== currentFiles.join("\0")) return true;
  return after.changed === true && before.changed !== true;
}
