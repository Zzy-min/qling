# 状态线上下文占用与本地成本估算

## Summary

增强 `/statusline`、`/状态线` 与 `qingling statusline`：在现有 model/session/branch/permission/goal/tasks/tokens 基础上，新增上下文占用 `ctx=` 与可选成本估算 `cost≈`，让交互状态更接近 Claude Code 的即时反馈，同时保持本地只读。

## Goals

- 状态线固定展示上下文占用：
  - 有最大 token budget 时：`ctx=<used>/<max>(<percent>%)`
  - 无最大 token budget 时：`ctx=<used>/-`
- 状态线固定展示成本字段：
  - 配置了本地估算单价时：`cost≈$<amount>`
  - 未配置或非法时：`cost=-`
- 成本只做本地粗略估算，使用当前 session token 估算值，不声称等同真实账单。
- 不联网、不调用模型、不读取会话正文、不读取 API key。

## Public Interfaces

- Slash:
  - `/statusline`
  - `/状态线`
- Top-level CLI:
  - `qingling statusline`
  - `qingling 状态线`
- Optional local env:
  - `QINGLING_STATUSLINE_COST_PER_1K_TOKENS`

## Formatting

示例：

```text
model=deepseek-chat  session=session_1234  branch=main  perm=ask(确认)  goal=active  tasks=2  tokens=12,000  ctx=12,000/120,000(10%)  cost≈$0.0240
```

未配置成本时：

```text
... tokens=12,000  ctx=12,000/120,000(10%)  cost=-
```

## Privacy Boundary

状态线只读取：

- 当前模型名
- 当前 session ID 缩写
- git branch
- 权限模式
- goal 状态
- active task 数
- token 估算值
- max token budget
- 本地成本估算单价

状态线不读取：

- prompt/body 正文
- session 文件正文
- API key 或任意 secret
- 网络账单或远端 usage API

## Acceptance Criteria

- `formatStatusLine` 输出 `ctx=` 和 `cost` 字段。
- 未配置成本时显示 `cost=-`。
- 配置 `QINGLING_STATUSLINE_COST_PER_1K_TOKENS` 后 slash/top-level 状态线显示 `cost≈$...`。
- 非法或小于等于 0 的成本配置不显示估算。
- `qingling statusline` 使用 `runtime.max_token_budget` 作为本地 context 上限。
- 测试证明状态线不会泄露 session body 或 secret env。
- `npm run build`、目标测试、startup smoke、`npm run ci:check` 通过。
