import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";

import { StreamUI } from "../../dist/tui/streaming-tui.js";

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

async function withCapturedStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = function write(chunk, encoding, cb) {
    output += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof cb === "function") cb();
    return true;
  };
  try {
    await fn(() => output);
  } finally {
    process.stdout.write = originalWrite;
  }
}

function createUi(now = () => 1_000) {
  const ui = new StreamUI("test-model", 0, { now });
  const submitted = [];
  ui.onInput(async (cmd) => {
    submitted.push(cmd);
  });
  return { ui, submitted };
}

async function withCapturedStdinDataHandler(fn) {
  const originalOn = process.stdin.on;
  const originalOff = process.stdin.off;
  const originalResume = process.stdin.resume;
  const originalPause = process.stdin.pause;
  const originalSetEncoding = process.stdin.setEncoding;
  const originalSetRawMode = process.stdin.setRawMode;
  let dataHandler = null;

  process.stdin.on = function on(event, handler) {
    if (event === "data") dataHandler = handler;
    return process.stdin;
  };
  process.stdin.off = function off() {
    return process.stdin;
  };
  process.stdin.resume = function resume() {
    return process.stdin;
  };
  process.stdin.pause = function pause() {
    return process.stdin;
  };
  process.stdin.setEncoding = function setEncoding() {
    return process.stdin;
  };
  process.stdin.setRawMode = function setRawMode() {
    return process.stdin;
  };

  try {
    await fn(() => dataHandler);
  } finally {
    process.stdin.on = originalOn;
    process.stdin.off = originalOff;
    process.stdin.resume = originalResume;
    process.stdin.pause = originalPause;
    process.stdin.setEncoding = originalSetEncoding;
    process.stdin.setRawMode = originalSetRawMode;
  }
}

test("stream ui ctrl+c clears non-empty input with local restore hint", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.input.insertChar("h");
    ui.input.insertChar("i");
    ui.handleCtrlC();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /Ctrl\+Z/);
    assert.match(getOutput(), /恢复|草稿/);
  });
});

test("stream ui recovery action bar intercepts R only while paused and input is empty", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getHandler) => {
      const { ui, submitted } = createUi();
      ui.start();
      ui.setRecoveryState({
        runId: "run_1", sessionId: "session_1", originalTask: "fix", status: "paused",
        strategyAttempts: 2, remainingStrategyAttempts: 2,
        lastFailure: { category: "no_progress", message: "same failure", fingerprint: "fp_1" },
      });
      getHandler()("r");
      await new Promise((resolve) => setImmediate(resolve));
      ui.stop();

      assert.deepEqual(submitted, ["/recover retry"]);
      assert.match(getOutput(), /执行已暂停/);
      assert.match(getOutput(), /下一策略/);
    });
  });
});

test("stream ui ctrl+z restores draft cleared by ctrl+c", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    for (const ch of "draft prompt") ui.input.insertChar(ch);

    ui.handleCtrlC();
    assert.equal(ui.input.value, "");

    ui.handleCtrlZ();

    assert.equal(ui.input.value, "draft prompt");
    assert.equal(ui.input.cursorPos, "draft prompt".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /恢复|草稿/);
  });
});

test("stream ui ctrl+z without cleared draft prints local feedback", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.handleCtrlZ();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /没有可恢复|无可恢复|草稿/);
  });
});

test("stream ui ctrl+z does not overwrite non-empty input", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    for (const ch of "old draft") ui.input.insertChar(ch);
    ui.handleCtrlC();
    for (const ch of "new draft") ui.input.insertChar(ch);

    ui.handleCtrlZ();

    assert.equal(ui.input.value, "new draft");
    assert.equal(ui.input.cursorPos, "new draft".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /当前输入|不会覆盖|草稿/);
  });
});

test("stream ui first empty ctrl+c prints local exit hint without submitting", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.handleCtrlC();

    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /再次 Ctrl\+C 退出，或输入 exit/);
  });
});

test("stream ui second empty ctrl+c within window submits exit", async () => {
  let now = 1_000;
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi(() => now);

    ui.handleCtrlC();
    now += 1_500;
    ui.handleCtrlC();

    assert.deepEqual(submitted, ["exit"]);
  });
});

