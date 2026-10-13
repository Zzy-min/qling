# 10 第三轮修补（hook payload 截断保留身份字段 + 角色优先级）— RESULT

- 分支 `codex/agent-reliability-v3`；未 commit / push。开工前快照：`%TEMP%\qling-agent-study\r3\pre10`。
- 实现：pi，会话 `qling-r3-10`，模型 `magpie/codex-router/grok-oauth/grok-4.7`，共 124 次调用，没有出错，正常结束（stopReason=stop）。协调者未手写代码，只做只读审查。

## 改动文件（与 pre10 快照对比）
- `src/hooks/json-hooks.ts`
- `src/agents/role-loader.ts`
- `tests/unit/json-hooks-policy.test.mjs`
- `tests/unit/role-loader.test.mjs`
四个文件都在本 brief 范围内。`json-hooks.ts` 与 `role-loader.ts` 在本轮基线之后由 08 改过，不是用户原有的未提交改动；`role-loader.test.mjs` 在 08 也改过。

## 1) encodeHookPayload 截断保留结构化字段（中危）
- 发给 hook 的 payload 顶层新增 `hook_event_name`，工具事件还新增 `tool_name`。只在原 payload 没有这两个字段时补上，不删除任何已有字段，向后兼容。
- 超过上限（默认 128KB）时不再整体替换成 `{truncated, preview}`：
  1. 先按字段截断：从最大的字符串字段开始缩短，末尾加 `…[truncated]`。`hook_event_name`、`tool_name`、`context.toolName`、`context.toolCallId`、`context.sessionId` 受保护，不会被截。
  2. 仍超限时，删除最大的非保护字段。
  3. 结果带 `truncated:true` 和 `truncatedFields`（被截断或删除的字段路径）。
  4. 只有连这样都放不下时，才退回 preview 方式，此时仍保留 `hook_event_name` 和 `tool_name`。
  5. 整个过程都在 UTF-8 字符边界上截断，最终结果不超过上限。
- **PreToolUse 在 payload 被截断时至少 ask（fail closed）**：截断会记一个"至少 ask"的下限，和各 hook 的结果合并后取最严格的（deny > ask > allow）。所以 hook 返回 allow 时结果是 ask，返回 deny 时结果仍是 deny。payload 序列化本身出错时也按截断处理。

## 2) role-loader 用户角色优先
- 受信工作区里，项目角色（`.claude/agents`、`.qling/agents`）与用户角色同名时，用户角色优先，项目角色不覆盖，并向 stderr 打印一条提示。与 skills 的优先级一致。
- 不同名的项目角色照常加载；未受信工作区仍不加载项目角色。
- `formatLoadedRoles` 的说明文字已同步更新。

## 测试
- 新增或调整的用例：
  - `300KB arguments keep tool_name and hook_event_name within the payload cap`（替换旧用例 `stdin payload over 128KB is replaced by a truncated preview`）
  - `truncated PreToolUse fails closed at ask but a hook deny still wins`
  - `untruncated PreToolUse keeps allow and deny and adds hook identity`
  - `user role wins over a same-named project role; other project roles still load`（替换旧用例 `role catalog precedence is workspace over user over built-in`）
  - `untrusted workspace does not load project roles`
- npm test（含 `tsc` 构建，构建通过）：1453 项，通过 1451，失败 1，跳过 1。唯一失败为基线用例 `verify tool applies tail as an output view and preserves the full artifact`，没有新增失败。
  - 对照：本轮基线 1384/1386；09 完成后 1448/1450。

## 安全审查（协调者只读）
- 截断只会增加"至少 ask"这个下限，合并时取最严格，已有的 deny 不会被降成 ask，有测试覆盖。没截断时 allow/deny 行为不变，有测试覆盖。
- matcher 用的工具名来源不变（仍是 `context.toolName`）。补上的顶层 `tool_name` 只在原 payload 没有时才加，不会覆盖调用方给的值。
- 角色这边只把项目覆盖用户改成了用户优先，项目角色可覆盖的范围变小了，没有新增加载来源。
- 结论：没有放宽安全。

## 偏离
- 没有偏离 brief。另外两点说明：
  - payload 会额外带 `truncatedFields` 字段，列出被截断或删除的字段路径；
  - 角色冲突的提示打印到 stderr，没有写进返回信息。

## 仓库根目录
npm test 后没有新增未跟踪文件，没有 `sessions/` 或 `nul`。
