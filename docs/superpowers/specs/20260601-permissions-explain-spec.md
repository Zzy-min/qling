# 权限解释 `/permissions explain`

## Summary

新增只读权限解释能力：`/permissions explain <tool>`、`/权限 解释 <tool>`、`qling permissions explain <tool>`，用于在触发工具前解释当前本地权限规则会如何处理指定工具。

## Goals

- 解释指定工具名在当前权限矩阵中的决策：`allow`、`ask` 或 `deny`。
- 展示匹配来源：
  - 命中规则：显示 `matched_rule=<pattern>`
  - 未命中规则：显示 `matched_rule=default`
- 展示配置原因 `reason`，若无则给出默认解释。
- 输出用户可理解的行为说明：
  - `allow`：自动放行
  - `ask`：执行前要求确认
  - `deny`：默认拒绝执行
- Slash 与 top-level CLI 行为一致。
- 中文别名与中文提示保持一致。

## Non-Goals

- 不执行工具。
- 不修改权限配置。
- 不写入本地状态。
- 不做命令正文危险模式分类；本增量只解释工具名级别的 permission matrix。
- 不读取会话正文、不联网、不调用模型。

## Public Interfaces

- Slash:
  - `/permissions explain <tool>`
  - `/permissions 解释 <tool>`
  - `/权限 explain <tool>`
  - `/权限 解释 <tool>`
- Top-level CLI:
  - `qling permissions explain <tool>`
  - `qling 权限 解释 <tool>`

## Output Fields

- Tool
- Decision
- Default
- Matched rule
- Reason
- Effect
- Boundary

## Privacy Boundary

命令只读取当前进程中已经加载的本地权限配置与环境变量：

- `guard.permissions.default`
- `guard.permissions.rules`
- `QLING_GUARD_PERMISSIONS_DEFAULT`
- `QLING_PERMISSIONS_MODE`

命令不读取：

- API key
- session 文件正文
- tool 参数正文
- shell command 正文
- guard audit 明细

## Empty/Error States

- 缺少工具名时返回用法错误。
- 非法 rules env 或空 rules 按默认模式解释。
- 未命中规则时不报错，解释为 default 决策。

## Acceptance Criteria

- `/help` 展示 `/permissions explain <tool>`。
- `/permissions explain bash` 能展示决策、匹配规则和效果说明。
- `/权限 解释 bash` 与英文命令行为一致。
- `qling permissions explain bash` 通过本地配置/环境变量解释结果。
- 输出不包含 session body 或 API key。
- `npm run build`、目标测试、startup smoke、`npm run ci:check` 通过。
