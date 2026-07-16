/**
 * G1 acceptance drive — shipped StreamUI public API only (no stdin races).
 */
import test from "node:test";
import assert from "node:assert/strict";
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
    await fn(
      () => output,
      () => {
        output = "";
      }
    );
  } finally {
    process.stdout.write = originalWrite;
  }
}

function createUi() {
  return new StreamUI("test-model", 0, { now: () => 1_000 });
}

test("g1 session picker open navigate confirm or dismiss", async () => {
  await withCapturedStdout(async (getOutput) => {
    const ui = createUi();
    const picked = [];
    ui.setSessionPickerHandlers({
      onRequestSessionList: () => {
        ui.showSessionPicker([
          {
            sessionId: "older-id",
            name: "older-session",
            updatedAt: "2026-07-01T00:00:00.000Z",
            turnCount: 1,
            messageCount: 2,
          },
          {
            sessionId: "newer-id",
            name: "newer-session",
            updatedAt: "2026-07-16T12:00:00.000Z",
            turnCount: 5,
            messageCount: 10,
            active: true,
          },
        ]);
      },
      onSessionPick: (id) => {
        picked.push(id);
      },
    });

    ui.start();
    try {
      ui.openSessionPicker();
      assert.equal(ui.isOverlayOpen(), true);
      assert.equal(ui.getOverlayKind(), "sessions");
      const plain = stripAnsi(getOutput());
      assert.match(plain, /newer-session/);
      assert.match(plain, /older-session/);

      ui.moveOverlay(1);
      ui.dispatchKey("\x1b[A");
      ui.confirmOverlay();
      assert.equal(ui.isOverlayOpen(), false);
      assert.equal(ui.getFocus(), "prompt");
      assert.equal(picked.length, 1);
      assert.ok(["newer-id", "older-id"].includes(picked[0]));

      ui.dispatchKey("\x1c");
      assert.equal(ui.isOverlayOpen(), true);
      ui.dispatchKey("\x1b");
      assert.equal(ui.isOverlayOpen(), false);
      assert.equal(ui.getFocus(), "prompt");
    } finally {
      ui.stop();
    }
  });
});

test("g1 turn browse reecho and dismiss returns prompt", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    ui.start();
    try {
      ui.appendUserInput("turn-one-analyze-repo");
      ui.appendUserInput("turn-two-fix-tui-focus");
      clear();

      ui.openTurnBrowser(0);
      assert.equal(ui.isOverlayOpen(), true);
      assert.equal(ui.getOverlayKind(), "turns");
      assert.equal(ui.getFocus(), "scrollback");
      let plain = stripAnsi(getOutput());
      assert.match(plain, /turn-one-analyze-repo/);
      assert.match(plain, /turn-two-fix-tui-focus/);

      clear();
      ui.confirmOverlay();
      assert.equal(ui.isOverlayOpen(), false);
      assert.equal(ui.getFocus(), "prompt");
      plain = stripAnsi(getOutput());
      assert.match(plain, /turn-two-fix-tui-focus|turn-one-analyze-repo/);

      ui.openTurnBrowser(0);
      ui.dispatchKey(" ");
      assert.equal(ui.isOverlayOpen(), false);
      assert.equal(ui.getFocus(), "prompt");
    } finally {
      ui.stop();
    }
  });
});

test("g1 dismiss restore leaves prompt focus", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    ui.start();
    try {
      ui.appendUserInput("hello-turn");
      ui.openTurnBrowser(0);
      assert.equal(ui.getFocus(), "scrollback");
      ui.dismissOverlay();
      assert.equal(ui.getFocus(), "prompt");
      assert.equal(ui.isOverlayOpen(), false);
      ui.dispatchKey("x");
      assert.equal(ui.getFocus(), "prompt");
      assert.equal(ui.isOverlayOpen(), false);
    } finally {
      ui.stop();
    }
  });
});

test("g1 empty tab with zero turns routes to agents", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    const submitted = [];
    ui.onInput(async (cmd) => {
      submitted.push(cmd);
    });
    ui.start();
    try {
      ui.dispatchKey("\t");
      assert.equal(ui.isOverlayOpen(), false);
      assert.deepEqual(submitted, ["/agents"]);
    } finally {
      ui.stop();
    }
  });
});

