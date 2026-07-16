import test from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import {
  isPlanArtifactPath,
  extractWriteTargetPath,
  defaultPlanFileName,
} from "../../dist/plan/plan-artifacts.js";

test("isPlanArtifactPath allows plan dirs only", () => {
  const ws = "C:\\repo\\app";
  assert.equal(isPlanArtifactPath(".qling/plans/a.md", ws), true);
  assert.equal(isPlanArtifactPath("docs/superpowers/plans/b.md", ws), true);
  assert.equal(isPlanArtifactPath("src/index.ts", ws), false);
  assert.equal(isPlanArtifactPath("README.md", ws), false);
  assert.equal(isPlanArtifactPath(join(ws, ".qling", "plans", "x.md"), ws), true);
});

test("extractWriteTargetPath and defaultPlanFileName", () => {
  assert.equal(extractWriteTargetPath({ path: "a.md" }), "a.md");
  assert.equal(extractWriteTargetPath({ file: "b.md" }), "b.md");
  assert.match(defaultPlanFileName("修复 认证"), /\.md$/);
});
