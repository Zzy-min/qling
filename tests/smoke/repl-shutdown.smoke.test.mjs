import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

const ENTRY = join(process.cwd(), "dist/index.js");

function waitForExit(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("repl process did not exit in time"));
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

test("repl smoke: exit command shuts down agent and process exits", async () => {
  const child = spawn(
    process.execPath,
    [ENTRY, "repl", "--api-key", "test-key"],
    {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  setTimeout(() => {
    child.stdin.write("exit\n");
  }, 300);

  const { code, signal } = await waitForExit(child);
  assert.equal(signal, null, `unexpected signal: ${signal ?? "none"}, stderr=${stderr}`);
  assert.equal(code, 0, `unexpected exit code: ${code}, stderr=${stderr}`);
});

