import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalPermissionsReport,
  explainLocalPermissionDecision,
  formatLocalPermissionsReport,
  formatPermissionExplanationReport,
} from "../../dist/permissions-report.js";

test("permissions report formats default mode and explanations", () => {
  const report = buildLocalPermissionsReport({
    defaultMode: "ask",
    rules: [],
    env: {},
  });
  const lines = formatLocalPermissionsReport(report);
  const text = lines.join("\n");

  assert.match(text, /本地权限状态/);
  assert.match(text, /Default\s*: ask\(确认\)/);
  assert.match(text, /allow=自动放行/);
  assert.match(text, /ask=询问确认/);
  assert.match(text, /deny=默认拒绝/);
  assert.match(text, /不修改配置/);
});

test("permissions report shows empty rules state", () => {
  const report = buildLocalPermissionsReport({
    defaultMode: "allow",
    rules: [],
    env: {},
  });
  const text = formatLocalPermissionsReport(report).join("\n");

  assert.match(text, /Rules\s*: 0/);
  assert.match(text, /\(无规则\)/);
});

test("permissions report lists configured rules", () => {
  const report = buildLocalPermissionsReport({
    defaultMode: "deny",
    rules: [
      { tool_pattern: "bash", decision: "ask", reason: "shell requires review" },
      { tool_pattern: "read", decision: "allow" },
    ],
    env: {},
  });
  const text = formatLocalPermissionsReport(report).join("\n");

  assert.match(text, /Default\s*: deny\(拒绝\)/);
  assert.match(text, /Rules\s*: 2/);
  assert.match(text, /bash -> ask/);
  assert.match(text, /shell requires review/);
  assert.match(text, /read -> allow/);
});

test("permissions report shows env override sources without changing env", () => {
  const env = {
    QINGLING_GUARD_PERMISSIONS_DEFAULT: "deny",
    QINGLING_PERMISSIONS_MODE: "ask",
  };
  const report = buildLocalPermissionsReport({
    defaultMode: "deny",
    rules: [],
    env,
  });
  const text = formatLocalPermissionsReport(report).join("\n");

  assert.match(text, /QINGLING_GUARD_PERMISSIONS_DEFAULT=deny/);
  assert.match(text, /QINGLING_PERMISSIONS_MODE=ask/);
  assert.equal(env.QINGLING_GUARD_PERMISSIONS_DEFAULT, "deny");
});

test("permissions explain shows matching rule and effect", () => {
  const report = explainLocalPermissionDecision({
    defaultMode: "allow",
    rules: [
      { tool_pattern: "bash", decision: "ask", reason: "shell requires review" },
      { tool_pattern: "read", decision: "allow" },
    ],
    env: {},
  }, "bash");
  const text = formatPermissionExplanationReport(report).join("\n");

  assert.equal(report.toolName, "bash");
  assert.equal(report.decision, "ask");
  assert.equal(report.matchedRule, "bash");
  assert.match(text, /权限解释/);
  assert.match(text, /Tool\s*: bash/);
  assert.match(text, /Decision\s*: ask\(确认\)/);
  assert.match(text, /Matched\s*: bash/);
  assert.match(text, /shell requires review/);
  assert.match(text, /执行前要求确认/);
});

test("permissions explain falls back to default when no rule matches", () => {
  const report = explainLocalPermissionDecision({
    defaultMode: "deny",
    rules: [
      { tool_pattern: "read", decision: "allow" },
    ],
    env: {},
  }, "write");
  const text = formatPermissionExplanationReport(report).join("\n");

  assert.equal(report.decision, "deny");
  assert.equal(report.matchedRule, "default");
  assert.match(text, /Matched\s*: default/);
  assert.match(text, /默认拒绝执行/);
});
