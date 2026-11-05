import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { setTheme } from "../../dist/tui/theme.js";

import {
  coalesceMouseEvents,
  consumeMouseInput,
  consumeMouseWheel,
  FullscreenRenderer,
  formatFullscreenFooterHints,
  formatFullscreenHeader,
  paintFullscreenFooter,
  paintFullscreenHeader,
  parseTuiMode,
  resolveColorMode,
  resolveIconMode,
  resolveTuiMode,
  rgbToAnsi16Code,
  rgbToAnsi256,
  wrapFullscreenInput,
} from "../../dist/tui/fullscreen.js";
import { StreamUI } from "../../dist/tui/streaming-tui.js";
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
  assert.equal(resolveColorMode({ TERM: "xterm" }), "ansi16");
  assert.equal(resolveColorMode({ TERM: "dumb" }), "none");
  assert.equal(resolveColorMode({ TERM: "xterm-kitty" }), "truecolor");
  assert.equal(resolveColorMode({}), "ansi256");
});

test("fullscreen header adapts at 80, 100, 120 and 160 columns", () => {
  for (const width of [80, 100, 120, 160]) {
    const lines = formatFullscreenHeader({ workspace: "C:/work/agent-cli", model: "qling-agent-1.0", ready: true, tokens: 12400, branch: "main" }, width);
    assert.equal(lines.length, 2);
    assert.equal(lines[1].length, width);
    assert.ok(stringWidth(lines[0]) <= width);
    assert.match(lines.join("\n"), /轻灵 Qling/);
    assert.match(lines.join("\n"), /Ready/);
    assert.match(lines.join("\n"), /Model: qling-agent-1\.0/, `model must survive at ${width} columns`);
  }
  const narrow = formatFullscreenHeader({
    workspace: "C:/Users/Lenovo/projects/long-workspace-name",
    model: "very-long-model-name-that-must-truncate",
    ready: false,
    tokens: 0,
    branch: "feature/very-long-branch",
  }, 80).join("\n");
  assert.match(narrow, /Workspace: /);
  assert.match(narrow, /Model: /);
  assert.match(narrow, /Busy/);
  assert.ok(stringWidth(narrow.split("\n")[0]) <= 80);
});

test("ansi256 mode picks the nearest xterm cube or grayscale entry", () => {
  assert.equal(rgbToAnsi256(0, 0, 0), 16);
  assert.equal(rgbToAnsi256(255, 255, 255), 231);
  assert.equal(rgbToAnsi256(255, 0, 0), 196);
  assert.equal(rgbToAnsi256(128, 128, 128), 244);
  assert.equal(rgbToAnsi256(135, 135, 135), 102);
  assert.equal(rgbToAnsi16Code(255, 255, 255), 97);
  assert.equal(rgbToAnsi16Code(128, 128, 128), 90);
  assert.equal(rgbToAnsi16Code(255, 0, 0), 91);
});