test("stream ui empty ctrl+c after timeout does not submit exit", async () => {
  let now = 1_000;
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi(() => now);

    ui.handleCtrlC();
    now += 2_500;
    ui.handleCtrlC();

    assert.deepEqual(submitted, []);
  });
});

test("stream ui ctrl+a and ctrl+e move cursor without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "abc") ui.input.insertChar(ch);
    ui.handleCtrlA();
    assert.equal(ui.input.cursorPos, 0);

    ui.handleCtrlE();
    assert.equal(ui.input.cursorPos, 3);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui ctrl+u and ctrl+k edit buffer without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "abcdef") ui.input.insertChar(ch);
    ui.input.moveLeft();
    ui.input.moveLeft();

    ui.handleCtrlU();
    assert.equal(ui.input.value, "ef");
    assert.equal(ui.input.cursorPos, 0);

    ui.input.insertChar("X");
    ui.handleCtrlK();
    assert.equal(ui.input.value, "X");
    assert.equal(ui.input.cursorPos, 1);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui ctrl+w deletes previous word without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "npm run build") ui.input.insertChar(ch);

    ui.handleCtrlW();

    assert.equal(ui.input.value, "npm run ");
    assert.equal(ui.input.cursorPos, "npm run ".length);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui alt+d deletes next word without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "npm run build") ui.input.insertChar(ch);
    ui.input.moveStart();
    for (let i = 0; i < "npm ".length; i++) ui.input.moveRight();

    ui.handleAltD();

    assert.equal(ui.input.value, "npm  build");
    assert.equal(ui.input.cursorPos, "npm ".length);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui delete key deletes next character without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "abc") ui.input.insertChar(ch);
    ui.input.moveStart();
    ui.input.moveRight();

    ui.handleDelete();

    assert.equal(ui.input.value, "ac");
    assert.equal(ui.input.cursorPos, 1);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui ctrl+l clears screen and redraws without losing input", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    ui.setStatusLine("model=test session=session-1");
    for (const ch of "draft prompt") ui.input.insertChar(ch);
    ui.input.moveLeft();
    ui.input.moveLeft();

    ui.handleCtrlL();

    assert.equal(ui.input.value, "draft prompt");
    assert.equal(ui.input.cursorPos, "draft prom".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /\x1b\[2J\x1b\[H/);
    assert.match(getOutput(), /轻灵 Qling v/);
    assert.match(getOutput(), /Workspace:/);
    assert.match(getOutput(), /Model: test-model/);
    assert.match(getOutput(), /Tokens:/);
    assert.match(getOutput(), /Git:/);
    const outputStr = getOutput();
    assert.match(outputStr, /› draft prompt/);
    assert.match(outputStr, /│/);
    // 输入框上方不再堆叠快捷键提示与 statusline（去噪）
    assert.doesNotMatch(getOutput(), /Enter 发送/);
    assert.doesNotMatch(getOutput(), /model=test session=session-1/);
    assert.doesNotMatch(getOutput(), /\/model 切换模型/);
    assert.match(getOutput(), /draft prompt/);
  });
});

test("stream ui prompt renders inside input frame without duplicate bare prompt", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();
    ui.setStatusLine("model=test session=session-1");

    ui.printInputBar();

    const output = getOutput();
    assert.match(output, /│ › 输入任务，或按 \/ 打开命令面板/);
    assert.match(output, /└─+┘/);
    assert.doesNotMatch(output, /\n(?:\x1b\[[0-9;]*m)*› (?:\x1b\[[0-9;]*m)*$/);
    // 输入框上方不再打印 statusline / 快捷键提示
    assert.doesNotMatch(output, /model=test session=session-1/);
    assert.doesNotMatch(output, /Enter 发送/);
    assert.doesNotMatch(output, /\/exit 退出/);
  });
});

test("stream ui redraw keeps complete input frame while typing", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    ui.printInputBar();
    ui.handleChar("你");

    const output = getOutput();
    assert.match(output, /│ › 你/);
    assert.match(output, /└─+┘/);
    assert.doesNotMatch(output.split("│ › 你").at(-1), /^\s*$/);
  });
});

