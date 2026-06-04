# `qingling storage` 顶层本地存储盘点规格（2026-05-31）

## 背景

会话内 `/storage` 已能盘点本地 state、sessions、exports、cache 的元数据。但排障时用户常在 shell 里直接操作，需要一个无需进入 TUI、无需模型配置、无需 API key 的顶层命令查看本地留存情况。

## 目标

- 新增顶层命令 `qingling storage`。
- 复用 `/storage` 的只读本地存储盘点报告。
- 在 `AgentLoop` 初始化前执行并退出，避免因为缺少 API key 或模型配置阻断本地诊断。
- 输出本地路径、文件数、目录数、占用大小、扫描上限和元数据边界说明。
- 继续只读取文件元数据，不读取正文、不联网、不调用模型。

## 非目标

- 不新增清理、删除、压缩或移动文件能力。
- 不扫描整个 workspace。
- 不读取 session/export/cache 正文。
- 不改变 `/storage` slash command 行为。

## 行为

- `qingling storage` 输出“本地存储盘点”并以 exit code 0 退出。
- 支持全局 `--file-state-dir`、`--file-cache-dir`、`--workspace` 配置解析。
- `qingling --help` 展示 `qingling storage`。
- 与 `--continue` 或 `--resume` 组合时报模式冲突错误，保持管理命令一致性。

## 验收

- 单测覆盖 CLI parser 识别 `storage`。
- 单测覆盖帮助文案包含 `qingling storage`。
- smoke 覆盖 `qingling storage` 可直接退出并输出本地盘点。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
