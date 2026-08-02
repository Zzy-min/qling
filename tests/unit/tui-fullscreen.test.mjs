import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";

import {
  consumeMouseInput,
  consumeMouseWheel,
  FullscreenRenderer,
  formatFullscreenFooterHints,
  formatFullscreenHeader,
  parseTuiMode,
  resolveColorMode,
  resolveIconMode,
  resolveTuiMode,
} from "../../dist/tui/fullscreen.js";
test("fullscreen mode resolves TTY and size boundaries", () => {
  assert.equal(parseTuiMode("fullscreen"), "fullscreen");
  assert.equal(parseTuiMode("bad"), null);
  assert.equal(resolveTuiMode("auto", { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24 }), "fullscreen");
  assert.equal(resolveTuiMode("auto", { stdinTTY: true, stdoutTTY: true, columns: 79, rows: 24 }), "classic");
  assert.equal(resolveTuiMode("fullscreen", { stdinTTY: false, stdoutTTY: true, columns: 160, rows: 50 }), "classic");
  assert.equal(resolveIconMode("nerd"), "nerd");
  assert.equal(resolveIconMode("auto"), "unicode");
  assert.equal(resolveColorMode({ NO_COLOR: "" }), "none");
  assert.equal(resolveColorMode({ COLORTERM: "truecolor" }), "truecolor");
  assert.equal(resolveColorMode({ TERM: "xterm-256color" }), "ansi256");
});

test("fullscreen header adapts at 80, 100, 120 and 160 columns", () => {
  for (const width of [80, 100, 120, 160]) {
    const lines = formatFullscreenHeader({ workspace: "C:/work/agent-cli", model: "qling-agent-1.0", ready: true, tokens: 12400, branch: "main" }, width);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].length, width);
    assert.match(lines.join("\n"), /轻灵 Qling/);
    assert.match(lines.join("\n"), /Ready/);
  }
});

test("fullscreen footer only advertises actions that stay keyboard-routable", () => {
  const compact = formatFullscreenFooterHints(false, 80);
  assert.match(compact, /Enter/);
  assert.match(compact, /Ctrl\+C/);
  assert.match(compact, /Shift\+Tab/);
  assert.match(compact, /Alt\+C/);
  assert.match(compact, /\/ 命令/);

  const selecting = formatFullscreenFooterHints(true, 80);
  assert.match(selecting, /拖选复制/);
  assert.match(selecting, /Alt\+C.*重复制/);
  assert.doesNotMatch(selecting, /返回|复制模式/);
  assert.match(selecting, /Enter/);
  assert.match(selecting, /Ctrl\+C/);

  const wide = formatFullscreenFooterHints(false, 160);
  for (const command of ["/help", "/clear", "/model", "/exit"]) {
    assert.match(wide, new RegExp(command.replace("/", "\\/")));
  }
});

test("fullscreen SGR mouse parser preserves keys and separates drag from wheel", () => {
  const parsed = consumeMouseInput(
    "\x1b[<0;4;3M\x1b[<32;8;4M\x1b[<0;8;4m\x1b[<64;9;5MZ",
    3
  );
  assert.equal(parsed.rest, "Z");
  assert.equal(parsed.lineDelta, 3);
  assert.deepEqual(parsed.events, [
    { kind: "down", column: 4, row: 3 },
    { kind: "drag", column: 8, row: 4 },
    { kind: "up", column: 8, row: 4 },
  ]);
});

test("fullscreen SGR mouse parser buffers fragmented reports without leaking them as keys", () => {
  const first = consumeMouseInput("typed\x1b[<32;8;");
  assert.equal(first.rest, "typed");
  assert.equal(first.pending, "\x1b[<32;8;");
  assert.deepEqual(first.events, []);

  const second = consumeMouseInput(first.pending + "4M!");
  assert.equal(second.rest, "!");
  assert.equal(second.pending, "");
  assert.deepEqual(second.events, [
    { kind: "drag", column: 8, row: 4 },
  ]);
});

