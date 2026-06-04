import axios from "axios";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { spawn, spawnSync } from "child_process";

const HEALTH_POLL_INTERVAL_MS = 150;

export interface DaemonControlOptions {
  stateDir: string;
  port: number;
  daemonEntry: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  waitMs?: number;
}

export interface DaemonStatus {
  running: boolean;
  healthy: boolean;
  managed: boolean;
  stalePidFile: boolean;
  pid: number | null;
  port: number;
  pidFile: string;
  logFile: string;
  health: Record<string, unknown> | null;
}

export interface StartDaemonResult {
  started: boolean;
  status: DaemonStatus;
}

export interface StopDaemonResult {
  stopped: boolean;
  status: DaemonStatus;
}

export async function getDaemonStatus(options: DaemonControlOptions): Promise<DaemonStatus> {
  await fsp.mkdir(options.stateDir, { recursive: true });

  const pidFile = getPidFile(options.stateDir);
  const logFile = getLogFile(options.stateDir);
  const pid = await readPid(pidFile);
  const pidAlive = pid !== null ? isProcessAlive(pid) : false;
  const probe = await probeHealth(options.port);

  return {
    running: pidAlive || probe.healthy,
    healthy: probe.healthy,
    managed: pid !== null,
    stalePidFile: pid !== null && !pidAlive,
    pid,
    port: options.port,
    pidFile,
    logFile,
    health: probe.payload,
  };
}

export async function startDaemon(options: DaemonControlOptions): Promise<StartDaemonResult> {
  await fsp.mkdir(options.stateDir, { recursive: true });
  const pidFile = getPidFile(options.stateDir);
  const logFile = getLogFile(options.stateDir);
  const status = await getDaemonStatus(options);

  if (status.healthy) {
    return { started: false, status };
  }

  if (status.running && status.managed && !status.stalePidFile) {
    return { started: false, status };
  }

  if (status.stalePidFile) {
    await removeIfExists(pidFile);
  }

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [options.daemonEntry], {
    cwd: options.cwd,
    env: {
      ...options.env,
      QINGLING_FILE_STATE_DIR: options.stateDir,
      QINGLING_DAEMON_PORT: String(options.port),
    },
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(logFd);

  if (!child.pid) {
    throw new Error("failed to spawn daemon process");
  }

  await fsp.writeFile(pidFile, `${child.pid}\n`, "utf-8");

  const waitMs = options.waitMs ?? 10_000;
  const started = await waitForHealthy(options.port, waitMs);
  if (!started) {
    await terminateProcess(child.pid);
    await removeIfExists(pidFile);
    throw new Error(`daemon did not become healthy within ${waitMs}ms`);
  }

  return {
    started: true,
    status: await getDaemonStatus(options),
  };
}

export async function stopDaemon(options: DaemonControlOptions): Promise<StopDaemonResult> {
  const status = await getDaemonStatus(options);

  if (status.pid === null) {
    return {
      stopped: false,
      status,
    };
  }

  if (isProcessAlive(status.pid)) {
    await terminateProcess(status.pid);
  }

  await waitForDown(options.port, options.waitMs ?? 10_000);
  await removeIfExists(status.pidFile);

  return {
    stopped: true,
    status: await getDaemonStatus(options),
  };
}

function getPidFile(stateDir: string): string {
  return path.join(stateDir, "daemon.pid");
}

function getLogFile(stateDir: string): string {
  return path.join(stateDir, "daemon.log");
}

async function readPid(pidFile: string): Promise<number | null> {
  try {
    const raw = await fsp.readFile(pidFile, "utf-8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probeHealth(port: number): Promise<{ healthy: boolean; payload: Record<string, unknown> | null }> {
  try {
    const response = await axios.get(`http://127.0.0.1:${port}/health`, {
      timeout: 800,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300 && response.data && typeof response.data === "object") {
      return {
        healthy: true,
        payload: response.data as Record<string, unknown>,
      };
    }
    return { healthy: false, payload: null };
  } catch {
    return { healthy: false, payload: null };
  }
}

async function waitForHealthy(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeHealth(port);
    if (probe.healthy) {
      return true;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
  return false;
}

async function waitForDown(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await probeHealth(port);
    if (!probe.healthy) {
      return;
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }
}

async function terminateProcess(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    }
    throw new Error(`failed to terminate daemon pid ${pid}`);
  }

  if (process.platform === "win32" && isProcessAlive(pid)) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // ignore
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
