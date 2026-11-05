import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSkillOutput, formatSkillSummaryLines } from "../../dist/tui/skill-summary.js";
import { FullscreenRenderer } from "../../dist/tui/fullscreen.js";

const skillOutput = [
  "📖 Skill: docker",
  "",
  "⚠️ 安全扫描警告（仍加载）:",
  "  - [warn] shell-exec: 示例包含 sudo",
  "",
  "# Docker 基础",
  "",
  "用于构建和运行容器。",
  "",
  "## 常用命令",
  "- docker run -it alpine sh",
  "## 已知陷阱",
  "- 不要在生产使用 :latest",
].join("\n");

test("skill summary keeps metadata and drops raw body", () => {
  const summary = summarizeSkillOutput(skillOutput);
  assert.equal(summary.name, "docker");
  assert.match(summary.description, /构建和运行容器/);
  assert.deepEqual(summary.headings, ["Docker 基础", "常用命令", "已知陷阱"]);
  assert.equal(summary.warnings.length, 1);
  assert.ok(summary.lineCount >= 6);

  const lines = formatSkillSummaryLines(summary);
  assert.match(lines[0], /已加载 docker/);
  assert.match(lines.join("\n"), /章节: Docker 基础/);
  assert.doesNotMatch(lines.join("\n"), /docker run -it/);
});

test("fullscreen skill tool card shows summary instead of the whole SKILL.md", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 100, rows: 24, colorMode: "none" },
    { write: () => {} }
  );
  renderer.start();
  renderer.appendTool("skill", "skill docker", "success", 12, skillOutput);
  const screen = renderer.snapshot().join("\n");

  assert.match(screen, /加载技能/);
  assert.match(screen, /已加载 docker/);
  assert.match(screen, /章节: Docker 基础/);
  assert.doesNotMatch(screen, /docker run -it alpine/);
  renderer.stop();
});
