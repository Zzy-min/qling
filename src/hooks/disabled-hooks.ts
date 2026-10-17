import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export function disabledHooksPath(stateDir: string): string {
  return path.join(stateDir, "disabled-hooks");
}

export function parseDisabledHookNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    names.add(trimmed);
  }
  return names;
}

export async function readDisabledHookNames(stateDir: string): Promise<Set<string>> {
  try {
    return parseDisabledHookNames(await readFile(disabledHooksPath(stateDir), "utf8"));
  } catch {
    return new Set();
  }
}

async function writeDisabledHookNames(stateDir: string, names: Set<string>): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const body = ["# disabled JSON hook names", ...[...names].sort(), ""].join("\n");
  await writeFile(disabledHooksPath(stateDir), body, "utf8");
}

export async function disableHook(stateDir: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    throw new Error("hook 名称不能为空");
  }
  const names = await readDisabledHookNames(stateDir);
  names.add(trimmed);
  await writeDisabledHookNames(stateDir, names);
}

export async function enableHook(stateDir: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("hook 名称不能为空");
  const names = await readDisabledHookNames(stateDir);
  names.delete(trimmed);
  await writeDisabledHookNames(stateDir, names);
}
