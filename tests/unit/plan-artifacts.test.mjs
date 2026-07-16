import test from "node:test";
import assert from "node:assert/strict";
import { join } from "path";
import {
  isPlanArtifactPath,
  extractWriteTargetPath,
  defaultPlanFileName,
} from "../../dist/plan/plan-artifacts.js";

test("isPlanArtifactPath allows plan dirs only", () => {
  // 使用真实 cwd，避免 `C:\...` 在 Linux CI 上不是绝对路径
  const ws = process.cwd();
  assert.equal(isPlanArtifactPath(".qling/plans/a.md", ws), true);
  assert.equal(isPlanArtifactPath("docs/superpowers/plans/b.md", ws), true);
  // 反斜杠风格（Windows 用户粘贴）在 POSIX 上也应识别
  assert.equal(isPlanArtifactPath(".qling\\plans\\c.md", ws), true);
  assert.equal(isPlanArtifactPath("src/index.ts", ws), false);
  assert.equal(isPlanArtifactPath("README.md", ws), false);
  assert.equal(isPlanArtifactPath(join(ws, ".qling", "plans", "x.md"), ws), true);
});

test("extractWriteTargetPath and defaultPlanFileName", () => {
  assert.equal(extractWriteTargetPath({ path: "a.md" }), "a.md");
  assert.equal(extractWriteTargetPath({ file: "b.md" }), "b.md");
  assert.match(defaultPlanFileName("修复 认证"), /\.md$/);
});
