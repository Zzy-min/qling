import test from "node:test";
import assert from "node:assert/strict";

import { buildDefaultConfig } from "../../dist/config.js";
import { buildLocalHooksReport, formatLocalHooksReport } from "../../dist/hooks-report.js";

test("hooks report summarizes default local hook pipeline", () => {
  const guard = buildDefaultConfig().guard;
  const report = buildLocalHooksReport(guard);
  const text = formatLocalHooksReport(report).join("\n");

  assert.match(text, /本地 Hooks 状态/);
  assert.match(text, /Guard\s*:/);
  assert.match(text, /PreToolUse/);
  assert.match(text, /permission=allow/);
  assert.match(text, /classifier=on/);
  assert.match(text, /PostToolUse/);
  assert.match(text, /PostToolUseFailure/);
  assert.match(text, /只读取当前本地 hooks\/guard 配置/);
});

test("hooks report includes guard rate content permissions audit redaction and network summary", () => {
  const guard = {
    ...buildDefaultConfig().guard,
    enabled: true,
    audit: { jsonl_path: "C:/state/guard/audit.jsonl" },
    rate_limit: { enabled: true, max_per_minute: 42 },
    content_filter: {
      enabled: true,
      pii_detection: true,
      injection_detection: false,
      custom_patterns: ["SECRET_CUSTOM_PATTERN"],
    },
    permissions: {
      default: "ask",
      rules: [{ tool_pattern: "bash", decision: "deny", reason: "do not leak" }],
    },
    redaction: {
      enabled: true,
      patterns: ["SECRET_REDACTION_PATTERN"],
    },
    network: {
      url_fetch: {
        allowed_url_prefixes: ["https://docs.example.com", "https://api.example.com"],
        deny_private_ips: true,
        follow_redirects: false,
      },
    },
  };

  const text = formatLocalHooksReport(buildLocalHooksReport(guard)).join("\n");

  assert.match(text, /Guard\s*: on/);
  assert.match(text, /permission=ask rules=1/);
  assert.match(text, /rate_limit=on\(42\/min\)/);
  assert.match(text, /content_filter=on pii=on injection=off custom=1/);
  assert.match(text, /Audit\s*: C:\/state\/guard\/audit\.jsonl/);
  assert.match(text, /Redaction\s*: on patterns=1/);
  assert.match(text, /Network\s*: url_fetch prefixes=2 deny_private_ips=true follow_redirects=false/);
  assert.doesNotMatch(text, /SECRET_CUSTOM_PATTERN/);
  assert.doesNotMatch(text, /SECRET_REDACTION_PATTERN/);
  assert.doesNotMatch(text, /do not leak/);
});
