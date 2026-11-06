import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthCredential } from "./types.js";
const LEGACY = "https://accounts.x.ai/sign-in";
export function parseGrokStore(
  value: unknown,
  now = Date.now(),
): AuthCredential {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("needs_login: unsupported Grok credential store");
  const candidates = Object.entries(value).filter(([scope, entry]) => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return (
      (scope === LEGACY &&
        ["web_login", "grok"].includes(String(e.auth_mode))) ||
      (e.auth_mode === "oidc" &&
        e.oidc_issuer === "https://auth.x.ai" &&
        typeof e.oidc_client_id === "string" &&
        scope === `https://auth.x.ai::${e.oidc_client_id}`)
    );
  });
  if (candidates.length !== 1)
    throw Error(
      "needs_login: unsupported or ambiguous Grok session; run grok login",
    );
  const e = candidates[0][1] as Record<string, unknown>;
  const expires =
    typeof e.expires_at === "string" ? Date.parse(e.expires_at) : Number.NaN;
  if (
    typeof e.key !== "string" ||
    !e.key ||
    !Number.isFinite(expires) ||
    expires <= now
  )
    throw Error(
      "needs_login: Grok session expired or unsupported; run grok login",
    );
  // Refresh is deliberately left to the official CLI: rotating its shared token here could break other applications.
  return { accessToken: e.key, expiresAt: expires };
}
export async function readGrokCredential(
  path = join(process.env.GROK_HOME || join(homedir(), ".grok"), "auth.json"),
): Promise<AuthCredential> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw Error(
      "needs_login: no readable official Grok session; run grok login",
    );
  }
  return parseGrokStore(data);
}
export async function runOfficialGrokLogin(
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn("grok", ["login", "--oauth"], {
      stdio: "inherit",
      shell: false,
      signal,
      windowsHide: true,
    });
    child.on("error", () =>
      reject(
        Error(
          "Grok login unavailable. Install the official CLI from https://x.ai/cli",
        ),
      ),
    );
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Grok login cancelled or failed")),
    );
  });
}