test("g1 exclusivity sessions replaces turns overlay", async () => {
  await withCapturedStdout(async (getOutput) => {
    const ui = createUi();
    ui.setSessionPickerHandlers({
      onRequestSessionList: () => {
        ui.showSessionPicker([
          {
            sessionId: "a",
            name: "session-A",
            updatedAt: "2026-07-16T00:00:00.000Z",
            turnCount: 0,
            messageCount: 0,
          },
        ]);
      },
      onSessionPick: () => {},
    });
    ui.start();
    try {
      ui.appendUserInput("t1");
      ui.openTurnBrowser(0);
      assert.equal(ui.getOverlayKind(), "turns");
      ui.openSessionPicker();
      assert.equal(ui.getOverlayKind(), "sessions");
      assert.match(stripAnsi(getOutput()), /session-A/);
      ui.dismissOverlay();
      assert.equal(ui.isOverlayOpen(), false);
    } finally {
      ui.stop();
    }
  });
});

test("g1 expand last uses real last tool blob", async () => {
  await withCapturedStdout(async (getOutput) => {
    const ui = createUi();
    ui.start();
    try {
      ui.appendToolSuccess("bash", "echo", "UNIQUE_TOOL_BLOB_G1\nline2\nline3", 5);
      assert.equal(ui.expandLastToolOutput(), true);
      assert.match(stripAnsi(getOutput()), /UNIQUE_TOOL_BLOB_G1/);
    } finally {
      ui.stop();
    }
  });
});

test("g1 tab with turns opens turn browse not agents", async () => {
  await withCapturedStdout(async () => {
    const ui = createUi();
    const submitted = [];
    ui.onInput(async (cmd) => submitted.push(cmd));
    ui.start();
    try {
      ui.appendUserInput("has-a-turn");
      ui.dispatchKey("\t");
      assert.equal(ui.getOverlayKind(), "turns");
      assert.equal(ui.getFocus(), "scrollback");
      assert.deepEqual(submitted, []);
      ui.dispatchKey("\t");
      assert.equal(ui.isOverlayOpen(), false);
      assert.equal(ui.getFocus(), "prompt");
    } finally {
      ui.stop();
    }
  });
});

test("g1 replaySessionMessages renders markdown tables", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    ui.start();
    try {
      clear();
      ui.replaySessionMessages(
        [
          { role: "user", content: "show table" },
          {
            role: "assistant",
            content:
              "结果如下：\n\n| 名称 | 数值 |\n| --- | --- |\n| TCL | 5.00 |\n| 涨跌 | -2.34% |\n",
          },
        ],
        { label: "已载入会话内容: table-demo" }
      );
      const plain = stripAnsi(getOutput());
      assert.match(plain, /table-demo|show table/);
      // 渲染后的表格框线，而非原始 markdown 分隔行裸奔
      assert.match(plain, /[┌├└].*[┬┼┴]/);
      assert.match(plain, /TCL/);
      assert.match(plain, /5\.00/);
      assert.doesNotMatch(plain, /\|\s*---\s*\|/);
    } finally {
      ui.stop();
    }
  });
});

test("g1 replaySessionMessages paints user/assistant and rebuilds turn browse", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    ui.start();
    try {
      clear();
      ui.replaySessionMessages(
        [
          { role: "system", content: "hidden-system" },
          { role: "user", content: "hello-from-history" },
          { role: "assistant", content: "reply-from-history" },
          { role: "tool", content: "tool-noise" },
          {
            role: "user",
            content: "Token 预算即将耗尽（剩余 10%），请精简回复，减少工具调用频率。",
          },
          { role: "assistant", content: "", tool_calls: [{ function: { name: "bash" } }] },
          { role: "user", content: "second-user-turn" },
          { role: "assistant", content: "second-assistant-turn" },
        ],
        {
          label: "已载入会话内容: demo",
          statusLine: "● pass  已切换会话: demo",
        }
      );
      const plain = stripAnsi(getOutput());
      assert.match(plain, /已载入会话内容: demo/);
      assert.match(plain, /hello-from-history/);
      assert.match(plain, /reply-from-history/);
      assert.match(plain, /second-user-turn/);
      assert.match(plain, /● pass\s+已切换会话: demo/);
      assert.doesNotMatch(plain, /hidden-system/);
      assert.doesNotMatch(plain, /tool-noise/);
      assert.doesNotMatch(plain, /Token 预算即将耗尽/);
      // 输入框只应在回放末尾出现一次（不叠 status 后再画一份）
      const frames = plain.match(/输入任务，或按 \/ 打开命令面板/g) || [];
      assert.ok(frames.length <= 1, `expected at most 1 input placeholder, got ${frames.length}`);

      clear();
      ui.openTurnBrowser(0);
      assert.equal(ui.getOverlayKind(), "turns");
      assert.match(stripAnsi(getOutput()), /second-user-turn|hello-from-history/);
    } finally {
      ui.stop();
    }
  });
});