test("stream ui input frame borders keep the same visual width as content rows", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    ui.printInputBar();
    const frameLines = stripAnsi(getOutput())
      .split("\n")
      .filter((line) => line.startsWith("┌") || line.startsWith("│") || line.startsWith("└"));
    const widths = frameLines.map((line) => stringWidth(line));

    assert.ok(widths.length >= 3);
    assert.equal(new Set(widths).size, 1, `frame widths drifted: ${widths.join(", ")}`);
  });
});

test("stream ui cursor returns to input content row instead of top border", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    ui.printInputBar();
    const output = getOutput();

    assert.match(output, /\x1b\[1A\x1b\[5G/);
    assert.doesNotMatch(output, /\x1b\[2A\x1b\[5G/);
  });
});

test("stream ui delete on empty input keeps cursor scoped without redrawing", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.printInputBar();
    ui.handleDelete();
    const output = getOutput();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, []);
    assert.doesNotMatch(output, /\x1b\[1A\r\x1b\[J/);
    assert.doesNotMatch(output, /\x1b\[2A\r\x1b\[J/);
  });
});

test("stream ui showPrompt renders one input frame top border", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    ui.running = true;
    ui.setStatusLine("model=test session=session-1");
    ui.showPrompt();

    const plain = stripAnsi(getOutput());
    const topBorderLines = plain
      .split("\n")
      .filter((line) => line.startsWith("┌"));

    assert.equal(topBorderLines.length, 1, `expected one input top border, got ${topBorderLines.length}`);
    // 输入框上方不再输出 statusline / 快捷键黑灰提示
    assert.doesNotMatch(plain, /model=test session=session-1/);
    assert.doesNotMatch(plain, /Enter 发送/);
  });
});

test("stream ui renders user, assistant, executing timeline, and completion blocks", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    ui.appendUserInput("帮我分析这个项目结构");
    ui.appendThinking("好的，我先扫描项目目录。");
    ui.appendToolStart("read", "cat package.json");
    ui.appendToolSuccess("read", "cat package.json", "{\"name\":\"qling\"}", 89);
    ui.appendFinal("项目采用模块化结构。");
    ui.appendDone(120);

    const output = getOutput();
    const plain = stripAnsi(output);
    assert.match(output, /You/);
    assert.match(output, /帮我分析这个项目结构/);
    assert.match(output, /轻灵/);
    assert.match(output, /正在执行/);
    assert.match(output, /读取文件/);
    assert.match(output, /package\.json/);
    assert.match(output, /89ms/);
    assert.match(plain, /结果/);
    assert.match(plain, /模块化结构/);
    assert.match(plain, /┌─\s*结果/);
    assert.match(plain, /任务完成/);
  });
});

test("stream ui startup renders concise first-run guidance card", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    ui.start();
    ui.stop();

    const output = getOutput();
    assert.doesNotMatch(output, /3 步开始/);
    assert.doesNotMatch(output, /常用入口/);
    assert.match(output, /轻灵 · 本地工作台/);
    assert.match(output, /│ › 输入任务，或按 \/ 打开命令面板/);
    assert.match(output, /└─+┘/);
  });
});

test("stream ui ctrl+o toggles future long tool output without submitting", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    for (const ch of "draft") ui.input.insertChar(ch);

    ui.handleCtrlO();

    assert.equal(ui.input.value, "draft");
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /展开后续工具输出/);
  });
});

test("stream ui tab on empty input opens local agents view command", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();

    ui.handleTab();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, ["/agents"]);
  });
});

test("stream ui shows slash completion hints while typing slash prefix", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.printInputBar();
    ui.handleChar("/");
    ui.handleChar("s");
    ui.handleChar("k");

    assert.equal(ui.input.value, "/sk");
    assert.deepEqual(submitted, []);
    const output = getOutput();
    assert.match(output, /\/skill/);
    assert.match(output, /Tab 补全|Tab/);
    assert.match(output, /skill|command|session|local/);
    assert.match(output, /└─+┘/);
  });
});

test("stream ui tab completes slash prefix to best command", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    for (const ch of "/sk") ui.input.insertChar(ch);

    ui.handleTab();

    assert.equal(ui.input.value, "/skill ");
    assert.equal(ui.input.cursorPos, "/skill ".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /\/skill/);
  });
});

