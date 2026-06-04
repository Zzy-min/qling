# `qingling` 阶段 B：`/permissions` 命令补齐规格（2026-05-17）

## 背景与问题

- 对标重做计划已明确要求补齐 `/permissions`，但当前 Slash 命令集中尚未实现该入口。
- 当前 Guard 权限矩阵已支持 `allow|deny|ask`，但缺少会话内可见/可切换的交互面。

## 目标

在不重构 Guard 架构的前提下，补齐一个可用的 `/permissions` 命令闭环：

1. 查询当前默认权限决策（`allow|deny|ask`）。
2. 在当前会话中切换默认决策，并立即影响后续工具调用。
3. 同步更新环境变量，保证后续组件读取时一致。

## 非目标

- 不在本轮引入 Claude Code 风格的多档 permission modes（`acceptEdits/plan/auto-lite`）。
- 不改动已有 `rules` 规则表达式和匹配机制。
- 不新增持久化配置写回文件能力。

## 命令契约

- `/permissions`
  - 显示当前默认权限决策。
- `/permissions <allow|deny|ask>`
  - 切换当前会话默认权限决策。
- `/permissions status`
  - 与无参数等价。
- `/权限`（中文别名）
  - 保持等价行为。

## 实现要点

1. 新增 `src/commands/permissions.ts`。
2. `HookManager` 增加运行态默认权限更新能力，避免仅改环境变量不生效。
3. `AgentLoop` 暴露最小接口：
   - `getPermissionMode()`
   - `setPermissionMode(mode)`
4. `help` 与命令注册表同步更新，保证文档和行为一致。

## 验收标准

- `node --test "tests/unit/slash-commands.test.mjs"` 覆盖并通过：
  - `/permissions` 状态查询
  - `/permissions deny` 模式切换
  - `/permissions bad` 参数报错
- `npm run build` 通过。
- `npm run ci:check` 通过。
