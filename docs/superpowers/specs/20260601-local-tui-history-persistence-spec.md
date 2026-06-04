# `qingling` TUI 本地持久输入历史规格（2026-06-01）

## 背景

当前 TUI 已支持上下方向键和 `Ctrl+R` 在进程内历史中找回输入，但关闭 `qingling chat` 后历史即丢失。对长周期本地 Agent 使用来说，跨会话找回最近 prompt、slash command 和多行输入是接近 Claude Code 交互手感的关键能力。

## 目标

- 启动 TUI 时从 `<stateDir>/input-history.json` 预加载最近输入历史。
- 用户提交非空输入后，将其写回本地历史文件，供后续会话的上下方向键和 `Ctrl+R` 使用。
- 历史文件仅保留本机，默认最多 200 条，超过上限时保留最新条目。
- 重复输入去重并移动到最新位置，避免历史被重复命令刷屏。
- 多行输入原样保留内部换行，恢复后可继续编辑或提交。
- 跳过明显敏感输入，例如包含 `api_key`、`token`、`password`、`secret`、`authorization`、`bearer` 或 `sk-...` 形态的内容。
- 历史读写失败不阻断 TUI 启动或命令执行。

## 非目标

- 不做云同步、联网、模型检索或向量化。
- 不新增历史展示、删除、导出命令。
- 不读取会话正文来回填历史。
- 不改变现有 `Enter`、`Ctrl+N`、上下方向键、`Ctrl+R` 行为语义。
- 不承诺过滤所有秘密，只做明显模式的保守跳过。

## 数据位置

- 默认文件：`<stateDir>/input-history.json`。
- 文件格式：JSON 数组，每个元素为一个输入字符串。
- 由现有 runtime state dir 控制，支持 `--file-state-dir` 覆盖。

## 行为

- 缺失文件返回空历史。
- 非 JSON、非数组或损坏文件返回空历史，不抛出到 UI。
- 写入前会裁剪首尾空白；空输入不写入。
- 单条输入最大 8000 字符，超过后不写入。
- 默认读取和写入上限均为 200 条。
- `QINGLING_TUI_HISTORY_ENABLED=false` 时不加载也不写入。

## 验收

- 单测覆盖缺失/损坏文件、追加写入、上限截断、重复去重、多行保留、敏感输入跳过、禁用环境变量。
- `InputBuffer` 支持预加载历史，`Ctrl+R` 能搜索预加载项。
- `StreamingREPL` 启动时预加载本地历史，提交输入后写入本地历史。
- `npm run build`、目标单测和 `npm run ci:check` 通过。
