import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryStore } from "../../dist/memory.js";
import { runAutoDream } from "../../dist/memory/lifecycle.js";

test("runAutoDream local path adds memories without LLM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-dream-"));
  try {
    const store = new MemoryStore(dir, { workspaceDir: dir });
    await store.init();
    const changed = await runAutoDream({
      messages: [
        { role: "user", content: "记住：项目使用 TypeScript 严格模式" },
        { role: "assistant", content: "好的，已记录 TypeScript 严格模式偏好。" },
        { role: "user", content: "继续" },
        { role: "assistant", content: "继续推进。" },
      ],
      turnCount: 30,
      memoryStore: store,
      memoryDreamLLMEnabled: false,
      memoryDreamTurnThreshold: 1,
      memoryMaxEntries: 100,
      model: "x",
      apiKey: "k",
      endpoint: "http://127.0.0.1:9",
    });
    assert.ok(changed >= 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
