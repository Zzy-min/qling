import test from "node:test";
import assert from "node:assert/strict";
import {
  modeAccentHex,
  modeCapabilities,
  modeCapabilityFooter,
  modeInputTopLabel,
  modePlaceholder,
  modePromptPrefix,
  paintModeSegment,
  parseGrokUiMode,
  resolveGrokUiMode,
  uiModeToSnapshot,
} from "../../dist/tui/mode-chrome.js";
import { formatGrokModeLabel, formatTopBar } from "../../dist/tui/shell.js";
import {
  cycleAgentMode,
  setAgentMode,
  formatModeChromeLine,
} from "../../dist/commands/mode.js";

test("resolveGrokUiMode maps three states", () => {
  assert.equal(resolveGrokUiMode("agent", "ask"), "normal");
  assert.equal(resolveGrokUiMode("plan", "ask"), "plan");
  assert.equal(resolveGrokUiMode("agent", "allow"), "auto");
});

test("mode accents stay distinct for plan/auto/normal", () => {
  const n = modeAccentHex("normal");
  const p = modeAccentHex("plan");
  const a = modeAccentHex("auto");
  assert.notEqual(n, p);
  assert.notEqual(p, a);
  assert.notEqual(n, a);
  assert.match(p, /^#38BDF8$/i);
  assert.match(a, /^#FBBF24$/i);
});

test("modeCapabilities differ by mode", () => {
  const n = modeCapabilities("normal");
  const p = modeCapabilities("plan");
  const a = modeCapabilities("auto");
  assert.equal(n.allowBash, true);
  assert.equal(n.skipToolConfirm, false);
  assert.equal(p.allowBash, false);
  assert.equal(p.allowBusinessWrite, false);
  assert.equal(p.allowPlanWrite, true);
  assert.equal(a.skipToolConfirm, true);
  assert.equal(a.permissionDefault, "allow");
});

test("mode UI labels placeholders prefixes and footers differ", () => {
  assert.match(modeInputTopLabel("plan", ""), /plan|规划/);
  assert.match(modeInputTopLabel("auto", ""), /auto|免确认/);
  assert.match(modeInputTopLabel("normal", ""), /normal|需确认/);
  assert.match(modePlaceholder("plan"), /规划|计划|plans/);
  assert.match(modePlaceholder("auto"), /auto|免确认/);
  assert.ok(paintModeSegment("plan").includes("Mode:plan"));
  assert.notEqual(modePromptPrefix("plan"), modePromptPrefix("normal"));
  assert.notEqual(modePromptPrefix("auto"), modePromptPrefix("normal"));
  assert.match(modeCapabilityFooter("plan"), /bash|计划/);
  assert.match(modeCapabilityFooter("auto"), /allow|免确认|危险/);
  assert.match(modeCapabilityFooter("normal"), /ask|确认|Shift/);
});

test("parseGrokUiMode and uiModeToSnapshot", () => {
  assert.equal(parseGrokUiMode("plan"), "plan");
  assert.equal(parseGrokUiMode("always-approve"), "auto");
  assert.equal(parseGrokUiMode("allow"), "auto");
  assert.equal(parseGrokUiMode("agent"), "normal");
  assert.equal(parseGrokUiMode("nope"), null);
  assert.deepEqual(uiModeToSnapshot("auto"), {
    sessionMode: "agent",
    permissionMode: "allow",
    uiMode: "auto",
  });
  assert.deepEqual(uiModeToSnapshot("plan"), {
    sessionMode: "plan",
    permissionMode: "ask",
    uiMode: "plan",
  });
});

test("setAgentMode and cycleAgentMode", () => {
  let plan = false;
  let permission = "ask";
  const loop = {
    isPlanMode: () => plan,
    setPlanMode: (v) => {
      plan = Boolean(v);
    },
    getPermissionMode: () => permission,
    setPermissionMode: (m) => {
      permission = m;
    },
  };
  assert.equal(setAgentMode(loop, "plan").uiMode, "plan");
  assert.equal(plan, true);
  assert.equal(permission, "ask");
  assert.equal(cycleAgentMode(loop).uiMode, "auto");
  assert.equal(plan, false);
  assert.equal(permission, "allow");
  assert.equal(cycleAgentMode(loop).uiMode, "normal");
  assert.match(formatModeChromeLine({ sessionMode: "agent", permissionMode: "allow", uiMode: "auto" }), /auto/);
});

test("top bar Mode tokens", () => {
  assert.equal(formatGrokModeLabel("plan", "ask"), "plan");
  assert.equal(formatGrokModeLabel("agent", "allow"), "auto");
  const planBar = formatTopBar({
    productName: "轻灵",
    englishName: "Qling",
    version: "1",
    workspace: "w",
    model: "m",
    ready: true,
    tokens: 0,
    branch: "-",
    sessionMode: "plan",
    permissionMode: "ask",
    width: 100,
  }).join("\n");
  assert.match(planBar, /Mode:plan/);
  assert.doesNotMatch(planBar, /Perm:ask/);
});