test("ansi16 renderer preserves palette roles across themes", () => {
  try {
    setTheme("bamboo");
    const bambooOutput = [];
    const bamboo = new FullscreenRenderer(
      { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
      { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "ansi16" },
      { write: (chunk) => bambooOutput.push(chunk) }
    );
    bamboo.start();
    bamboo.appendAssistant("16 色竹青");
    const bambooText = bambooOutput.join("");
    assert.match(bambooText, /\x1b\[92m/);
    assert.doesNotMatch(bambooText, /\x1b\[38;[25];/);

    setTheme("night");
    const nightOutput = [];
    const night = new FullscreenRenderer(
      { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
      { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "ansi16" },
      { write: (chunk) => nightOutput.push(chunk) }
    );
    night.start();
    night.appendAssistant("16 色夜间");
    const nightText = nightOutput.join("");
    assert.match(nightText, /\x1b\[96m/);
    assert.doesNotMatch(nightText, /\x1b\[92m/);
    assert.doesNotMatch(nightText, /\x1b\[38;[25];/);
  } finally {
    setTheme("bamboo");
  }
});

test("ansi256 renderer never leaks 24-bit foreground sequences", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "ansi256" },
    { write: (chunk) => output.push(chunk) }
  );
  renderer.start();
  renderer.appendAssistant("256 色输出");
  const text = output.join("");
  assert.match(text, /\x1b\[38;5;\d+m/);
  assert.doesNotMatch(text, /\x1b\[38;2;/);
});

test("fullscreen footer switches to overlay navigation while a panel owns input", () => {
  for (const width of [40, 48, 80, 96, 120]) {
    const line = formatFullscreenFooterHints(false, width, "20:26:23", true);
    assert.equal(stringWidth(line), width);
    assert.match(line, /Enter/, `${width}: confirm key must stay visible`);
    assert.match(line, /Esc/, `${width}: overlay must advertise its escape path`);
    assert.doesNotMatch(line, /发送|Alt\+C/, `${width}: input/copy hints are not active`);
    assert.equal((line.match(/│/g) ?? []).length, 2);
  }
  assert.match(formatFullscreenFooterHints(false, 120, "20:26:23", true), /浮层导航/);
  assert.match(formatFullscreenFooterHints(false, 80, "20:26:23", true), /PgUp\/PgDn/);
});

test("fullscreen footer colors its three zones without changing their layout", () => {
  const plain = formatFullscreenFooterHints(false, 80, "20:26:23");
  const painted = paintFullscreenFooter(plain, false);
  assert.equal(stringWidth(painted), 80);
  assert.match(painted, /\x1b\[38;2;166;234;185m/, "input/action zone uses secondary");
  assert.match(painted, /\x1b\[38;2;216;163;193m/, "selection zone uses magenta");
  assert.match(painted, /\x1b\[38;2;143;188;163m/, "command zone uses tool color");
  assert.match(painted, /\x1b\[38;2;102;213;139m│/, "zone separators use primary");
  const overlay = paintFullscreenFooter(
    formatFullscreenFooterHints(false, 80, "20:26:23", true),
    true
  );
  assert.match(overlay, /\x1b\[38;2;231;182;95m/, "overlay mode promotes actions to warning");
});

test("fullscreen header paints the active UI mode with its mode accent", () => {
  const plan = paintFullscreenHeader(formatFullscreenHeader({
    workspace: "agent-cli",
    model: "qling-agent-1.0",
    ready: true,
    tokens: 100,
    branch: "main",
    sessionMode: "plan",
    permissionMode: "ask",
  }, 120)[0], "plan");
  assert.match(plan, /\x1b\[38;2;56;189;248mPlan\x1b\[0m/);

  const auto = paintFullscreenHeader(formatFullscreenHeader({
    workspace: "agent-cli",
    model: "qling-agent-1.0",
    ready: true,
    tokens: 100,
    branch: "main",
    sessionMode: "default",
    permissionMode: "allow",
  }, 120)[0], "auto");
  assert.match(auto, /\x1b\[38;2;251;191;36mAuto\x1b\[0m/);
});

test("fullscreen footer separates input, selection, and command zones", () => {
  const compact = formatFullscreenFooterHints(false, 80);
  assert.equal(stringWidth(compact), 80);
  assert.match(compact, /^Enter 发送/);
  assert.match(compact, /Shift\+Tab 模式/);
  assert.match(compact, /Ctrl\+C 中断/);
  assert.match(compact, /Alt\+C 复制/);
  assert.match(compact, /\/ 命令/);
  assert.match(compact, /00:00:00$/);
  assert.equal((compact.match(/│/g) ?? []).length, 2);
  assert.ok(compact.indexOf("Alt+C") > 30, "selection group must not hug the input group");
  assert.ok(compact.indexOf("/ 命令") > 50, "command group must sit on the right");

  const narrow = formatFullscreenFooterHints(false, 40, "20:26:23");
  assert.equal(stringWidth(narrow), 40);
  assert.match(narrow, /^Enter /);
  assert.match(narrow, /20:26:23$/);
  assert.equal((narrow.match(/│/g) ?? []).length, 2);
  assert.doesNotMatch(narrow, /…/);

  const selecting = formatFullscreenFooterHints(true, 80);
  assert.equal(stringWidth(selecting), 80);
  assert.match(selecting, /已选文本/);
  assert.match(selecting, /Alt\+C.*复制/);
  assert.doesNotMatch(selecting, /返回|复制模式/);
  assert.match(selecting, /Enter/);
  assert.match(selecting, /Ctrl\+C/);

  const wide = formatFullscreenFooterHints(false, 160);
  assert.equal(stringWidth(wide), 160);
  for (const command of ["/help", "/clear", "/model", "/exit"]) {
    assert.match(wide, new RegExp(command.replace("/", "\\/")));
  }

  const medium = formatFullscreenFooterHints(false, 120);
  assert.equal(stringWidth(medium), 120);
  for (const command of ["/help", "/clear", "/model", "/exit"]) {
    assert.match(medium, new RegExp(command.replace("/", "\\/")));
  }
  assert.ok(stringWidth(medium.slice(0, medium.indexOf("/help"))) > 80);
});

test("empty fullscreen content area stays blank until the first entry", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 100, rows: 30, colorMode: "none" },
    { write: () => {} }
  );
  const screen = renderer.snapshot();
  const text = screen.join("\n");
  assert.doesNotMatch(text, /本地优先的 Agent 工作台/);
  assert.doesNotMatch(text, /\/mission/);
  assert.equal(screen.filter((line) => line.trim() === "").length, 24);
  renderer.appendNotice("开始执行");
  assert.match(renderer.snapshot().join("\n"), /开始执行/);
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

test("fullscreen SGR mouse parser emits hover moves for 1003 reporting", () => {
  const parsed = consumeMouseInput("\x1b[<35;12;7M", 3);
  assert.equal(parsed.rest, "");
  assert.deepEqual(parsed.events, [
    { kind: "move", column: 12, row: 7 },
  ]);
});

test("fullscreen maps visible body rows back to overlay lines", () => {
  const output = [];
  const renderer = new FullscreenRenderer(
    { workspace: "qling", model: "m", ready: true, tokens: 0, branch: "" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24 },
    { write: (chunk) => output.push(chunk), now: () => new Date(0) }
  );
  renderer.start();
  try {
    renderer.setOverlay(["╭─ test ─╮", "│ row │", "╰─ test ─╯"]);
    let mapped = null;
    for (let row = 1; row <= 24; row++) {
      const line = renderer.overlayRowAt(row, 4);
      if (line === 1) {
        mapped = row;
        break;
      }
    }
    assert.ok(mapped, "expected a visible row for the second overlay line");
    assert.equal(renderer.overlayRowAt(mapped, 4), 1);
  } finally {
    renderer.stop();
  }
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
  assert.match(top, /╭─.*分析完成.*╮$/);
  assert.equal(stringWidth(top), 80);
  assert.equal(bottom, `╰${"─".repeat(78)}╯`);
  assert.ok(screen.every((line) => stringWidth(line) <= 80));
});

test("running tool rows keep the command and status visible", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: () => {} }
  );
  renderer.appendTool("bash", "npm run build -- --long-argument", "running");
  const text = renderer.snapshot().join("\n");
  assert.match(text, /◌/);
  assert.match(text, /执行命令/);
  assert.match(text, /npm run build/);
  assert.match(text, /进行中/);
  assert.doesNotMatch(text, /│  *◌/);
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

test("fullscreen input wraps long text inside the box instead of clipping it", () => {
  const columns = 40;
  const rows = 24;
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns, rows, colorMode: "none" },
    { write: () => {} }
  );
  const text = "甲".repeat(60);
  renderer.setInput(text, undefined, text.length);
  const screen = renderer.snapshot();
  assert.equal(screen.length, rows);
  assert.ok(screen.every((line) => stringWidth(line) <= columns));
  const boxStart = screen.findIndex((line) => line.startsWith("╭"));
  const boxEnd = screen.findIndex((line, index) => index > boxStart && line.startsWith("╰"));
  assert.ok(boxStart > 0 && boxEnd > boxStart);
  const box = screen.slice(boxStart, boxEnd + 1).join("\n");
  assert.equal((box.match(/甲/g) ?? []).length, 60);
  assert.doesNotMatch(box, /…/);
  assert.ok(boxEnd - boxStart > 2);
  renderer.stop();
});

test("holding backspace coalesced in a single stdin chunk deletes backward without moving cursor right", () => {
  const ui = new StreamUI("qling-agent-1.0");
  ui.running = true;
  const output = [];
  ui.fullscreen = new FullscreenRenderer(
    { workspace: "agent-cli", model: "qling-agent-1.0", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    { write: (chunk) => output.push(chunk) }
  );
  ui.fullscreen.start();
  ui.setupInput();
  try {
    ui.dataHandler?.("abcdef");
    assert.equal(ui.input.value, "abcdef");
    assert.equal(ui.input.cursorPos, 6);

    output.length = 0;
    // Simulate key-repeat coalescing multiple DEL (\x7f) bytes in a single chunk
    ui.dataHandler?.("\x7f\x7f\x7f");
    assert.equal(ui.input.value, "abc");
    assert.equal(ui.input.cursorPos, 3);
    assert.doesNotMatch(ui.input.value, /\x7f/);

    // Simulate key-repeat coalescing BS (\x08) bytes and extra DEL bytes past empty
    ui.dataHandler?.("\x08\x08\x7f\x7f\x7f");
    assert.equal(ui.input.value, "");
    assert.equal(ui.input.cursorPos, 0);
    const cursorMoves = [...output.join("").matchAll(/\x1b\[(\d+);(\d+)H\x1b\[\?25h/g)];
    assert.equal(Number(cursorMoves.at(-1)?.[2]), 5);
  } finally {
    if (ui.dataHandler) process.stdin.removeListener("data", ui.dataHandler);
    if (ui.resizeHandler) process.stdout.removeListener("resize", ui.resizeHandler);
    process.stdin.pause();
    ui.fullscreen.stop();
  }
});

test("wrapFullscreenInput does not advance cursor column for zero-width or control characters", () => {
  const wrapped = wrapFullscreenInput("\x7f\x7f", 40, 2);
  assert.equal(wrapped.cursorCol, 0);
});

test("fullscreen mouse drag coalesces consecutive drag events, skips unchanged head redraws, and batches frame writes", () => {
  const events = coalesceMouseEvents([
    { kind: "down", column: 2, row: 3 },
    { kind: "drag", column: 4, row: 3 },
    { kind: "drag", column: 8, row: 3 },
    { kind: "drag", column: 12, row: 3 },
    { kind: "up", column: 12, row: 3 },
  ]);
  assert.deepEqual(events, [
    { kind: "down", column: 2, row: 3 },
    { kind: "drag", column: 12, row: 3 },
    { kind: "up", column: 12, row: 3 },
  ]);

  const writes = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "truecolor" },
    { write: (chunk) => writes.push(chunk) }
  );
  renderer.start();
  for (let i = 0; i < 40; i++) {
    renderer.appendAssistant(`第 ${i} 条消息包含 \`code_${i}\` 与说明文本`);
  }
  writes.length = 0;

  renderer.handleMouse({ kind: "down", column: 5, row: 5 });
  assert.equal(writes.length, 0, "mouse down without active selection does not trigger an extra redraw");

  renderer.handleMouse({ kind: "drag", column: 10, row: 5 });
  assert.equal(writes.length, 1, "moving selection head flushes the whole frame in a single batched write");

  // Repeat drag at the exact same cell: must be a no-op (0 writes)
  const changed = renderer.handleMouse({ kind: "drag", column: 10, row: 5 });
  assert.equal(changed, false);
  assert.equal(writes.length, 1, "unchanged drag head must not trigger a redraw");

  renderer.stop();
});

test("fullscreen scrollbar hover never scrolls; only press or drag does", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 60, rows: 12, colorMode: "none" },
    { write: () => {} }
  );
  renderer.start();
  renderer.appendNotice(
    Array.from({ length: 120 }, (_, index) => `history line ${index}`).join("\n")
  );
  const hit = renderer.scrollbarHit;
  assert.ok(hit, "long transcript must expose a scrollbar hit box");

  const before = renderer.scrollOffset;
  const middleRow = hit.firstRow + Math.floor(hit.trackCells / 2);
  const returned = renderer.handleMouse({
    kind: "move",
    column: hit.column,
    row: middleRow,
  });
  assert.equal(returned, false, "hovering the scrollbar must not be treated as a scroll");
  assert.equal(renderer.scrollOffset, before, "hover must not change scroll offset");

  renderer.handleMouse({ kind: "down", column: hit.column, row: middleRow });
  assert.notEqual(renderer.scrollOffset, before, "pressing the track must jump to that offset");
  const afterClick = renderer.scrollOffset;

  // 按下后若收到无按键 move，说明按键已释放但 up 丢失：取消拖动且不滚动。
  renderer.handleMouse({
    kind: "move",
    column: hit.column,
    row: hit.firstRow + hit.trackCells - 1,
  });
  assert.equal(renderer.scrollOffset, afterClick, "move after press must not keep scrolling");
  assert.equal(renderer.scrollbarDragging, false, "move must clear stale drag state");

  renderer.handleMouse({
    kind: "move",
    column: hit.column,
    row: hit.firstRow + hit.trackCells - 1,
  });
  assert.equal(renderer.scrollOffset, afterClick, "subsequent hover stays inert");

  renderer.stop();
});

test("fullscreen sanitizes tabs and pins the scrollbar to one absolute column", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 60, rows: 14, colorMode: "truecolor" },
    { write: () => {} }
  );
  renderer.start();
  renderer.appendNotice(
    ["○ normal", "○ ambiguous\tend", ...Array.from({ length: 40 }, (_, i) => `line ${i}`), "a\tb"].join("\n")
  );

  const lines = renderer.compose();
  const visibleWidth = (line) =>
    stringWidth(line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""));
  assert.ok(lines.every((line) => visibleWidth(line) === 60), "sanitized frame must keep every row 60 columns wide");
  assert.ok(lines.some((line) => line.includes("a    b")), "tabs must be expanded before measuring");
  assert.doesNotMatch(renderer.snapshot().join("\n"), /\t|\r/, "snapshot must not contain raw tab or CR");

  const railLines = lines.filter((line) => line.includes("\x1b[59G "));
  assert.ok(railLines.length > 0, "scrollbar track must use absolute column 59");
  assert.ok(railLines.some((line) => line.includes("█")), "scrollbar thumb must render on the rail");
  assert.ok(
    lines.filter((line) => line.includes("\x1b[58G") || line.includes("\x1b[60G")).length === 0,
    "rail must never drift to a neighbouring column"
  );

  renderer.stop();
});

test("fullscreen renderer preserves a stable non-overlapping grid across terminal sizes", () => {
  const widths = [40, 41, 60, 79, 80, 96, 100, 120, 160, 200];
  const heights = [8, 9, 12, 24, 30, 50];
  const clock = () => new Date("2026-11-01T20:26:23Z");
  for (const columns of widths) {
    for (const rows of heights) {
      const renderer = new FullscreenRenderer(
        {
          workspace: "C:/Users/Lenovo/projects/一个很长的工作区名称",
          model: "deepseek-v4-flash-very-long-model-name",
          ready: false,
          tokens: 1_234_567,
          branch: "feature/布局稳定性-very-long-branch",
          sessionMode: "plan",
          permissionMode: "ask",
        },
        { stdinTTY: true, stdoutTTY: true, columns, rows, colorMode: "none" },
        { write: () => {}, now: clock }
      );
      renderer.appendUser("请检查这个项目的布局稳定性：中文、ASCII、emoji 🧪 混排。\n第二行输入。");
      renderer.appendAssistant("第一段说明。\n\n第二段包含 `code`、[链接](https://example.com) 和很长的中文描述用于测试换行。");
      renderer.appendTool("bash", "npm run build -- --very-long-argument-without-spaces", "running");
      renderer.appendTool("read", "src/非常长的目录/文件名称.ts", "error", 1234, "错误一\n错误二\n错误三\n错误四\n错误五");
      renderer.appendThinking("检查布局约束和终端边界。", 1250);
      renderer.appendResult("最终结果包含中文、Markdown 和 `src/index.ts`。\n第二行结果。");
      renderer.setProgress("模型响应", 6000);
      renderer.setInput("很长的一行输入".repeat(12) + "\n第二行输入", undefined, 20);
      renderer.setOverlay(["── 布局浮层 ──", "abcdefghijklmnopqrstuvwxyz0123456789".repeat(4)]);

      const screen = renderer.snapshot();
      assert.equal(screen.length, rows, `${columns}x${rows} must render exactly ${rows} rows`);
      for (const line of screen) {
        assert.equal(
          stringWidth(line),
          columns,
          `${columns}x${rows} row width drifted: ${JSON.stringify(line)}`
        );
      }
      assert.equal(screen.filter((line) => line.includes("轻灵 Qling")).length, 1);
      assert.ok(screen.some((line) => line.includes("Enter")), "footer must be visible");
      assert.ok(screen.some((line) => line.includes("│")), "footer zones must remain separated");
      assert.ok(renderer.cursorRow >= 1 && renderer.cursorRow <= rows);
      assert.ok(renderer.cursorColumn >= 1 && renderer.cursorColumn <= columns);
    }
  }
});

test("fullscreen resize repairs every region and degrades below the minimum viewport", () => {
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 160, rows: 50, colorMode: "none" },
    { write: () => {}, now: () => new Date("2026-11-01T20:26:23Z") }
  );
  renderer.appendAssistant("resize content");
  renderer.setInput("draft", undefined, 5);
  assert.equal(renderer.snapshot().length, 50);

  renderer.resize({ stdinTTY: true, stdoutTTY: true, columns: 40, rows: 8, colorMode: "none" });
  let screen = renderer.snapshot();
  assert.equal(screen.length, 8);
  assert.ok(screen.every((line) => stringWidth(line) === 40));
  assert.equal(screen.filter((line) => line.includes("Enter")).length, 1);

  renderer.resize({ stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" });
  screen = renderer.snapshot();
  assert.equal(screen.length, 24);
  assert.ok(screen.every((line) => stringWidth(line) === 80));
  assert.equal(screen.filter((line) => line.includes("轻灵 Qling")).length, 1);
  assert.equal(screen.filter((line) => line.includes("Enter 发送")).length, 1);

  for (const [columns, rows] of [[20, 5], [39, 7]]) {
    renderer.resize({ stdinTTY: true, stdoutTTY: true, columns, rows, colorMode: "none" });
    const degraded = renderer.snapshot();
    assert.equal(degraded.length, rows);
    assert.ok(degraded.every((line) => stringWidth(line) === columns));
    assert.match(degraded[0], /终端.*过/);
    assert.doesNotMatch(degraded[0], /…$/);
  }
});

test("fullscreen presenter replays the full screen after coalesced frames", () => {
  let blocked = false;
  const frames = [];
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    {
      write: (chunk) => {
        frames.push(chunk);
        return !blocked;
      },
    }
  );
  renderer.start();
  blocked = true;
  renderer.appendNotice("first-line");
  renderer.appendNotice("second-line");
  assert.equal(renderer.getWriteWatermark().blocked, true);
  blocked = false;
  renderer.flushWriteQueue();

  const last = frames[frames.length - 1] ?? "";
  assert.match(last, /first-line/, "earlier coalesced line must not be lost");
  assert.match(last, /second-line/);
  renderer.stop();
});

test("fullscreen presenter coalesces frames while stdout is backpressured", () => {
  let writes = 0;
  const renderer = new FullscreenRenderer(
    { workspace: "agent-cli", model: "active-model", ready: true, tokens: 0, branch: "main" },
    { stdinTTY: true, stdoutTTY: true, columns: 80, rows: 24, colorMode: "none" },
    {
      write: () => {
        writes++;
        return false;
      },
    }
  );
  renderer.start();
  const before = writes;
  renderer.appendNotice("first");
  renderer.appendNotice("second");
  assert.equal(writes, before, "blocked terminal must not receive every frame");
  const watermark = renderer.getWriteWatermark();
  assert.equal(watermark.blocked, true);
  assert.ok(watermark.queuedFrames >= 2);

  renderer.flushWriteQueue();
  assert.ok(writes > before, "flush must deliver the latest coalesced frame");
  assert.ok(renderer.getWriteWatermark().writtenFrames >= 2);
  renderer.stop();
});