test("fullscreen renderer reproduces six reference regions and restores terminal", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "qling-agent-1.0", ready: true, tokens: 12400, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 160, rows: 50 },
    { write: (chunk) => output.push(chunk), now: () => new Date("2026-07-30T04:40:05Z") }
  );
  renderer.start();
  renderer.appendUser("帮我分析这个项目结构");
  renderer.appendAssistant("好的，我会先扫描项目根目录。");
  renderer.appendTool("read", "package.json", "running");
  renderer.appendTool("read", "package.json", "success", 89, "src/\ntests/\nREADME.md");
  renderer.appendResult("项目采用模块化结构，核心代码位于 `src/`。");
  renderer.setInput("");
  const screen = renderer.snapshot().join("\n");
  assert.match(screen, /Workspace: agent-cli/);
  assert.match(screen, /You/);
  assert.match(screen, /轻灵/);
  assert.match(screen, /读取文件/);
  assert.match(screen, /分析完成/);
  assert.match(screen, /输入任务/);
  assert.equal(renderer.snapshot().length, 50);
  renderer.stop();
  assert.match(output.join(""), /\x1b\[\?1049h/);
  assert.match(output.join(""), /\x1b\[\?1049l/);
  assert.match(output.join(""), /\x1b\[\?1000h/);
  assert.match(output.join(""), /\x1b\[\?1006h/);
  assert.match(output.join(""), /\x1b\[\?1006l/);
  assert.match(output.join(""), /\x1b\[\?1000l/);
  assert.match(output.join(""), /\x1b\[\?25h/);
});

test("fullscreen renderer keeps mixed-width content inside the grid and honors NO_COLOR", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    {
      workspace: "C:/非常长的工作区/agent-cli",
      model: "qling-agent-超长模型名称",
      ready: true,
      tokens: 12_400,
      branch: "feature/中文-very-long-branch",
    },
    {
      stdinTTY: true,
      stdoutTTY: true,
      columns: 80,
      rows: 24,
      colorMode: "none",
    },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  renderer.appendUser("分析中文、Emoji 🧪 与 ANSI \u001b[31mred\u001b[0m");
  renderer.appendTool("shell", "npm run build -- --非常长的参数", "success", 1234);
  renderer.appendResult("| 名称 | 状态 |\n| --- | --- |\n| 轻灵 | 完成 |");
  const screen = renderer.snapshot();
  assert.equal(screen.length, 24);
  assert.ok(screen.every((line) => !line.includes("\u001b[")));
  assert.doesNotMatch(output.join(""), /\x1b\[38;(?:2|5);/);
  renderer.stop();
});

test("fullscreen renderer maintains responsive character grids and updates streaming text in place", () => {
  for (const [columns, rows] of [[120, 30], [100, 28], [80, 24]]) {
    const renderer = new FullscreenRenderer(
      {
        workspace: "C:/work/agent-cli",
        model: "qling-agent-1.0",
        ready: true,
        tokens: 12_400,
        branch: "main",
      },
      { stdinTTY: true, stdoutTTY: true, columns, rows, colorMode: "none" },
      { write: () => {} }
    );
    renderer.streamAssistant("正在");
    renderer.streamAssistant("正在流式回答");
    renderer.completeAssistant("流式回答完成");
    renderer.appendTool("read", "src/中文路径/file.ts", "success", 89);
    renderer.appendResult("结果包含中文、Markdown 和 `code`。");
    const screen = renderer.snapshot();
    assert.equal(screen.length, rows);
    assert.ok(screen.every((line) => stringWidth(line) <= columns));
    assert.equal(screen.join("\n").match(/流式回答完成/g)?.length, 1);
    assert.doesNotMatch(screen.join("\n"), /正在流式回答/);
    assert.match(screen.join("\n"), /输入任务/);
  }
});

test("fullscreen renderer aligns the cursor, scrolls upward, shows mode and preserves wait duration", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    {
      workspace: "agent-cli",
      model: "qling-agent-1.0",
      ready: true,
      tokens: 0,
      branch: "main",
      sessionMode: "agent",
      permissionMode: "ask",
    },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  renderer.setInput("轻灵abc", undefined, 2);
  const cursorMoves = [...output.join("").matchAll(/\x1b\[(\d+);(\d+)H\x1b\[\?25h/g)];
  assert.equal(Number(cursorMoves.at(-1)?.[2]), 9);

  for (let index = 0; index < 30; index++) renderer.appendNotice(`历史 ${index}`);
  renderer.scrollPages(1);
  assert.match(renderer.snapshot().join("\n"), /已离开底部/);

  renderer.scrollEnd();
  renderer.updateChrome({ sessionMode: "plan", permissionMode: "ask" });
  renderer.setProgress("模型响应", 1250);
  const screen = renderer.snapshot().join("\n");
  assert.match(screen, /Ready · Plan/);
  assert.match(screen, /等待 1\.3s/);
  renderer.updateChrome({ sessionMode: "agent", permissionMode: "allow" });
  assert.match(renderer.snapshot().join("\n"), /Ready · Auto/);
  renderer.stop();
});

test("fullscreen mouse wheel scrolls in small batched steps without repainting fixed chrome", () => {
  const parsed = consumeMouseWheel(
    "\x1b[<64;10;5M\x1b[<64;10;5m\x1b[<64;10;5Mtyped"
  );
  assert.equal(parsed.lineDelta, 6);
  assert.equal(parsed.rest, "typed");

  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  for (let index = 0; index < 40; index++) renderer.appendNotice(`历史 ${index}`);
  output.length = 0;

  renderer.scrollLines(3);
  assert.match(renderer.snapshot().join("\n"), /已离开底部 · 3 行/);
  const writes = output.join("");
  assert.doesNotMatch(writes, /\x1b\[(?:1|2|21|23|24);1H\x1b\[2K/);

  renderer.scrollLines(-1);
  assert.match(renderer.snapshot().join("\n"), /已离开底部 · 2 行/);

  renderer.scrollLines(999);
  const atTop = renderer.snapshot().join("\n");
  assert.match(atTop, /历史 0/);
  const topOffset = Number(atTop.match(/已离开底部 · (\d+) 行/)?.[1]);
  renderer.scrollLines(-3);
  const afterDown = renderer.snapshot().join("\n");
  const downOffset = Number(afterDown.match(/已离开底部 · (\d+) 行/)?.[1]);
  assert.equal(downOffset, topOffset - 3);
  renderer.stop();
});

test("fullscreen mode changes recolor the input frame and preserve the actual model name", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    {
      workspace: "agent-cli",
      model: "initial-model",
      ready: true,
      tokens: 0,
      branch: "main",
      sessionMode: "agent",
      permissionMode: "ask",
    },
    { stdinTTY: true, stdoutTTY: true, columns: 120, rows: 30, colorMode: "truecolor" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  output.length = 0;
  renderer.updateChrome({ model: "active-model", sessionMode: "plan", permissionMode: "ask" });
  assert.match(renderer.snapshot().join("\n"), /Model: active-model/);
  assert.match(output.join(""), /\x1b\[38;2;56;189;248m/);

  output.length = 0;
  renderer.updateChrome({ sessionMode: "agent", permissionMode: "allow" });
  assert.match(output.join(""), /\x1b\[38;2;251;191;36m/);
  renderer.stop();
});

test("fullscreen result box uses exact character-grid borders", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: () => {} }
  );
  renderer.appendResult("中文结果与 `src/` 路径");
  const screen = renderer.snapshot();
  const top = screen.find((line) => line.startsWith("╭"));
  const bottom = screen.find((line) => line.startsWith("╰"));
  assert.equal(top, `╭${"─".repeat(78)}╮`);
  assert.equal(bottom, `╰${"─".repeat(78)}╯`);
  assert.ok(screen.every((line) => stringWidth(line) <= 80));
});

test("fullscreen updates repair fixed chrome and expose slash input and output", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  output.length = 0;
  renderer.updateChrome({ ready: false });
  renderer.setInput("/model", undefined, 6);
  renderer.setTransientOutput("可用模型\n- active-model");
  const writes = output.join("");
  assert.match(writes, /\x1b\[1;1H/);
  assert.match(writes, /\x1b\[2;1H/);
  assert.match(writes, /\x1b\[21;1H/);
  assert.match(writes, /\x1b\[24;1H/);
  assert.match(renderer.snapshot().join("\n"), /\/model/);
  assert.match(renderer.snapshot().join("\n"), /可用模型/);
  renderer.stop();
});

test("fullscreen repeated slash output does not repaint the input frame", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  renderer.setTransientOutput("第一行", { value: "", cursorIndex: 0 });
  output.length = 0;
  renderer.setTransientOutput("第一行\n第二行", { value: "", cursorIndex: 0 });
  assert.doesNotMatch(output.join(""), /\x1b\[(?:21|22|23|24);1H\x1b\[2K/);
  renderer.stop();
});

test("fullscreen long-task progress does not repaint fixed chrome", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: false, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  output.length = 0;
  renderer.setProgress("agent", 5_000);
  const writes = output.join("");
  assert.doesNotMatch(writes, /\x1b\[1;1H\x1b\[2K/);
  assert.doesNotMatch(writes, /\x1b\[2;1H\x1b\[2K/);
  assert.doesNotMatch(writes, /\x1b\[21;1H\x1b\[2K/);
  assert.doesNotMatch(writes, /\x1b\[24;1H\x1b\[2K/);
  assert.match(renderer.snapshot().join("\n"), /等待 5s/);
  renderer.stop();
});

test("fullscreen drag selection copies in-app without disabling keys or mouse capture", async () => {
  const output = [];
  const copied = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    {
      write: (chunk) => output.push(chunk),
      writeClipboard: async (value) => copied.push(value),
    }
  );
  renderer.start();
  renderer.appendNotice("alpha beta");
  assert.match(output.join(""), /\x1b\[\?1002h/);

  renderer.handleMouse({ kind: "down", column: 1, row: 3 });
  renderer.handleMouse({ kind: "drag", column: 5, row: 3 });
  output.length = 0;
  renderer.handleMouse({ kind: "up", column: 5, row: 3 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(copied, ["alpha"]);
  assert.equal(renderer.getSelectedText(), "alpha");
  assert.equal(renderer.selectionAnchor, null);
  assert.equal(renderer.selectionHead, null);
  assert.equal(renderer.selectionMoved, false);
  assert.doesNotMatch(
    output.join(""),
    /\x1b\[7m/,
    "mouse release must clear the visible selection highlight"
  );
  assert.match(
    output.join(""),
    /alpha/,
    "mouse release must repaint the selected row without inverse video"
  );
  assert.match(renderer.snapshot().join("\n"), /已复制 · 5 字符/);

  renderer.copySelection();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, ["alpha", "alpha"]);

  renderer.stop();
  assert.match(output.join(""), /\x1b\[\?1002l/);
});

test("fullscreen selection preserves logical whitespace and highlights truncated lines", async () => {
  const copied = [];
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "truecolor" },
    {
      write: (chunk) => output.push(chunk),
      writeClipboard: async (value) => copied.push(value),
    }
  );
  renderer.start();
  renderer.appendNotice(`${"x".repeat(90)}  \n\nnext`);
  output.length = 0;

  renderer.handleMouse({ kind: "down", column: 78, row: 3 });
  renderer.handleMouse({ kind: "drag", column: 4, row: 5 });
  renderer.handleMouse({ kind: "up", column: 4, row: 5 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(copied[0], /\s\s\n\nnext$/);
  assert.match(output.join(""), /\x1b\[7m/);
  renderer.stop();
});

test("fullscreen logical selection spans CJK lines and keeps fixed keys visible", async () => {
  const copied = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: () => {}, writeClipboard: async (value) => copied.push(value) }
  );
  renderer.start();
  renderer.appendNotice("轻灵 alpha\n第二行");

  renderer.handleMouse({ kind: "down", column: 1, row: 3 });
  renderer.handleMouse({ kind: "drag", column: 80, row: 4 });
  renderer.handleMouse({ kind: "up", column: 80, row: 4 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(copied[0], "轻灵 alpha\n第二行");
  const screen = renderer.snapshot().join("\n");
  assert.match(screen, /Enter\s*发送/);
  assert.match(screen, /Shift\+Tab/);
  assert.match(screen, /\/ 命令/);
  renderer.stop();
});

test("fullscreen selection reapplies inverse highlight after ANSI-colored paths", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "truecolor" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  renderer.appendAssistant("路径 `C:\\repo\\src\\index.ts` 已更新");
  output.length = 0;

  renderer.handleMouse({ kind: "down", column: 1, row: 4 });
  renderer.handleMouse({ kind: "drag", column: 50, row: 4 });
  const rendered = output.join("");

  assert.match(rendered, /\x1b\[(?:0|27|39)m\x1b\[7m/, "ANSI resets inside the path must restore selection highlight");
  renderer.stop();
});

test("fullscreen clearConversationView removes entries and transient output in one reset", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: () => {} }
  );
  renderer.start();
  renderer.appendNotice("old conversation");
  renderer.setTransientOutput("old slash output");
  renderer.setProgress("old task", 5_000);

  renderer.clearConversationView();
  const screen = renderer.snapshot().join("\n");

  assert.doesNotMatch(screen, /old conversation|old slash output|old task/);
  assert.match(screen, /输入任务/);
  renderer.stop();
});
