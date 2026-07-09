import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildOnboardingSteps,
  checkOnboarding,
  formatOnboardingCard,
  hasCompletedOnboarding,
  markOnboardingComplete,
  resolveOnboardedPath,
} from "../../dist/onboarding/tutorial.js";

test("buildOnboardingSteps returns three core steps", () => {
  const steps = buildOnboardingSteps();
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((s) => s.id),
    ["task", "slash", "doctor"]
  );
});

test("buildOnboardingSteps prepends setup when needSetup", () => {
  const steps = buildOnboardingSteps({ needSetup: true });
  assert.equal(steps[0].id, "setup");
  assert.ok(steps.length >= 4);
  assert.match(steps[0].example ?? "", /setup/);
});

test("formatOnboardingCard is local-only and lists steps", () => {
  const text = formatOnboardingCard({ productName: "轻灵" }).join("\n");
  assert.match(text, /轻灵/);
  assert.match(text, /1\./);
  assert.match(text, /2\./);
  assert.match(text, /3\./);
  assert.match(text, /不调用模型|本地引导/);
  assert.match(text, /\/doctor/);
  assert.doesNotMatch(text, /sk-/);
});

test("onboarding marker write/read works in temp state dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-onboard-"));
  try {
    assert.equal(await hasCompletedOnboarding(dir), false);
    await markOnboardingComplete(dir);
    assert.equal(await hasCompletedOnboarding(dir), true);
    await access(resolveOnboardedPath(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkOnboarding force shows card without requiring TTY marker write path", async () => {
  const lines = [];
  const result = await checkOnboarding({
    force: true,
    needSetup: true,
    write: (line) => lines.push(line),
  });
  assert.equal(result.shown, true);
  const text = lines.join("\n");
  assert.match(text, /setup|配置/i);
  assert.match(text, /\/doctor|doctor/i);
});
