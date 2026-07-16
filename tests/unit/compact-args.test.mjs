import test from "node:test";
import assert from "node:assert/strict";
import { parseCompactArgs } from "../../dist/session/compact-args.js";

test("parseCompactArgs defaults", () => {
  assert.deepEqual(parseCompactArgs([]), { recentKeep: 6, theme: undefined });
});

test("parseCompactArgs keep and theme forms", () => {
  assert.equal(parseCompactArgs(["12"]).recentKeep, 12);
  assert.equal(parseCompactArgs(["--keep", "8"]).recentKeep, 8);
  assert.equal(parseCompactArgs(["--keep=10"]).recentKeep, 10);
  assert.equal(parseCompactArgs(["--theme", "股票复盘"]).theme, "股票复盘");
  assert.equal(parseCompactArgs(["8", "TCL", "日期"]).theme, "TCL 日期");
  assert.equal(parseCompactArgs(["--focus=端午"]).theme, "端午");
});
