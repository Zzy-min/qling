# 顶层本地管理命令中文别名规格（2026-05-31）

## 背景

轻灵的会话内 slash commands 已提供中文别名，例如 `/隐私`、`/存储`、`/导出列表`。但 shell 顶层入口仍主要依赖英文命令，导致“英文主命令 + 中文别名 + 中文提示”的交互风格在本地诊断路径上不一致。

## 目标

- 为顶层本地只读管理命令新增中文别名：
  - `qingling 诊断` -> `qingling doctor`
  - `qingling 存储` -> `qingling storage`
  - `qingling 导出列表 [count]` -> `qingling exports [count]`
  - `qingling 会话列表 [count]` -> `qingling sessions [count]`
  - `qingling 隐私` -> `qingling privacy`
- 中文别名只做 parser 归一化，后续执行路径复用英文主命令。
- `qingling --help` 显示这些中文别名，降低发现成本。
- 保持只读本地边界：不读取正文、不联网、不调用模型、不初始化 AgentLoop。

## 非目标

- 不新增后台 mission 控制命令的中文别名。
- 不新增删除、打开、上传、正文检索能力。
- 不改变已有英文命令、slash commands 或废弃兼容入口。
- 不重构全局参数解析顺序；本增量沿用当前“全局参数放在子命令前”的行为。

## 行为

- 顶层第一个非 option 参数命中中文别名时，内部归一化为对应英文 `CliMode`。
- 中文别名后的参数完整保留为 `subArgs`，例如 `qingling 导出列表 5` 等价于 `qingling exports 5`。
- 与 `--continue` 或 `--resume` 组合时报模式冲突错误，保持管理命令一致性。
- 中文别名出现在 `qingling --help` 的“中文别名”区域。

## 验收

- 单测覆盖每个中文别名映射到正确 `mode`。
- 单测覆盖 `导出列表`、`会话列表` 保留 `[count]`。
- 单测覆盖 help 文案包含中文别名。
- smoke 覆盖至少一个中文别名可直接退出并输出对应本地报告，且不输出正文。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
