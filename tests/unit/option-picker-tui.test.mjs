import test from "node:test";
import assert from "node:assert/strict";
import { StreamUI } from "../../dist/tui/streaming-tui.js";
import { openOptionPickerOrFallback } from "../../dist/tui/option-picker-helpers.js";
import { withDefaultWriters } from "../../dist/slash-context.js";
import { modelCommand } from "../../dist/commands/claude-style.js";
import { themeCommand } from "../../dist/commands/theme.js";
import { modeCommand } from "../../dist/commands/mode.js";

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

async function withCapturedStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, enc, cb) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof enc === "function") enc();
    else if (typeof cb === "function") cb();
    return true;
  };
  try {
    await fn(
      () => chunks.join(""),
      () => {
        chunks.length = 0;
      }
    );
  } finally {
    process.stdout.write = orig;
  }
}

async function withFullscreenTerminal(fn) {
  const properties = [
    [process.stdin, "isTTY", true],
    [process.stdout, "isTTY", true],
    [process.stdout, "columns", 80],
    [process.stdout, "rows", 24],
  ];
  const previous = properties.map(([target, key]) =>
    Object.getOwnPropertyDescriptor(target, key)
  );
  try {
    for (const [target, key, value] of properties) {
      Object.defineProperty(target, key, { configurable: true, value });
    }
    await fn();
  } finally {
    properties.forEach(([target, key], index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    });
  }
}

test("option picker opens after slash-style streamActive (Enter path)", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = new StreamUI("m", 0, {
      slashUi: {
        findSlashCompletion: () => [],
        resolveSlashCompletion: () => null,
        formatSlashCommandPanel: () => [
          "> /theme  [常用]  TUI 主题切换器",
          "提示    : ↑/↓ 选择 · Tab 补全 · Enter 执行当前输入",
        ],
        formatGroupedSlashPanel: () => [],
      },
    });
    ui.start();
    try {
      // 模拟输入 /theme 后 Enter：streamActive + 离开输入框
      ui.dispatchKey("/");
      ui.dispatchKey("t");
      ui.dispatchKey("h");
      ui.dispatchKey("e");
      ui.dispatchKey("m");
      ui.dispatchKey("e");
      clear();
      ui.dispatchKey("\r");
      // Enter 后 streamActive=true、promptLive=false；切换器必须仍能打开
      let picked = null;
      clear();
      ui.showOptionPicker({
        title: "主题切换 · Theme",
        items: [
          { id: "bamboo", label: "bamboo" },
          { id: "night", label: "night" },
        ],
        onPick: (item) => {
          picked = item.id;
        },
      });
      assert.equal(ui.getOverlayKind(), "options");
      const afterOpen = stripAnsi(getOutput());
      assert.match(afterOpen, /主题切换|Theme|bamboo|night/);
      // 打开切换器时应用了上移擦除（CSI A），不应只靠追加
      assert.match(getOutput(), /\x1b\[\d+A/);
      // showPrompt 在浮层打开时不得再叠空框
      clear();
      ui.showPrompt();
      assert.equal(ui.getOverlayKind(), "options");
      assert.doesNotMatch(stripAnsi(getOutput()), /输入任务/);
      ui.moveOverlay(1);
      clear();
      ui.confirmOverlay();
      assert.equal(picked, "night");
      assert.equal(ui.getOverlayKind(), null);
      // 确认后可用 notice 反馈（测试直接 appendNotice）
      clear();
      ui.appendNotice("🎨 主题 → night");
      const noticeOut = stripAnsi(getOutput());
      assert.match(noticeOut, /主题 → night/);
      assert.doesNotMatch(noticeOut, /›\s*🎨|›  主题/);
    } finally {
      ui.stop();
    }
  });
});

test("option picker open navigate confirm does not stack panels", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = new StreamUI("m", 0, {
      slashUi: {
        findSlashCompletion: () => [],
        resolveSlashCompletion: () => null,
      },
    });
    ui.start();
    try {
      let picked = null;
      clear();
      ui.showOptionPicker({
        title: "主题切换 · Theme",
        items: [
          { id: "bamboo", label: "bamboo", description: "绿" },
          { id: "night", label: "night", description: "夜" },
          { id: "mono", label: "mono", description: "灰" },
        ],
        selectedId: "bamboo",
        onPick: (item) => {
          picked = item.id;
        },
      });
      assert.equal(ui.getOverlayKind(), "options");
      clear();
      ui.moveOverlay(1);
      const mid = stripAnsi(getOutput());
      // 原地擦除：不应出现两个标题堆叠
      const titles = mid.match(/主题切换/g) || [];
      assert.ok(titles.length <= 2, `expected no stack, titles=${titles.length}\n${mid}`);
      assert.match(mid, /night|▸/);
      clear();
      ui.confirmOverlay();
      assert.equal(ui.getOverlayKind(), null);
      assert.equal(picked, "night");
    } finally {
      ui.stop();
    }
  });
});

