# `qling` TUI 本地持久输入历史实施计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/input-history.test.mjs`：
  - 缺失或损坏历史文件返回空数组。
  - 追加输入会写入 `<stateDir>/input-history.json`。
  - 超过上限时保留最新条目。
  - 重复输入去重并移动到末尾。
  - 多行输入保持换行。
  - 明显敏感输入不写入。
  - `QLING_TUI_HISTORY_ENABLED=false` 禁用读写。
- 扩展 `tests/unit/input-buffer.test.mjs`：
  - 预加载历史后，上方向键和 `searchHistory()` 可恢复历史。

## Step 2: 本地历史模块

- 新增 `src/tui/input-history.ts`：
  - `resolveInputHistoryPath(stateDir)`。
  - `loadInputHistory(options)`。
  - `appendInputHistory(input, options)`。
  - `shouldPersistInputHistory(input)`。
- 所有读写仅访问本地 state dir，不联网、不调用模型。
- 写入采用目录创建和 JSON 覆盖，失败由调用方吞掉，保证交互稳定。

## Step 3: 输入缓冲接入

- 修改 `src/tui/input-buffer.ts`：
  - 支持构造或方法预加载历史。
  - 保持现有提交、上下切换、`Ctrl+R` 行为。

## Step 4: TUI 启动接入

- 修改 `src/tui/streaming-tui.ts`：
  - 暴露 `setHistory(entries)`。
- 修改 `src/tui/streaming-repl.ts`：
  - 启动时用 `agent.getRuntimeRootDir()` 加载历史。
  - 每次收到用户输入时追加历史。
  - 历史读写错误不阻断主流程。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/input-history.test.mjs" "tests/unit/input-buffer.test.mjs"`
- `npm run ci:check`
