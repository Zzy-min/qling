import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolveBashLaunch } from "../tools/bash.js";

const execFileAsync = promisify(execFile);

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteCmdFixed(value: string): string {
  if (/[\r\n&|<>^%!]/.test(value)) throw new Error("unsafe metacharacter in fixed Windows batch verifier argument");
  if (/^[A-Za-z0-9_.:\\/@+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveWslCwd(cwd: string): string {
  const match = cwd.match(/^([A-Za-z]):[\\/](.*)$/);
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}` : cwd.replace(/\\/g, "/");
}

function killWindowsTree(pid: number): boolean {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 5_000,
    });
    return true;
  } catch {
    // taskkill also fails when the process tree already exited. Only treat
    // that case as confirmed; permission/handle failures remain unknown.
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminatePosixGroup(child: ChildProcess): Promise<boolean> {
  if (!child.pid) return false;
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch {} }
  await wait(250);
  // Always escalate against the process group. The group may outlive its shell.
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch {} }
  await wait(50);
  try {
    process.kill(-child.pid, 0);
    return false;
  } catch {
    return true;
  }
}

async function terminateWslGroup(child: ChildProcess, pidFile: string): Promise<boolean> {
  const script = [
    `test -f ${quotePosix(pidFile)} || exit 3`,
    `pgid=$(cat ${quotePosix(pidFile)})`,
    `kill -TERM -- -$pgid 2>/dev/null || true`,
    "sleep 0.25",
    `kill -KILL -- -$pgid 2>/dev/null || true`,
    "sleep 0.05",
    `if kill -0 -- -$pgid 2>/dev/null; then exit 4; fi`,
    `rm -f ${quotePosix(pidFile)}`,
  ].join("; ");
  let confirmed = false;
  try {
    await execFileAsync("wsl.exe", ["sh", "-lc", script], { windowsHide: true, timeout: 5_000 });
    confirmed = true;
  } catch {
    confirmed = false;
  }
  if (child.pid) killWindowsTree(child.pid);
  return confirmed;
}

export async function terminateManagedProcessTree(input: {
  child: ChildProcess;
  runtime?: "native" | "wsl";
  wslPidFile?: string;
}): Promise<boolean> {
  if (process.platform === "win32") {
    if (input.runtime === "wsl" && input.wslPidFile) {
      return terminateWslGroup(input.child, input.wslPidFile);
    }
    return input.child.pid ? killWindowsTree(input.child.pid) : false;
  }
  return terminatePosixGroup(input.child);
}

export interface ManagedCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  terminationConfirmed: boolean;
}

export function runManagedCommand(input: {
  command?: string;
  executable?: string;
  args?: string[];
  cwd: string;
  runtime?: "native" | "wsl";
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputLimit?: number;
}): Promise<ManagedCommandResult> {
  return new Promise((resolve) => {
    const runtime = input.runtime ?? "native";
    const direct = Boolean(input.executable);
    const wslPidFile = process.platform === "win32" && runtime === "wsl"
      ? `/tmp/qling-verify-${process.pid}-${randomUUID()}.pid`
      : null;
    let shell: string;
    let shellArgs: string[];
    if (direct && wslPidFile) {
      const argv = [input.executable!, ...(input.args ?? [])].map(quotePosix).join(" ");
      const wrapped = `setsid ${argv} & pgid=$!; printf '%s' "$pgid" > ${quotePosix(wslPidFile)}; wait "$pgid"`;
      shell = "wsl.exe";
      shellArgs = ["--cd", resolveWslCwd(input.cwd), "sh", "-lc", wrapped];
    } else if (direct) {
      if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(input.executable!)) {
        shell = process.env.ComSpec || "cmd.exe";
        if (!/^[A-Za-z0-9_.:\\/-]+$/.test(input.executable!)) throw new Error("unsafe Windows batch verifier executable");
        shellArgs = ["/d", "/c", ["call", input.executable!, ...(input.args ?? []).map(quoteCmdFixed)].join(" ")];
      } else {
        shell = input.executable!;
        shellArgs = [...(input.args ?? [])];
      }
    } else {
      const command = wslPidFile
        ? `setsid sh -lc ${quotePosix(input.command ?? "")} & pgid=$!; printf '%s' "$pgid" > ${quotePosix(wslPidFile)}; wait "$pgid"`
        : input.command ?? "";
      const launch = resolveBashLaunch({ platform: process.platform, runtime, command, cwd: input.cwd });
      shell = launch.shell;
      shellArgs = launch.shellArgs;
    }
    const child = spawn(shell, shellArgs, {
      cwd: input.cwd,
      env: input.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const limit = input.outputLimit ?? 16 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;
    let closeCode: number | null = null;
    let closeError: Error | undefined;
    let termination: Promise<boolean> | null = null;
    child.stdout?.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-limit); });
    child.stderr?.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-limit); });

    const finish = async () => {
      if (resolved) return;
      if (timedOut && !termination) return;
      resolved = true;
      clearTimeout(timer);
      const terminationConfirmed = termination ? await termination : true;
      if (wslPidFile && !timedOut) {
        try { await execFileAsync("wsl.exe", ["rm", "-f", wslPidFile], { windowsHide: true, timeout: 2_000 }); } catch {}
      }
      resolve({ code: closeCode ?? 1, stdout, stderr: `${stderr}${closeError?.message ?? ""}`, timedOut, terminationConfirmed });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      termination = terminateManagedProcessTree({ child, runtime, ...(wslPidFile ? { wslPidFile } : {}) });
      void termination.finally(() => finish());
    }, input.timeoutMs);
    child.once("error", (error) => { closeError = error; void finish(); });
    child.once("close", (code) => { closeCode = code; void finish(); });
  });
}