test("stream ui slash panel supports down selection and tab acceptance", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();

    ui.handleChar("/");
    ui.handleHistoryDown();
    ui.handleTab();

    assert.notEqual(ui.input.value, "/help ");
    assert.match(ui.input.value, /^\/[\w-]+ $/);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui shows argument hint for slash command with trailing space", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();

    for (const ch of "/model ") ui.handleChar(ch);

    assert.match(getOutput(), /参数|Args|model|list|use/i);
    assert.match(getOutput(), /list|use|model/i);
  });
});

test("stream ui tab on non-empty input preserves draft with local feedback", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    for (const ch of "draft") ui.input.insertChar(ch);

    ui.handleTab();

    assert.equal(ui.input.value, "draft");
    assert.equal(ui.input.cursorPos, "draft".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /Tab/);
    assert.match(getOutput(), /agents|代理|补全|草稿/);
  });
});

test("stream ui dispatches tab from raw stdin without inserting tab", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\t");

      assert.equal(ui.input.value, "");
      assert.deepEqual(submitted, ["/agents"]);

      ui.running = false;
    });
  });
});

test("stream ui shift+tab cycles agent mode without changing draft", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "保留草稿") ui.input.insertChar(ch);

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[Z");

      assert.equal(ui.input.value, "保留草稿");
      assert.deepEqual(submitted, ["/mode cycle"]);
    });
  });
});

test("stream ui ctrl+o expands and collapses future long tool output", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();
    const longOutput = Array.from({ length: 15 }, (_, index) => `line-${index + 1}`).join("\n");

    ui.appendToolSuccess("bash", "long command", longOutput, 100);
    assert.match(getOutput(), /\.\.\. \+5 lines/);
    assert.match(getOutput(), /Ctrl\+O to expand/);

    ui.handleCtrlO();
    ui.appendToolSuccess("bash", "long command", longOutput, 100);
    assert.match(getOutput(), /line-9/);
    assert.doesNotMatch(getOutput().split("展开后续工具输出").at(-1), /\.\.\. \+5 lines/);

    ui.handleCtrlO();
    ui.appendToolSuccess("bash", "long command", longOutput, 100);
    assert.match(getOutput().split("折叠后续工具输出").at(-1), /\.\.\. \+5 lines/);
  });
});

test("stream ui dispatches ctrl+l from raw stdin without submitting", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "draft") ui.input.insertChar(ch);

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x0c");

      assert.equal(ui.input.value, "draft");
      assert.deepEqual(submitted, []);
      assert.match(getOutput(), /\x1b\[2J\x1b\[H/);

      ui.running = false;
    });
  });
});

test("stream ui dispatches ctrl+o from raw stdin without submitting", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "draft") ui.input.insertChar(ch);

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x0f");

      assert.equal(ui.input.value, "draft");
      assert.deepEqual(submitted, []);
      assert.match(getOutput(), /展开后续工具输出/);

      ui.running = false;
    });
  });
});

test("stream ui dispatches ctrl+z from raw stdin to restore cleared draft", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "draft") ui.input.insertChar(ch);
      ui.handleCtrlC();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1a");

      assert.equal(ui.input.value, "draft");
      assert.equal(ui.input.cursorPos, "draft".length);
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui bare escape does not pollute following input", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b");
      dataHandler("[");

      assert.equal(ui.input.value, "[");
      assert.equal(ui.input.cursorPos, 1);
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui home and end key handlers move cursor without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "abc") ui.input.insertChar(ch);

    ui.handleHome();
    assert.equal(ui.input.cursorPos, 0);

    ui.handleEnd();
    assert.equal(ui.input.cursorPos, 3);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui word navigation handlers move cursor without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "alpha beta gamma") ui.input.insertChar(ch);

    ui.handleWordLeft();
    assert.equal(ui.input.cursorPos, "alpha beta ".length);

    ui.handleWordLeft();
    assert.equal(ui.input.cursorPos, "alpha ".length);

    ui.handleWordRight();
    assert.equal(ui.input.cursorPos, "alpha beta ".length);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui line navigation handlers move cursor without submitting", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "alpha\nbeta gamma\nxy") ui.input.insertChar(ch);
    ui.input.moveStart();
    for (let i = 0; i < "alpha\nbeta ".length; i++) ui.input.moveRight();

    ui.handleLineUp();
    assert.equal(ui.input.cursorPos, "alpha".length);

    ui.handleLineDown();
    assert.equal(ui.input.cursorPos, "alpha\nbeta ".length);
    assert.deepEqual(submitted, []);
  });
});

