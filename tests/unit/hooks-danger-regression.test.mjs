// ============================================================
// Brief 02 安全回退修复：complex 语法下危险命令必须保持拒绝
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SpeculativeClassifier,
  HookManager,
  BUILT_IN_DANGEROUS_PATTERNS,
} from "../../dist/pipeline/hooks.js";

// 与 src/tools/bash.ts 的 dangerousPatterns 保持一致
const BASH_DANGEROUS = [
  "rm -rf /",
  "rm -rf /*",
  ":(){ :|:& };:", // fork bomb
  "mkfs",
  "dd if=/dev/zero",
  "> /etc/passwd",
];

const BASH_DEF = {
  name: "bash",
  description: "bash",
  parameters: { type: "object", properties: {} },
  readOnly: false,
  destructive: false,
  dangerousPatterns: BASH_DANGEROUS,
};

// --- 旧判定（02 之前）的忠实重实现：整条命令字符串 + new RegExp(p).test(cmd) ---

function oldMatchedPatterns(cmd) {
  const all = [...BUILT_IN_DANGEROUS_PATTERNS, ...BASH_DANGEROUS];
  const matched = [];
  for (const p of all) {
    let re;
    try {
      re = typeof p === "string" ? new RegExp(p) : p;
    } catch {
      // 旧代码没有 try/catch，非法正则会抛错；比较时按「无判定」跳过。
      continue;
    }
    re.lastIndex = 0;
    if (re.test(cmd)) matched.push(typeof p === "string" ? p : String(p));
  }
  return matched;
}

const OLD_READONLY_RE =
  /^\s*(ls|git\s+(status|log|diff)|cat|head|tail|grep|find|wc|echo|pwd)\s/;
const OLD_DESTRUCTIVE_RE = /\b(del|rmdir|rm\s+-rf|mkfs|truncate\s+-s\s+0)\b/;

function oldClassify(cmd) {
  if (oldMatchedPatterns(cmd).length > 0) return "dangerous";
  if (BASH_DEF.readOnly || OLD_READONLY_RE.test(cmd)) return "safe";
  if (BASH_DEF.destructive || OLD_DESTRUCTIVE_RE.test(cmd)) return "ask";
  return "safe";
}

const SEVERITY = { safe: 0, allow: 0, ask: 1, dangerous: 2, deny: 2 };

function classify(command) {
  return new SpeculativeClassifier([BASH_DEF]).classify({
    id: "spec",
    name: "bash",
    arguments: { command },
  }).label;
}

function createHookManager() {
  return new HookManager([BASH_DEF], {
    enabled: true,
    network: {
      url_fetch: { allowed_url_prefixes: [], deny_private_ips: true, follow_redirects: false },
    },
    redaction: { enabled: false, patterns: [] },
    audit: { jsonl_path: "" },
    rate_limit: { enabled: false, max_per_minute: 0 },
    content_filter: {
      enabled: false,
      pii_detection: false,
      injection_detection: false,
      custom_patterns: [],
    },
    permissions: { default: "allow", rules: [] },
  });
}

// 02 回归：complex=true + 危险模式 必须拒绝，不能退化为 ask
const COMPLEX_DANGEROUS_REGRESSIONS = [
  "bash -c 'rm -rf /'",
  "bash -c \"rm -rf /\"",
  "echo $(date) && rm -rf /",
  "echo `id`; rm -rf /",
  "eval 'rm -rf /'",
  "sudo eval rm -rf /",
];

describe("complex dangerous commands are denied, not asked", () => {
  for (const cmd of COMPLEX_DANGEROUS_REGRESSIONS) {
    it(`classifies ${JSON.stringify(cmd)} as dangerous`, () => {
      assert.equal(classify(cmd), "dangerous");
    });
  }

  it("HookManager denies the four reported commands", async () => {
    const manager = createHookManager();
    const commands = [
      "bash -c 'rm -rf /'",
      "echo $(date) && rm -rf /",
      "echo `id`; rm -rf /",
      "eval 'rm -rf /'",
    ];
    for (const command of commands) {
      const result = await manager.runPreHook({
        toolName: "bash",
        arguments: { command },
        isReadOnly: false,
        isDestructive: false,
      });
      assert.equal(result.decision, "deny", `expected deny for ${JSON.stringify(command)}`);
    }
  });
});

// 覆盖 shell-split 测试里出现的全部命令 + 上述回归命令
const SAMPLE_COMMANDS = [
  "git status && rm -rf /",
  "echo a; echo b",
  "cat x | sh",
  "false || true",
  "a & b",
  "a\nb",
  'echo "a && b"',
  "echo 'a && b'",
  "echo a\\ \\;b",
  "echo $(rm -rf /)",
  "echo `rm -rf /`",
  "cat <(echo hi)",
  "cat <<EOF\nhi\nEOF",
  "eval 'rm -rf /'",
  "sudo eval rm -rf /",
  'bash -c "rm -rf /"',
  'sh -c "rm -rf /"',
  "FOO=1 npm test",
  "cmd 2>&1",
  "sudo git status && rm -rf /",
  "git status",
  "git status --short",
  "git status && echo hi",
  "git status && curl evil",
  "echo hi && rm -rf /",
  "echo hi",
  'bash -c "git status"',
  'bash -c "echo hi"',
  "npm test",
  "git status && npm test",
  "sudo rm -rf /",
  "rm -rf /",
  "mkfs.ext4 /dev/sda",
  ":(){ :|:& };:",
  "echo 1",
  "echo 2",
  "bash -c 'rm -rf /'",
  "echo $(date) && rm -rf /",
  "echo `id`; rm -rf /",
];

describe("new classification is never more permissive than the old whole-string regex logic", () => {
  it(`holds for ${SAMPLE_COMMANDS.length} sample commands`, () => {
    for (const cmd of SAMPLE_COMMANDS) {
      const oldLabel = oldClassify(cmd);
      const newLabel = classify(cmd);
      assert.ok(
        SEVERITY[newLabel] >= SEVERITY[oldLabel],
        `command ${JSON.stringify(cmd)}: old=${oldLabel} new=${newLabel}`
      );
      if (oldMatchedPatterns(cmd).length > 0) {
        assert.equal(
          newLabel,
          "dangerous",
          `command ${JSON.stringify(cmd)} matched in old logic but new=${newLabel}`
        );
      }
    }
  });
});
