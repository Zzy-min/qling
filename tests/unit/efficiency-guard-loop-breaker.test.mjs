import test from "node:test";
import assert from "node:assert/strict";

import { RunEfficiencyGuard } from "../../dist/agent/run-efficiency.js";
import { upsertSyntheticMessage } from "../../dist/agent/synthetic-messages.js";
import {
  buildToolSignature,
  normalizeCommandForSignature,
  prepareToolCalls,
} from "../../dist/agent/tool-orchestrator.js";

test("efficiency guard escalates warnings and triggers hard circuit breaker at halt limit", () => {
  const guard = new RunEfficiencyGuard({
    noProgressReplanLimit: 4,
    noProgressNarrowLimit: 8,
    noProgressHaltLimit: 12,
  });

  // Steps 1..3: below replan limit
  for (let index = 0; index < 3; index++) {
    const signal = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: `np-${index}`, value: 0 });
    assert.equal(signal, null);
  }

  // Step 4: hits noProgressReplanLimit
  const replan = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-3", value: 0 });
  assert.equal(replan?.directive.action, "replan_repository");
  assert.equal(replan?.disposition, "redirect");
  assert.match(replan?.reason ?? "", /停止随机浏览/);

  // Steps 5..7: in between replan and narrow
  for (let index = 4; index < 7; index++) {
    const signal = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: `np-${index}`, value: 0 });
    assert.equal(signal, null);
  }

  // Step 8: hits noProgressNarrowLimit
  const narrow = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-7", value: 0 });
  assert.equal(narrow?.directive.action, "narrow_recovery");
  assert.equal(narrow?.disposition, "redirect");
  assert.match(narrow?.reason ?? "", /切换到环境、仓库索引和验证恢复工具/);

  // Step 9: odd step between narrow and halt -> silent
  const step9 = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-8", value: 0 });
  assert.equal(step9, null);

  // Step 10: even step -> escalating warning with remaining steps before pause
  const step10 = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-9", value: 0 });
  assert.equal(step10?.directive.action, "narrow_recovery");
  assert.equal(step10?.disposition, "redirect");
  assert.match(step10?.reason ?? "", /将在 2 步后触发硬熔断暂停/);

  // Step 11: odd step -> silent
  const step11 = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-10", value: 0 });
  assert.equal(step11, null);

  // Step 12: hits noProgressHaltLimit -> hard circuit breaker pause!
  const halt = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-11", value: 0 });
  assert.equal(halt?.code, "NO_PROGRESS_HALT");
  assert.equal(halt?.disposition, "pause");
  assert.match(halt?.reason ?? "", /触发效率守卫硬熔断；任务自动暂停/);
  assert.equal(halt?.directive.action, "checkpoint");

  // Step 13+: remains in hard pause if called further
  const step13 = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "np-12", value: 0 });
  assert.equal(step13?.disposition, "pause");
});

test("causal evidence resets no_progress actions count before reaching halt limit", () => {
  const guard = new RunEfficiencyGuard({
    noProgressReplanLimit: 4,
    noProgressNarrowLimit: 8,
    noProgressHaltLimit: 12,
  });

  // Stagnate for 10 steps
  for (let index = 0; index < 10; index++) {
    guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: `np-${index}`, value: 0 });
  }

  // Produce genuine causal repository evidence
  const evidence = guard.recordProgress({
    phase: "explore",
    sourceTool: "repo_query",
    kind: "causal_repository_evidence",
    fingerprint: "repo_query:evidence-1",
    value: 1,
  });
  assert.equal(evidence, null);

  // Now next 3 no_progress steps are within step 1..3, so no signals yet
  for (let index = 0; index < 3; index++) {
    const signal = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: `np-reset-${index}`, value: 0 });
    assert.equal(signal, null);
  }
});

