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

test("stream ui ctrl+c clears non-empty input without submitting exit", async () => {
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();

    ui.input.insertChar("h");
    ui.input.insertChar("i");
    ui.handleCtrlC();

    assert.equal(ui.input.value, "");
    assert.deepEqual(submitted, []);
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
    assert.match(getOutput(), /轻灵 Agent CLI/);
    assert.match(getOutput(), /model=test session=session-1/);
    assert.match(getOutput(), /draft prompt/);
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
  await withCapturedStdout(async () => {
    const { ui, submitted } = createUi();
    for (const ch of "draft") ui.input.insertChar(ch);

    ui.handleCtrlD();

    assert.equal(ui.input.value, "draft");
    assert.equal(ui.input.cursorPos, "draft".length);
    assert.deepEqual(submitted, []);
  });
});