test("option picker Esc restores prompt focus and the original draft", async () => {
  await withCapturedStdout(async () => {
    const ui = new StreamUI("m", 0, {
      slashUi: { findSlashCompletion: () => [], resolveSlashCompletion: () => null },
    });
    ui.start();
    try {
      for (const char of "keep draft") ui.dispatchKey(char);
      ui.showOptionPicker({
        title: "选择",
        items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        onPick: () => {},
      });
      ui.dispatchKey("\x1b");
      assert.equal(ui.getOverlayKind(), null);
      assert.equal(ui.getFocus(), "prompt");
      assert.equal(ui.getInputDraft(), "keep draft");
    } finally {
      ui.stop();
    }
  });
});

test("withDefaultWriters preserves openOptionPicker", () => {
  let called = false;
  const ctx = withDefaultWriters({
    agentLoop: {},
    openOptionPicker: () => {
      called = true;
    },
  });
  assert.equal(typeof ctx.openOptionPicker, "function");
  ctx.openOptionPicker({
    title: "t",
    items: [{ id: "a", label: "a" }],
    onPick: () => {},
  });
  assert.equal(called, true);
});

test("model/theme/mode prefer picker when openOptionPicker present", async () => {
  const picks = [];
  const lines = [];
  const context = {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
    openOptionPicker: (spec) => {
      picks.push(spec.title);
    },
    agentLoop: {
      getModel: () => "m",
      getProvider: () => "p",
      getEndpoint: () => "e",
      applyLlmSession: () => {},
      isPlanMode: () => false,
      setPlanMode: () => {},
      getPermissionMode: () => "ask",
      setPermissionMode: () => {},
    },
  };

  await modelCommand.execute([], context);
  await themeCommand.execute([], context);
  await modeCommand.execute([], context);

  assert.ok(picks.some((t) => /模型|Provider/i.test(t)));
  assert.ok(picks.some((t) => /主题|Theme/i.test(t)));
  assert.ok(picks.some((t) => /模式|Mode/i.test(t)));
  // 切换器路径不应刷长列表标题
  assert.equal(lines.filter((l) => /可用 Provider 预设/.test(l)).length, 0);
});

test("applySessionChrome contiguous: relative erase, single Mode:plan (no stack)", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = new StreamUI("m", 0, {
      slashUi: {
        findSlashCompletion: () => [],
        formatSlashCommandPanel: () => [],
        formatGroupedSlashPanel: () => [],
      },
    });
    ui.start();
    try {
      clear();
      ui.applySessionChrome({ sessionMode: "plan", permissionMode: "ask" });
      const out = getOutput();
      const plain = stripAnsi(out);
      // 应上移擦除（CSI A），而不是只追加第二份顶栏
      assert.match(out, /\x1b\[\d+A/);
      const modes = plain.match(/Mode:plan/g) || [];
      assert.equal(modes.length, 1, `expected single Mode:plan, got ${modes.length}\n${plain}`);
      assert.match(plain, /plan|规划|只读/);
      // 不应同时残留 Mode:normal 与 Mode:plan 两套顶栏文案
      assert.doesNotMatch(plain, /Mode:normal/);
    } finally {
      ui.stop();
    }
  });
});

