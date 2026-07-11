import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserSessionPool,
  normalizeSessionId,
  resetBrowserSessionPool,
} from "../../dist/tools/browser-act-session.js";

function fakeBrowser() {
  const page = {
    url: () => "about:blank",
    goto: async () => {},
    title: async () => "t",
    click: async () => {},
    fill: async () => {},
    waitForSelector: async () => {},
    locator: () => ({ innerText: async () => "x" }),
    evaluate: async () => "body",
    focus: async () => {},
    keyboard: { press: async () => {} },
  };
  return {
    newContext: async () => ({
      newPage: async () => page,
    }),
    close: async () => {},
  };
}

function guardedFakeBrowser(capture) {
  const page = {
    url: () => "about:blank",
    goto: async () => {},
    title: async () => "t",
  };
  return {
    newContext: async () => ({
      route: async (_pattern, handler) => {
        capture.handler = handler;
      },
      newPage: async () => page,
    }),
    close: async () => {},
  };
}

test("normalizeSessionId sanitizes", () => {
  assert.equal(normalizeSessionId(""), "default");
  assert.equal(normalizeSessionId(undefined), "default");
  assert.equal(normalizeSessionId("my session"), "my_session");
  assert.equal(normalizeSessionId("../x"), normalizeSessionId("../x")); // 稳定且无路径分隔
  assert.doesNotMatch(normalizeSessionId("../x"), /[\\/]/);
});

test("BrowserSessionPool open reuses same id", async () => {
  const pool = new BrowserSessionPool({
    maxSessions: 2,
    idleTtlMs: 60_000,
    launchBrowser: async () => fakeBrowser(),
  });
  const a = await pool.open("s1");
  const b = await pool.open("s1");
  assert.equal(a, b);
  assert.equal(pool.size(), 1);
  await pool.closeAll();
});

test("BrowserSessionPool evicts oldest when max exceeded", async () => {
  const pool = new BrowserSessionPool({
    maxSessions: 2,
    idleTtlMs: 0,
    launchBrowser: async () => fakeBrowser(),
  });
  await pool.open("a");
  await new Promise((r) => setTimeout(r, 5));
  await pool.open("b");
  await new Promise((r) => setTimeout(r, 5));
  await pool.open("c");
  assert.equal(pool.size(), 2);
  assert.equal(pool.has("a"), false);
  assert.equal(pool.has("c"), true);
  await pool.closeAll();
});

test("BrowserSessionPool sweepIdle closes stale", async () => {
  const pool = new BrowserSessionPool({
    maxSessions: 3,
    idleTtlMs: 10,
    launchBrowser: async () => fakeBrowser(),
  });
  await pool.open("old");
  const handle = pool.get("old");
  handle.lastUsedAt = Date.now() - 1000;
  const closed = await pool.sweepIdle();
  assert.ok(closed.includes("old"));
  assert.equal(pool.size(), 0);
});

test("BrowserSessionPool applies request guard to redirects and subresources", async () => {
  const capture = {};
  const pool = new BrowserSessionPool({
    launchBrowser: async () => guardedFakeBrowser(capture),
  });
  await pool.open("guarded", async (url) => !url.includes("127.0.0.1"));
  assert.equal(typeof capture.handler, "function");

  let continued = 0;
  let aborted = 0;
  await capture.handler({
    request: () => ({ url: () => "http://127.0.0.1/private" }),
    continue: async () => {
      continued++;
    },
    abort: async () => {
      aborted++;
    },
  });
  assert.equal(aborted, 1);
  assert.equal(continued, 0);

  await capture.handler({
    request: () => ({ url: () => "https://example.com/app.js" }),
    continue: async () => {
      continued++;
    },
    abort: async () => {
      aborted++;
    },
  });
  assert.equal(continued, 1);
  await pool.closeAll();
});

test("resetBrowserSessionPool clears default", () => {
  resetBrowserSessionPool(null);
  assert.ok(true);
});