test("episodic synthetic messages are placed at the tail of active messages", () => {
  const messages = [
    { role: "user", content: "请分析 opencli 源码" },
    { role: "assistant", content: "好的，我先读取文件。" },
    { role: "user", content: "继续执行" },
  ];

  // Insert efficiency recovery message
  upsertSyntheticMessage(
    messages,
    "efficiency_recovery",
    "<efficiency_recovery>停止随机浏览</efficiency_recovery>",
    "rec-1"
  );

  // Must be at the very tail so LLM attention sees it immediately
  assert.equal(messages[messages.length - 1].synthetic_reason, "efficiency_recovery");
  assert.equal(messages[messages.length - 1].content, "<efficiency_recovery>停止随机浏览</efficiency_recovery>");

  // Another turn happens
  messages.push({ role: "assistant", content: "我又做了一次工具调用" });

  // Update efficiency recovery with new instruction
  upsertSyntheticMessage(
    messages,
    "efficiency_recovery",
    "<efficiency_recovery>已进入窄恢复模式</efficiency_recovery>",
    "rec-2"
  );

  // Previous efficiency_recovery is removed from earlier position, new one is at the tail
  const allRecoveries = messages.filter((m) => m.synthetic_reason === "efficiency_recovery");
  assert.equal(allRecoveries.length, 1);
  assert.equal(messages[messages.length - 1].synthetic_reason, "efficiency_recovery");
  assert.equal(messages[messages.length - 1].content, "<efficiency_recovery>已进入窄恢复模式</efficiency_recovery>");

  // Preamble message (runtime_environment) is still placed before firstRealUser
  upsertSyntheticMessage(messages, "runtime_environment", "Node 20", "rt-1");
  assert.equal(messages[0].synthetic_reason, "runtime_environment");
});

test("bash command normalization strips temporary file redirect increments", () => {
  const cmd1 = 'cmd.exe /c "grep -a -n -e \\"OpenCLI\\" C:\\Users\\Lenovo\\AppData\\Local\\Temp\\r1.txt > C:\\Users\\Lenovo\\AppData\\Local\\Temp\\g3.txt"';
  const cmd2 = 'cmd.exe /c "grep -a -n -e \\"OpenCLI\\" C:\\Users\\Lenovo\\AppData\\Local\\Temp\\r1.txt > C:\\Users\\Lenovo\\AppData\\Local\\Temp\\g4.txt"';
  const cmd3 = 'cmd.exe /c "grep -a -n -e \\"OpenCLI\\" %TEMP%\\r1.txt > %TEMP%\\g5.txt"';

  const norm1 = normalizeCommandForSignature(cmd1);
  const norm2 = normalizeCommandForSignature(cmd2);
  const norm3 = normalizeCommandForSignature(cmd3);

  assert.equal(norm1, norm2);
  assert.equal(norm1, norm3);

  const sig1 = buildToolSignature("bash", { command: cmd1 });
  const sig2 = buildToolSignature("bash", { command: cmd2 });
  const sig3 = buildToolSignature("bash", { command: cmd3 });

  assert.equal(sig1, sig2);
  assert.equal(sig1, sig3);
});

test("prepareToolCalls detects loop when command outputs to sequential temp files", () => {
  const signatureCounts = new Map();
  const calls = [
    { id: "1", type: "function", function: { name: "bash", arguments: '{"command": "grep -a OpenCLI r1.txt > %TEMP%\\\\g1.txt"}' } },
    { id: "2", type: "function", function: { name: "bash", arguments: '{"command": "grep -a OpenCLI r1.txt > %TEMP%\\\\g2.txt"}' } },
    { id: "3", type: "function", function: { name: "bash", arguments: '{"command": "grep -a OpenCLI r1.txt > %TEMP%\\\\g3.txt"}' } },
    { id: "4", type: "function", function: { name: "bash", arguments: '{"command": "grep -a OpenCLI r1.txt > %TEMP%\\\\g4.txt"}' } },
  ];

  // Tool repeat limit = 3
  const prepared = prepareToolCalls(calls, { toolRepeatLimit: 3, signatureCounts });
  assert.equal(prepared[0].immediateResult, undefined);
  assert.equal(prepared[1].immediateResult, undefined);
  assert.equal(prepared[2].immediateResult, undefined);

  // 4th call exceeds limit of 3
  assert.ok(prepared[3].loopDetected);
  assert.equal(prepared[3].immediateResult?.error?.code, "TOOL_REPEAT_LIMIT_EXCEEDED");
  assert.match(prepared[3].immediateResult?.output ?? "", /exceeded repeat limit/);
});
