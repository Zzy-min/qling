import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function writeWithProcess(command: string, args: string[], text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
    child.stdin.end(text);
  });
}

export async function writeClipboardText(text: string): Promise<void> {
  if (process.platform === "win32") {
    await writeWithProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
      text
    );
    return;
  }
  if (process.platform === "darwin") {
    await writeWithProcess("pbcopy", [], text);
    return;
  }

  const attempts: Array<[string, string[]]> = [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];
  let lastError: unknown;
  for (const [command, args] of attempts) {
    try {
      await writeWithProcess(command, args, text);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("no supported clipboard writer found");
}

export async function readClipboardText(): Promise<string> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
      { encoding: "utf8", timeout: 3_000, windowsHide: true }
    );
    return String(stdout ?? "");
  }
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("pbpaste", [], {
      encoding: "utf8",
      timeout: 3_000,
    });
    return String(stdout ?? "");
  }

  const attempts: Array<[string, string[]]> = [
    ["wl-paste", ["--no-newline"]],
    ["xclip", ["-selection", "clipboard", "-o"]],
    ["xsel", ["--clipboard", "--output"]],
  ];
  let lastError: unknown;
  for (const [command, args] of attempts) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        encoding: "utf8",
        timeout: 3_000,
      });
      return String(stdout ?? "");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("no supported clipboard reader found");
}
