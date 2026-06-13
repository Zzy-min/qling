import test from "node:test";
import assert from "node:assert/strict";

import { StreamUI } from "../../dist/tui/streaming-tui.js";

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
    assert.match(getOutput(), /│ › draft prompt/);
    assert.match(getOutput(), /Enter 发送/);
    assert.match(getOutput(), /Ctrl\+C 中断/);
    assert.match(getOutput(), /\/model 切换模型/);
    assert.match(getOutput(), /model=test session=session-1/);
    assert.match(getOutput(), /draft prompt/);
  });
});

test("stream ui prompt renders inside input frame without duplicate bare prompt", async () => {
  await withCapturedStdout(async (getOutput) => {
    const { ui } = createUi();
    ui.setStatusLine("model=test session=session-1");

    ui.printInputBar();

    const output = getOutput();
    assert.match(output, /│ › 输入任务，\/help 查看命令/);
    assert.match(output, /└─+┘/);
    assert.doesNotMatch(output, /\n(?:\x1b\[[0-9;]*m)*› (?:\x1b\[[0-9;]*m)*$/);
    assert.match(output, /\/exit 退出/);
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
    assert.match(output, /You/);
    assert.match(output, /帮我分析这个项目结构/);
    assert.match(output, /轻灵/);
    assert.match(output, /正在执行/);
    assert.match(output, /读取文件/);
    assert.match(output, /package\.json/);
    assert.match(output, /89ms/);
    assert.match(output, /分析完成/);
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
  await withCapturedStdout(async () => {
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
