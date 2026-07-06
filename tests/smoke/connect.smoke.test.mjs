import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ENTRY = join(process.cwd(), "dist", "index.js");

test("P4 connect smoke: shows Chinese guide and boundaries (no secret leak)", () => {
  const result = spawnSync(process.execPath, [ENTRY, "connect", "telegram", "guide"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_CHANNEL_TELEGRAM_TOKEN: "sk-secret-telegram",
    },
    timeout: 5000,
  });

  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /连接器|telegram|guide|doctor/);
  assert.match(out, /边界|绝不写入|复用 scanner/);
  assert.doesNotMatch(out, /sk-secret-telegram/);
});

test("P4 connect smoke: top-level connect works", () => {
  const result = spawnSync(process.execPath, [ENTRY, "connect", "feishu"], {
    encoding: "utf-8",
    env: { ...process.env },
    timeout: 5000,
  });

  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /飞书|Feishu|guide|连接器/);
});

test("P4 connect smoke: missing token friendly", () => {
  const result = spawnSync(process.execPath, [ENTRY, "connect", "slack", "test"], {
    encoding: "utf-8",
    env: { ...process.env },
    timeout: 5000,
  });
  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /slack|测试|doctor/);
  assert.match(out, /❌|未设置/);
});

test("P4 connect smoke: wrong token shows friendly error (desensitized)", () => {
  const result = spawnSync(process.execPath, [ENTRY, "connect", "telegram", "test"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      QLING_CHANNEL_TELEGRAM_TOKEN: "wrong-token-123",
    },
    timeout: 5000,
  });
  const out = (result.stdout || "") + (result.stderr || "");
  assert.match(out, /Telegram|测试|token/);
  assert.doesNotMatch(out, /wrong-token-123/); // 脱敏
  assert.match(out, /doctor|常见失败/);
});