/**
 * 可选真实 Playwright e2e：
 *   QLING_BROWSER_ACT=1 QLING_BROWSER_ACT_E2E=1 QLING_GUARD_NETWORK_MODE=open npm test -- tests/smoke/browser-act-e2e.test.mjs
 * 默认 skip，避免 CI 无 Chromium 失败。
 */
import test from "node:test";
import assert from "node:assert/strict";

const enabled =
  process.env.QLING_BROWSER_ACT_E2E === "1" &&
  /^(1|true|on|yes)$/i.test(String(process.env.QLING_BROWSER_ACT ?? ""));

test(
  "browser_act real playwright: open example.com extract close",
  { skip: !enabled },
  async () => {
    process.env.QLING_GUARD_NETWORK_MODE = process.env.QLING_GUARD_NETWORK_MODE || "open";
    const { runBrowserAct } = await import("../../dist/tools/browser-act.js");
    const { resetBrowserSessionPool } = await import("../../dist/tools/browser-act-session.js");
    resetBrowserSessionPool(null);

    const open = await runBrowserAct({
      action: "open",
      session: "e2e",
      url: "https://example.com",
      timeout_ms: 30_000,
    });
    assert.ok(!open.is_error, open.output);

    const extract = await runBrowserAct({
      action: "extract",
      session: "e2e",
      timeout_ms: 30_000,
    });
    assert.ok(!extract.is_error, extract.output);
    assert.match(String(extract.output), /Example|example/i);

    const closed = await runBrowserAct({ action: "close", session: "e2e" });
    assert.ok(!closed.is_error, closed.output);
    resetBrowserSessionPool(null);
  }
);
