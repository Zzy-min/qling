import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  chmod,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CredentialCipher } from "./types.js";
function dpapi(value: string, decrypt: boolean): Promise<string> {
  const operation = decrypt ? "Unprotect" : "Protect";
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let output = "";
    child.stdout.on("data", (b) => {
      output += b.toString();
    });
    child.stderr.resume();
    child.on("error", () => reject(Error("Credential encryption unavailable")));
    child.on("exit", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(Error("Credential encryption failed")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(decrypt ? value : Buffer.from(value).toString("base64"));
  });
}
export const platformCipher: CredentialCipher =
  process.platform === "win32"
    ? {
        encrypt: async (value) => `dpapi:${await dpapi(value, false)}`,
        decrypt: async (value) => {
          if (!value.startsWith("dpapi:"))
            throw Error("Invalid encrypted credential");
          return Buffer.from(
            await dpapi(value.slice(6), true),
            "base64",
          ).toString("utf8");
        },
      }
    : {
        encrypt: async (value) =>
          `private-file:${Buffer.from(value).toString("base64")}`,
        decrypt: async (value) => {
          if (!value.startsWith("private-file:"))
            throw Error("Invalid private credential");
          return Buffer.from(value.slice(13), "base64").toString("utf8");
        },
      };
export async function privateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const st = await lstat(path);
  if (st.isSymbolicLink() || !st.isDirectory())
    throw Error("Unsafe auth directory");
  if (process.platform !== "win32") {
    await chmod(path, 0o700);
    if (((await lstat(path)).mode & 0o077) !== 0)
      throw Error("Private auth permissions unavailable");
  }
}
export async function atomicWrite(path: string, value: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw Error("Unsafe auth file");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, value, { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    try {
      await unlink(temp);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("Auth temporary file cleanup failed");
    }
    throw error;
  }
}
export async function readJson<T>(path: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code === "ENOENT" &&
      fallback !== undefined
    )
      return fallback;
    throw Error("Cannot read auth state");
  }
}
export function authPath(stateDir: string): string {
  return join(stateDir, "auth");
}
