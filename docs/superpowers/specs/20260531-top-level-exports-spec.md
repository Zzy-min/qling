# `qling exports` 顶层本地导出索引规格（2026-05-31）

## 背景

会话内 `/exports` 已能列出本地 Markdown 导出，但用户在 shell 排障或整理本地留存数据时仍需要进入 TUI。为了贴近 Claude Code 式管理命令体验，需要提供无需模型、无需进入交互会话的顶层导出索引。

## 目标

- 新增顶层命令 `qling exports [count]`。
- 复用 `/exports` 的本地 Markdown 导出索引逻辑。
- 在 `AgentLoop` 初始化前执行并退出，避免 API key 或模型配置影响本地查看。
- 默认显示最近 10 条，最多 50 条，按修改时间倒序。
- 只读取导出文件元数据，不读取 Markdown 正文、不联网、不调用模型。

## 非目标

- 不删除、打开、移动或上传导出文件。
- 不改变 `/export` 或 `/exports` slash command 行为。
- 不做导出正文搜索或摘要。

## 行为

- `qling exports` 显示最近 10 条本地 Markdown 导出。
- `qling exports 5` 显示最近 5 条。
- `count` 规则与 `/exports` 一致：非法、小于等于 0 或缺省使用 10；超过 50 截断为 50。
- 支持全局 `--file-state-dir` 配置；推荐放在子命令前，例如 `qling --file-state-dir <dir> exports 5`。
- 无导出目录时输出空态提示并以 exit code 0 退出。

## 验收

- 单测覆盖 CLI parser 识别 `exports [count]`。
- 单测覆盖帮助文案包含 `qling exports [count]`。
- smoke 覆盖 `qling exports 1` 可直接退出、按本地目录输出导出列表且不泄露文件正文。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
