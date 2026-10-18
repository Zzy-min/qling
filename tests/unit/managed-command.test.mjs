import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runManagedCommand } from "../../dist/execution/managed-command.js";
import { buildSafeEnv } from "../../dist/tools/bash.js";

function quote(value) {
  return process.platform === "win32" ? `"${value.replace(/"/g, '""')}"` : `'${value.replace(/'/g, `'\\''`)}'`;
}

test("managed command timeout terminates the spawned process tree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-managed-command-"));
  const sentinel = path.join(root, "late-write.txt");
  try {
    await fs.writeFile(path.join(root, "child.mjs"), `import fs from "node:fs"; process.on("SIGTERM", () => {}); setTimeout(() => fs.writeFileSync(${JSON.stringify(sentinel)}, "late"), 900); setTimeout(() => {}, 5000);\n`);
    await fs.writeFile(path.join(root, "parent.mjs"), `import { spawn } from "node:child_process"; spawn(process.execPath, [${JSON.stringify(path.join(root, "child.mjs"))}], { stdio: "ignore" }); setTimeout(() => {}, 5000);\n`);
    const result = await runManagedCommand({
      command: `node parent.mjs`,
      cwd: root,
      runtime: "native",
      env: buildSafeEnv([], {}),
      timeoutMs: 250,
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.terminationConfirmed, true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await assert.rejects(fs.access(sentinel));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