test("repaintChrome clears and reprints header after setTheme", async () => {
  await withCapturedStdout(async (getOutput, clear) => {
    const ui = new StreamUI("m", 0, {
      slashUi: {
        findSlashCompletion: () => [],
        formatSlashCommandPanel: () => [],
        formatGroupedSlashPanel: () => [],
      },
    });
    ui.start();
    try {
      const { setTheme, TUI_COLORS } = await import("../../dist/tui/theme.js");
      const before = TUI_COLORS.primary;
      setTheme("night");
      assert.notEqual(TUI_COLORS.primary, before);
      clear();
      ui.repaintChrome({ clearScreen: true });
      const out = getOutput();
      // 清屏序列（含 2J / 3J / H）+ 顶栏 + 输入框
      assert.match(out, /\x1b\[2J/);
      assert.match(out, /\x1b\[H/);
      assert.match(stripAnsi(out), /轻灵|Qling|Mode:/);
    } finally {
      const { setTheme } = await import("../../dist/tui/theme.js");
      setTheme("bamboo");
      ui.stop();
    }
  });
});

test("fullscreen theme picker restores the fixed input frame after applying a theme", async () => {
  await withFullscreenTerminal(async () => {
    await withCapturedStdout(async (getOutput, clear) => {
      const ui = new StreamUI("m", 0, {
        tuiMode: "fullscreen",
        slashUi: {
          findSlashCompletion: () => [],
          formatSlashCommandPanel: () => [],
          formatGroupedSlashPanel: () => [],
        },
      });
      ui.start();
      try {
        const { setTheme } = await import("../../dist/tui/theme.js");
        ui.showOptionPicker({
          title: "主题切换 · Theme",
          items: [{ id: "night", label: "night" }],
          onPick: () => {
            setTheme("night");
            ui.repaintChrome({ clearScreen: true });
          },
        });
        clear();
        ui.confirmOverlay();
        await Promise.resolve();
        const out = getOutput();
        assert.doesNotMatch(out, /\x1b\[2J/);
        assert.match(stripAnsi(out), /╭─ .*normal.*╮/);
        assert.match(out, /\x1b\[21;1H\x1b\[2K/);
      } finally {
        const { setTheme } = await import("../../dist/tui/theme.js");
        setTheme("bamboo");
        ui.stop();
      }
    });
  });
});

test("fullscreen routes task console output through addressed content rows", async () => {
  await withFullscreenTerminal(async () => {
    await withCapturedStdout(async (getOutput, clear) => {
      const ui = new StreamUI("m", 0, {
        tuiMode: "fullscreen",
        slashUi: {
          findSlashCompletion: () => [],
          formatSlashCommandPanel: () => [],
          formatGroupedSlashPanel: () => [],
        },
      });
      ui.start();
      try {
        clear();
        console.log("external task log");
        console.error("external task error");
        const out = getOutput();
        assert.match(
          out,
          /\x1b\[\d+;1H\x1b\[2K[^\n]*external task log/
        );
        assert.match(
          out,
          /\x1b\[\d+;1H\x1b\[2K[^\n]*external task error/
        );
        assert.doesNotMatch(
          out,
          /external task log\nexternal task error\n/
        );
      } finally {
        ui.stop();
      }
    });
  });
});

test("fullscreen Alt+C preserves app mouse capture and does not submit input", async () => {
  await withFullscreenTerminal(async () => {
    await withCapturedStdout(async (getOutput, clear) => {
      const ui = new StreamUI("m", 0, {
        tuiMode: "fullscreen",
        slashUi: {
          findSlashCompletion: () => [],
          formatSlashCommandPanel: () => [],
          formatGroupedSlashPanel: () => [],
        },
      });
      ui.start();
      try {
        clear();
        ui.dispatchKey("\x1bc");
        assert.doesNotMatch(getOutput(), /\x1b\[\?100(?:0|2|6)l/);
        assert.equal(ui.getInputDraft(), "");
      } finally {
        ui.stop();
      }
    });
  });
});

test("fullscreen bottom keyboard actions remain available with app-managed drag selection", async () => {
  await withFullscreenTerminal(async () => {
    await withCapturedStdout(async (getOutput, clear) => {
      const submitted = [];
      let modeCycles = 0;
      const ui = new StreamUI("m", 0, {
        tuiMode: "fullscreen",
        slashUi: {
          findSlashCompletion: () => [],
          formatSlashCommandPanel: () => [],
          formatGroupedSlashPanel: () => [],
        },
      });
      ui.onInput(async (command) => {
        submitted.push(command);
      });
      let interrupts = 0;
      ui.setInterruptHandler(() => {
        interrupts += 1;
        return true;
      });
      ui.setModeCycleHandler(() => {
        modeCycles += 1;
      });
      ui.start();
      try {
        clear();

        ui.dispatchKey("\x1b[Z");
        assert.equal(modeCycles, 1, "Shift+Tab remains routed while mouse capture is active");

        ui.setAgentBusy(true);
        ui.dispatchKey("\x03");
        assert.equal(
          interrupts,
          1,
          "Ctrl+C remains routed while mouse capture is active"
        );
        assert.match(stripAnsi(getOutput()), /中断|取消/);
        ui.setAgentBusy(false);

        for (const command of ["/help", "/clear", "/model", "/exit"]) {
          for (const char of command) ui.dispatchKey(char);
          assert.match(stripAnsi(getOutput()), new RegExp(command.replace("/", "\\/")));
          ui.dispatchKey("\r");
        }
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(
          submitted,
          ["/help", "/clear", "/model", "/exit"],
          "Enter submits every slash action advertised in the bottom bar"
        );
      } finally {
        ui.stop();
      }
    });
  });
});

test("openOptionPickerOrFallback uses text when no TUI", () => {
  let fallback = false;
  const opened = openOptionPickerOrFallback(
    {
      writeLine: () => {},
      writeError: () => {},
      agentLoop: {},
    },
    {
      title: "x",
      items: [{ id: "1", label: "1" }],
      onPick: () => {},
    },
    () => {
      fallback = true;
    }
  );
  assert.equal(opened, false);
  assert.equal(fallback, true);
});