test("stream ui dispatches home and end escape sequences", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "abc") ui.input.insertChar(ch);

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[H");
      assert.equal(ui.input.cursorPos, 0);

      dataHandler("\x1b[F");
      assert.equal(ui.input.cursorPos, 3);

      dataHandler("\x1b[1~");
      assert.equal(ui.input.cursorPos, 0);

      dataHandler("\x1b[4~");
      assert.equal(ui.input.cursorPos, 3);
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui dispatches word navigation escape sequences", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "alpha beta gamma") ui.input.insertChar(ch);

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1bb");
      assert.equal(ui.input.cursorPos, "alpha beta ".length);

      dataHandler("\x1b[1;5D");
      assert.equal(ui.input.cursorPos, "alpha ".length);

      dataHandler("\x1bf");
      assert.equal(ui.input.cursorPos, "alpha beta ".length);

      dataHandler("\x1b[1;3C");
      assert.equal(ui.input.cursorPos, "alpha beta gamma".length);
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui dispatches line navigation escape sequences", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "alpha\nbeta gamma\nxy") ui.input.insertChar(ch);
      ui.input.moveStart();
      for (let i = 0; i < "alpha\nbeta ".length; i++) ui.input.moveRight();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[1;3A");
      assert.equal(ui.input.cursorPos, "alpha".length);

      dataHandler("\x1b[1;5B");
      assert.equal(ui.input.cursorPos, "alpha\nbeta ".length);
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui dispatches alt+d and ctrl+delete escape sequences", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "alpha beta gamma") ui.input.insertChar(ch);
      ui.input.moveStart();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1bd");
      assert.equal(ui.input.value, " beta gamma");

      dataHandler("\x1b[3;5~");
      assert.equal(ui.input.value, "  gamma");
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui dispatches delete escape sequence", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      for (const ch of "abc") ui.input.insertChar(ch);
      ui.input.moveStart();
      ui.input.moveRight();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[3~");

      assert.equal(ui.input.value, "ac");
      assert.equal(ui.input.cursorPos, 1);
      assert.deepEqual(submitted, []);

      ui.running = false;
    });
  });
});

test("stream ui bracketed paste inserts multiline text without submitting", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[200~first line\r\nsecond line\x1b[201~");

      assert.equal(ui.input.value, "first line\nsecond line");
      assert.equal(ui.input.cursorPos, "first line\nsecond line".length);
      assert.deepEqual(submitted, []);
      const output = stripAnsi(getOutput());
      assert.match(output, /\[Pasted: 2 lines\]/);
      assert.doesNotMatch(output, /│ › first line/);
      assert.doesNotMatch(output, /│   second line/);

      ui.running = false;
    });
  });
});

test("stream ui bracketed paste submits only after explicit enter", async () => {
  await withCapturedStdout(async () => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[200~alpha\nbeta\x1b[201~");
      assert.deepEqual(submitted, []);

      dataHandler("\r");

      assert.deepEqual(submitted, ["alpha\nbeta"]);
      assert.equal(ui.input.value, "");

      ui.running = false;
    });
  });
});

test("stream ui compact pasted draft keeps cursor inside input row", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui } = createUi();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[200~alpha\nbeta\ncharlie\x1b[201~");

      const output = getOutput();
      assert.match(stripAnsi(output), /\[Pasted: 3 lines\]/);
      assert.match(output, /\x1b\[2A\x1b\[\d+G/);
      assert.doesNotMatch(output, /\x1b\[3A\x1b\[\d+G/);

      ui.running = false;
    });
  });
});

test("stream ui large multiline paste renders line count chip instead of pasted body", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      const pasted = Array.from({ length: 54 }, (_, index) => {
        return `line ${index + 1} ${"x".repeat(120)}`;
      }).join("\n");

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler(`\x1b[200~${pasted}\x1b[201~`);

      const output = stripAnsi(getOutput());
      assert.equal(Buffer.byteLength(pasted, "utf8") > 5 * 1024, true);
      assert.equal(ui.input.value, pasted);
      assert.deepEqual(submitted, []);
      assert.match(output, /\[Pasted: 54 lines\]/);
      assert.doesNotMatch(output, /│ › line 1/);
      assert.doesNotMatch(output, /│   line 54/);

      dataHandler("\r");
      assert.deepEqual(submitted, [pasted]);

      ui.running = false;
    });
  });
});

