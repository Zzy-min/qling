import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isIP } from "node:net";
import type * as http from "node:http";

export const DEFAULT_DAEMON_HOST = "127.0.0.1";
export const DEFAULT_DAEMON_BODY_LIMIT = 1024 * 1024;
export const DAEMON_TOKEN_FILE = "daemon.token";

export class DaemonHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
    this.name = "DaemonHttpError";
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" ||
    (isIP(normalized) === 4 && normalized.split(".")[0] === "127");
}

export function resolveDaemonBinding(env: NodeJS.ProcessEnv = process.env): {
  host: string;
  authEnabled: boolean;
} {
  const host = env.QLING_DAEMON_HOST?.trim() || DEFAULT_DAEMON_HOST;
  const loopback = isLoopbackHost(host);
  const authEnabled = String(env.QLING_DAEMON_AUTH ?? "on").trim().toLowerCase() !== "off";
  if (!loopback && env.QLING_DAEMON_ALLOW_REMOTE !== "1") {
    throw new Error("remote daemon binding requires QLING_DAEMON_ALLOW_REMOTE=1");
  }
  if (!loopback && !authEnabled) {
    throw new Error("remote daemon binding requires bearer authentication");
  }
  return { host, authEnabled };
}

export function resolveDaemonBodyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.QLING_DAEMON_MAX_BODY_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_DAEMON_BODY_LIMIT;
}

export function daemonTokenPath(stateDir = process.env.QLING_FILE_STATE_DIR || path.join(os.homedir(), ".qling")): string {
  return path.join(stateDir, DAEMON_TOKEN_FILE);
}

export async function getOrCreateDaemonToken(stateDir: string): Promise<string> {
  await fsp.mkdir(stateDir, { recursive: true });
  const tokenPath = daemonTokenPath(stateDir);
  const existing = await readValidToken(tokenPath);
  if (existing) {
    await fsp.chmod(tokenPath, 0o600).catch(() => undefined);
    return existing;
  }

  const token = randomBytes(32).toString("hex");
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(tokenPath, "wx", 0o600);
    await handle.writeFile(`${token}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await handle?.close();
  }
  const persisted = await readValidToken(tokenPath);
  if (!persisted) throw new Error("daemon bearer token could not be initialized");
  await fsp.chmod(tokenPath, 0o600).catch(() => undefined);
  return persisted;
}

export function readDaemonTokenSync(stateDir?: string): string | null {
  try {
    const token = fs.readFileSync(daemonTokenPath(stateDir), "utf8").trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function daemonAuthHeaders(stateDir?: string): Record<string, string> {
  const token = readDaemonTokenSync(stateDir);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isDaemonRequestAuthorized(req: http.IncomingMessage, expectedToken: string): boolean {
  const header = req.headers.authorization ?? "";
  const supplied = /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? "";
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash) && supplied.length === expectedToken.length;
}

export async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = DEFAULT_DAEMON_BODY_LIMIT
): Promise<any> {
  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    req.resume();
    throw new DaemonHttpError("request body too large", 413, "DAEMON_BODY_TOO_LARGE");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of req) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.byteLength;
    if (total > maxBytes) {
      req.resume();
      throw new DaemonHttpError("request body too large", 413, "DAEMON_BODY_TOO_LARGE");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("body must be a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new DaemonHttpError(
      error instanceof Error ? `invalid JSON: ${error.message}` : "invalid JSON",
      400,
      "DAEMON_INVALID_JSON"
    );
  }
}

async function readValidToken(tokenPath: string): Promise<string | null> {
  try {
    const token = (await fsp.readFile(tokenPath, "utf8")).trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : null;
  } catch {
    return null;
  }
}
