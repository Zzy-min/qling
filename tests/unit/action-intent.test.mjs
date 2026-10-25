import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { authorizeActionIntent, deriveUserActionIntent } from "../../dist/harness/action-intent.js";

test("trusted user task authorizes workspace effects only inside its workspace", () => {
  const workspace = path.resolve("C:/workspace/project");
  const intent = deriveUserActionIntent({
    userMessage: "修复这个项目并运行测试",
    workspaceDir: workspace,
    sourceEventId: "event-1",
    now: 100,
  });
  assert.equal(authorizeActionIntent({ intent, tool: "write", effect: "workspace", target: path.join(workspace, "src/a.ts"), now: 101 }).allowed, true);
  assert.equal(authorizeActionIntent({ intent, tool: "write", effect: "workspace", target: path.resolve(workspace, "../secret.txt"), now: 101 }).allowed, false);
  assert.equal(authorizeActionIntent({ intent, tool: "bash", effect: "external", now: 101 }).allowed, false);
});

test("remote data cannot authorize side effects and explicit push intent still expires", () => {
  const workspace = path.resolve("C:/workspace/project");
  const intent = deriveUserActionIntent({ userMessage: "提交并推送", workspaceDir: workspace, sourceEventId: "event-2", now: 100 });
  assert.equal(authorizeActionIntent({ intent, tool: "bash", effect: "external", now: 101 }).allowed, true);
  assert.equal(authorizeActionIntent({ intent: { ...intent, trust: "remote_data" }, tool: "bash", effect: "external", now: 101 }).allowed, false);
  assert.equal(authorizeActionIntent({ intent, tool: "bash", effect: "external", now: 3_600_101 }).allowed, false);
});

test("a read-only analysis request does not authorize workspace mutation", () => {
  const workspace = path.resolve("C:/workspace/project");
  const intent = deriveUserActionIntent({ userMessage: "分析这个仓库结构", workspaceDir: workspace, sourceEventId: "event-3", now: 100 });
  assert.equal(authorizeActionIntent({ intent, tool: "write", effect: "workspace", target: path.join(workspace, "a.ts"), now: 101 }).allowed, false);
  assert.equal(authorizeActionIntent({ intent, tool: "bash", effect: "process", now: 101 }).allowed, true);
});