test("g1 appendValidation leaves input frame intact below message", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    ui.start();
    try {
      clear();
      ui.appendValidation("pass", "已切换会话: demo-session");
      const out = getOutput();
      const plain = stripAnsi(out);
      assert.match(plain, /已切换会话: demo-session/);
      // 反馈后应重绘输入框，而不是把文字写进底边框
      assert.match(plain, /输入任务|›/);
      // moveAfter + 换行再写消息（不应只有裸 \n + 消息盖在框上）
      assert.match(out, /\x1b\[\d+B|\n●|\n.*pass/i);
    } finally {
      ui.stop();
    }
  });
});

test("g1 mode cycle handler redraws input in place without submit", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    let cycles = 0;
    ui.setModeCycleHandler(() => {
      cycles += 1;
      ui.applySessionChrome({ sessionMode: "plan", permissionMode: "ask" });
    });
    ui.start();
    try {
      clear();
      // 模拟 Shift+Tab：不离开输入框
      ui.dispatchKey("\x1b[Z");
      assert.equal(cycles, 1);
      const plain = stripAnsi(getOutput());
      // 应看到 plan 角标/能力底栏重绘，而不是 › Mode: 文本行
      assert.match(plain, /plan/i);
      assert.match(plain, /规划|计划|bash/i);
      assert.doesNotMatch(plain, /Mode:\s*PLAN\s+Perm/);
    } finally {
      ui.stop();
    }
  });
});

test("g1 stream mode does not repaint input on each validation during task", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    ui.start();
    try {
      // 模拟提交后进入流式区
      ui.dispatchKey("h");
      ui.dispatchKey("i");
      clear();
      ui.dispatchKey("\r");
      // Enter 后会回调 onInput；未挂回调时至少 prompt 应已 detach
      // 直接走 append 链（模拟 agent 事件）
      ui.appendState("idle", "thinking");
      ui.appendValidation("pass", "执行阶段: run · started");
      ui.appendToolStart("bash", "echo 1");
      ui.appendValidation("pass", "执行阶段: tool · ok");
      ui.appendToolSuccess("bash", "echo 1", "ok", 3);
      ui.appendFinal("done-result");
      ui.appendDone(12);
      const plain = stripAnsi(getOutput());
      assert.match(plain, /done-result|结果/);
      // 任务过程中不应反复出现占位输入框
      const placeholders = plain.match(/输入任务，或按 \/ 打开命令面板/g) || [];
      assert.equal(
        placeholders.length,
        0,
        `stream phase must not repaint placeholder input, got ${placeholders.length}`
      );
      // 结束后一次 showPrompt
      clear();
      ui.showPrompt();
      assert.match(stripAnsi(getOutput()), /输入任务|›/);
    } finally {
      ui.stop();
    }
  });
});

test("g1 session picker navigate emits in-place erase not append-only stack", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = createUi();
    const items = Array.from({ length: 12 }, (_, i) => ({
      sessionId: `id-${i}`,
      name: `session-${i}`,
      updatedAt: `2026-07-${String(16 - (i % 15)).padStart(2, "0")}T00:00:00.000Z`,
      turnCount: i,
      messageCount: i * 2,
      active: i === 0,
    }));
    ui.setSessionPickerHandlers({
      onRequestSessionList: () => ui.showSessionPicker(items),
      onSessionPick: () => {},
    });
    ui.start();
    try {
      ui.openSessionPicker();
      assert.equal(ui.isOverlayOpen(), true);
      clear();

      // 多次 ↑/↓：每次重绘前必须有 CUU+\x1b[J（原地擦除），否则真终端会叠层
      for (let i = 0; i < 6; i++) {
        ui.moveOverlay(1);
      }
      const out = getOutput();
      const eraseOps = out.match(/\x1b\[\d+A\r\x1b\[J/g) || [];
      assert.ok(
        eraseOps.length >= 6,
        `expected >=6 in-place erases on navigate, got ${eraseOps.length}`
      );
      // 选择下标应环绕/移动，而不是卡死
      assert.ok(ui.getOverlaySelectedIndex() >= 0);
      assert.equal(ui.getOverlayKind(), "sessions");
    } finally {
      ui.stop();
    }
  });
});