test("stream ui empty ctrl+c feedback does not clear above the input frame", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.printInputBar();
    ui.handleCtrlC();
    const output = getOutput();

    assert.deepEqual(submitted, []);
    assert.doesNotMatch(output, /\x1b\[J/);
    assert.match(stripAnsi(output), /再次 Ctrl\+C 退出/);
    assert.match(stripAnsi(output), /输入任务，或按 \/ 打开命令面板/);
  });
});

test("stream ui empty ctrl+d submits exit", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();

    ui.handleCtrlD();

    assert.deepEqual(submitted, ["exit"]);
  });
});

test("stream ui non-empty ctrl+d does not discard input or submit", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    for (const ch of "draft") ui.input.insertChar(ch);

    ui.handleCtrlD();

    assert.equal(ui.input.value, "draft");
    assert.equal(ui.input.cursorPos, "draft".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /草稿|非空输入|不会退出/);
  });
});

test("stream ui ctrl+r search miss prints local feedback and keeps draft", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    ui.setHistory(["npm run build", "npm test"]);
    for (const ch of "deploy") ui.input.insertChar(ch);
    ui.input.moveLeft();
    ui.input.moveLeft();

    ui.handleHistorySearch();

    assert.equal(ui.input.value, "deploy");
    assert.equal(ui.input.cursorPos, "depl".length);
    assert.deepEqual(submitted, []);
    assert.match(getOutput(), /无匹配历史|没有匹配/);
  });
});

test("stream ui non-bracketed paste of multiline text does not submit and handles newlines", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui, submitted } = createUi();
      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();

      dataHandler("line 1\nline 2\nline 3");

      assert.equal(ui.input.value, "line 1\nline 2\nline 3");
      assert.deepEqual(submitted, []);
      const output = stripAnsi(getOutput());
      assert.match(output, /\[Pasted: 3 lines\]/);
      assert.doesNotMatch(output, /│ › line 1/);
      assert.doesNotMatch(output, /│   line 2/);
      ui.running = false;
    });
  });
});

test("stream ui compact draft summarizes manual multiline input without losing submitted content", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();
    const longText = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7";
    for (const ch of longText) {
      if (ch === "\n") ui.input.insertNewline();
      else ui.input.insertChar(ch);
    }

    ui.input.cursorPos = 0;
    ui.writeInputValue();
    const output = getOutput();

    assert.match(stripAnsi(output), /\[Draft: 7 lines, \d+ B\]/);
    assert.doesNotMatch(stripAnsi(output), /▼ 更多内容/);
    assert.doesNotMatch(stripAnsi(output), /│ › line 1/);
    assert.doesNotMatch(stripAnsi(output), /│   line 5/);

    ui.input.moveEnd();
    ui.handleEnter();
    assert.deepEqual(submitted, [longText]);
  });
});

test("stream ui repeated delete on empty input keeps redraw scoped to one frame", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui, submitted } = createUi();

    ui.printInputBar();
    ui.handleDelete();
    ui.handleDelete();
    ui.handleDelete();
    const output = getOutput();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, []);
    assert.doesNotMatch(output, /\x1b\[2J/);
    assert.doesNotMatch(output, /\x1b\[[3-9]\d*A/);
    assert.doesNotMatch(output, /\x1b\[1A\r\x1b\[J/);
  });
});

test("stream ui ctrl+z restores compact draft metadata", async () => {
  await withCapturedStdout(async (getOutput) => {
    await withCapturedStdinDataHandler(async (getDataHandler) => {
      const { ui } = createUi();

      ui.running = true;
      ui.setupInput();
      const dataHandler = getDataHandler();
      assert.equal(typeof dataHandler, "function");

      dataHandler("\x1b[200~alpha\nbeta\x1b[201~");
      ui.handleCtrlC();
      ui.handleCtrlZ();

      assert.equal(ui.input.value, "alpha\nbeta");
      assert.match(stripAnsi(getOutput()), /\[Pasted: 2 lines\]/);

      ui.running = false;
    });
  });
});
