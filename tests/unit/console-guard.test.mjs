import test from "node:test";
import assert from "node:assert/strict";

import {
  enterBootQuietMode,
  enterTuiQuietMode,
  leaveBootQuietMode,
  leaveTuiQuietMode,
  isBootQuietMode,
  isTuiQuietMode,
  resetConsoleGuardForTests,
} from "../../dist/runtime/console-guard.js";

test("boot quiet silences init banners but keeps real dashboard failures", () => {
  const errors = [];
  const realError = console.error;
  const realWarn = console.warn;

  resetConsoleGuardForTests();
  console.error = (...args) => {
    errors.push(args.join(" "));
  };
  console.warn = (...args) => {
    errors.push(args.join(" "));
  };

  try {
    enterBootQuietMode();
    assert.equal(isBootQuietMode(), true);

    console.error("🔍 正在同步动态插件与技能...");
    console.error("🧠 认知引擎模块已启动 (Triple-Path Retrieval Mode)");
    console.error("[Memory] WAL enabled, projection interval=5000ms");
    console.error("[Metrics] enabled, dir=C:\\Users\\Lenovo\\.qling\\metrics");
    console.error("🚀 Dashboard 运行在: http://127.0.0.1:9999");
    console.warn("⚠️ Dashboard 启动跳过: EADDRINUSE");

    assert.equal(errors.some((e) => e.includes("正在同步")), false);
    assert.equal(errors.some((e) => e.includes("认知引擎")), false);
    assert.equal(errors.some((e) => e.includes("WAL enabled")), false);
    assert.equal(errors.some((e) => e.includes("Metrics")), false);
    assert.equal(errors.some((e) => e.includes("Dashboard 运行在")), false);
    assert.equal(errors.some((e) => e.includes("Dashboard 启动跳过")), true);

    enterTuiQuietMode();
    assert.equal(isTuiQuietMode(), true);
    console.error("[ProjectionWorker] replayed 1 entries, checkpoint saved");
    assert.equal(errors.some((e) => e.includes("ProjectionWorker")), false);
    console.error(
      "📊 [Obs] turn=26 tools=0 turnFailRate=0% totalFailRate=0% compactions=3 retries=0"
    );
    assert.equal(errors.some((e) => e.includes("[Obs]")), false);

    leaveTuiQuietMode();
    assert.equal(isBootQuietMode(), false);
  } finally {
    resetConsoleGuardForTests();
    leaveBootQuietMode();
    leaveTuiQuietMode();
    console.error = realError;
    console.warn = realWarn;
  }
});
