import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const ENTRY = join(process.cwd(), "dist/index.js");

function waitForExit(child, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("chat process did not exit in time"));
    }, timeoutMs);

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test("chat smoke: exit command triggers graceful shutdown", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "qling-chat-history-"));
  try {
    const child = spawn(
      process.execPath,
      [
        ENTRY,
        "chat",
        "--api-key",
        "test-key",
        "--provider",
        "openai",
        "--endpoint",
        "https://api.openai.com/v1",
        "--model",
        "gpt-test",
        "--file-state-dir",
        stateDir,
      ],
      {
        env: {
          ...process.env,
          QLING_MEMORY_WAL_ENABLED: "false",
          QLING_METRICS_ENABLED: "false",
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    child.stdin.write("exit\n");

    const { code, signal } = await waitForExit(child);
    assert.equal(signal, null, `unexpected signal: ${signal}; stderr=${stderr.slice(0, 500)}`);
    assert.equal(code, 0, `unexpected exit code: ${code}; stderr=${stderr.slice(0, 500)}`);

    const historyPath = join(stateDir, "input-history.json");
    assert.equal(existsSync(historyPath), false);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});
