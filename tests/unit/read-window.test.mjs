import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runRead } from "../../dist/tools/read.js";
import { runWithRuntimeRoots } from "../../dist/runtime-paths.js";

test("read defaults to a 100-line hashed continuation window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-read-window-"));
  await fs.writeFile(path.join(root, "large.txt"), Array.from({ length: 130 }, (_, index) => `line-${index + 1}`).join("\n"));
  try {
    const result = await runWithRuntimeRoots({ workspaceDir: root, fileCacheDir: root, fileStateDir: root }, () => runRead({ path: "large.txt" }));
    assert.notEqual(result.is_error, true);
    assert.match(result.output, /sha256=[a-f0-9]{64}/);
    assert.match(result.output, /next_offset=101/);
    assert.match(result.output, /line-100/);
    assert.doesNotMatch(result.output, /line-101/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
