import test from "node:test";
import assert from "node:assert/strict";
import {
  isBrowserActEnabled,
  browserActTool,
  runBrowserAct,
} from "../../dist/tools/browser-act.js";
import {
  BrowserSessionPool,
  resetBrowserSessionPool,
} from "../../dist/tools/browser-act-session.js";

function fakeBrowser() {
  let currentUrl = "about:blank";
  const page = {
    url: () => currentUrl,
    goto: async (u) => {
      currentUrl = u;
    },
    title: async () => "Example",
    click: async () => {},
    fill: async () => {},
    waitForSelector: async () => {},
    locator: () => ({
      innerText: async () => "hello from page",
    }),
    evaluate: async () => "full body text",
    focus: async () => {},
    keyboard: { press: async () => {} },
  };
  return {
    newContext: async () => ({
      route: async () => {},
      newPage: async () => page,
    }),
    close: async () => {},
  };
}

function failingBrowser() {
  const page = {
    url: () => "about:blank",
    goto: async () => {
      throw new Error("navigation failed");
    },
    title: async () => "never",
  };
  return {
    newContext: async () => ({
      route: async () => {},
      newPage: async () => page,
    }),
    close: async () => {},
  };
}

test("browser_act: disabled by default", () => {
  assert.equal(isBrowserActEnabled({}), false);
  assert.equal(isBrowserActEnabled({ QLING_BROWSER_ACT: "0" }), false);
});

test("browser_act: enabled via env", () => {
  assert.equal(isBrowserActEnabled({ QLING_BROWSER_ACT: "1" }), true);
  assert.equal(isBrowserActEnabled({ QLING_BROWSER_ACT: "true" }), true);
  assert.equal(isBrowserActEnabled({ QLING_BROWSER_ACT: "ON" }), true);
});

test("browser_act tool definition", () => {
  assert.equal(browserActTool.name, "browser_act");
  assert.equal(browserActTool.readOnly, false);
  assert.ok(browserActTool.parameters.properties.session);
});

test("runBrowserAct: refuses when disabled", async () => {
  const prev = process.env.QLING_BROWSER_ACT;
  delete process.env.QLING_BROWSER_ACT;
  try {
    const r = await runBrowserAct({ action: "goto", url: "https://example.com" });
    assert.equal(r.is_error, true);
    assert.match(
      String(r.output ?? r.error?.message ?? ""),
      /BROWSER_ACT_DISABLED|默认关闭|QLING_BROWSER_ACT/
    );
  } finally {
    if (prev === undefined) delete process.env.QLING_BROWSER_ACT;
    else process.env.QLING_BROWSER_ACT = prev;
  }
});

test("runBrowserAct: session open → extract → close (fake browser)", async () => {
  const prev = process.env.QLING_BROWSER_ACT;
  const prevMode = process.env.QLING_GUARD_NETWORK_MODE;
  process.env.QLING_BROWSER_ACT = "1";
  process.env.QLING_GUARD_NETWORK_MODE = "open";
  resetBrowserSessionPool(
    new BrowserSessionPool({
      maxSessions: 2,
      idleTtlMs: 60_000,
      launchBrowser: async () => fakeBrowser(),
    })
  );
  try {
    const open = await runBrowserAct({
      action: "open",
      session: "t1",
      url: "https://example.com",
    });
    assert.ok(!open.is_error, open.output);
    assert.match(String(open.output), /session open|goto/);

    const click = await runBrowserAct({
      action: "click",
      session: "t1",
      selector: "#btn",
    });
    assert.ok(!click.is_error, click.output);
    assert.match(String(click.output), /click ok/);

    const extract = await runBrowserAct({
      action: "extract",
      session: "t1",
    });
    assert.ok(!extract.is_error, extract.output);
    assert.match(String(extract.output), /full body text|hello from page|Example/);

    const st = await runBrowserAct({ action: "status" });
    assert.ok(!st.is_error);
    assert.match(String(st.output), /t1/);

    const closed = await runBrowserAct({ action: "close", session: "t1" });
    assert.ok(!closed.is_error);
    assert.match(String(closed.output), /closed/);
  } finally {
    resetBrowserSessionPool(null);
    if (prev === undefined) delete process.env.QLING_BROWSER_ACT;
    else process.env.QLING_BROWSER_ACT = prev;
    if (prevMode === undefined) delete process.env.QLING_GUARD_NETWORK_MODE;
    else process.env.QLING_GUARD_NETWORK_MODE = prevMode;
  }
});

test("runBrowserAct: click without session fails clearly", async () => {
  const prev = process.env.QLING_BROWSER_ACT;
  process.env.QLING_BROWSER_ACT = "1";
  resetBrowserSessionPool(
    new BrowserSessionPool({
      launchBrowser: async () => fakeBrowser(),
    })
  );
  try {
    const r = await runBrowserAct({
      action: "click",
      session: "missing",
      selector: "a",
    });
    assert.equal(r.is_error, true);
    assert.match(String(r.output ?? r.error?.message ?? ""), /NO_SESSION|无会话|open|goto/);
  } finally {
    resetBrowserSessionPool(null);
    if (prev === undefined) delete process.env.QLING_BROWSER_ACT;
    else process.env.QLING_BROWSER_ACT = prev;
  }
});

test("runBrowserAct: failed first navigation closes the new session", async () => {
  const prev = process.env.QLING_BROWSER_ACT;
  const prevMode = process.env.QLING_GUARD_NETWORK_MODE;
  process.env.QLING_BROWSER_ACT = "1";
  process.env.QLING_GUARD_NETWORK_MODE = "open";
  const pool = new BrowserSessionPool({
    launchBrowser: async () => failingBrowser(),
  });
  resetBrowserSessionPool(pool);
  try {
    const result = await runBrowserAct({
      action: "open",
      session: "leak-check",
      url: "https://example.com",
    });
    assert.equal(result.is_error, true);
    assert.equal(pool.has("leak-check"), false);
  } finally {
    resetBrowserSessionPool(null);
    if (prev === undefined) delete process.env.QLING_BROWSER_ACT;
    else process.env.QLING_BROWSER_ACT = prev;
    if (prevMode === undefined) delete process.env.QLING_GUARD_NETWORK_MODE;
    else process.env.QLING_GUARD_NETWORK_MODE = prevMode;
  }
});

test("runBrowserAct: guard rejects goto before creating a browser session", async () => {
  const prevEnabled = process.env.QLING_BROWSER_ACT;
  const prevGuard = process.env.QLING_GUARD_ENABLED;
  process.env.QLING_BROWSER_ACT = "1";
  process.env.QLING_GUARD_ENABLED = "true";
  let launches = 0;
  const pool = new BrowserSessionPool({
    launchBrowser: async () => {
      launches++;
      return fakeBrowser();
    },
  });
  resetBrowserSessionPool(pool);
  try {
    const result = await runBrowserAct({
      action: "goto",
      session: "blocked",
      url: "http://127.0.0.1/private",
    });
    assert.equal(result.is_error, true);
    assert.equal(launches, 0);
    assert.equal(pool.has("blocked"), false);
  } finally {
    resetBrowserSessionPool(null);
    if (prevEnabled === undefined) delete process.env.QLING_BROWSER_ACT;
    else process.env.QLING_BROWSER_ACT = prevEnabled;
    if (prevGuard === undefined) delete process.env.QLING_GUARD_ENABLED;
    else process.env.QLING_GUARD_ENABLED = prevGuard;
  }
});
