import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ENTRY = join(process.cwd(), "dist/index.js");

test("cli run smoke: telegram default without token fails fast with coded error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qingling-channel-smoke-"));
  try {
    const configPath = join(dir, "qingling.config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        channels: {
          default: "telegram",
          telegram: {
            token: "",
            poll_interval_ms: 3000,
            allowed_chat_ids: [],
          },
          slack: {
            bot_token: "",
            app_token: "",
            channel_ids: [],
            poll_interval_ms: 3000,
          },
        },
      }),
      "utf-8"
    );

    const result = spawnSync(
      process.execPath,
      [
        ENTRY,
        "run",
        "smoke-task",
        "--config",
        configPath,
        "--api-key",
        "test-key",
      ],
      { encoding: "utf-8" }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLI_CHANNEL_MISSING_CREDENTIALS/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

