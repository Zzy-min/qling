# 权限解释 `/permissions explain` Implementation Plan

## User Journey

作为轻灵用户，我想在运行工具前确认“这个工具为什么会被自动放行、询问或拒绝”，减少权限提示的黑盒感，并避免误触发高风险工具。

## Implementation Steps

1. 扩展 `src/permissions-report.ts`：
   - 新增 `PermissionExplanationReport`
   - 新增 `explainLocalPermissionDecision(input, toolName)`
   - 新增 `formatPermissionExplanationReport(report)`
   - 复用 `PermissionMatrix`
2. 增强 slash command `src/commands/permissions.ts`：
   - 支持 `explain|解释 <tool>`
   - 从 `context.agentLoop` 或 env 读取 default mode
   - 从 `QLING_GUARD_PERMISSIONS_RULES` 解析本地规则
3. 增强 top-level CLI `src/index.ts`：
   - `permissions explain <tool>`
   - 中文 `权限 解释 <tool>`
   - 使用 `loaded.config.guard.permissions`
4. 更新 help：
   - `src/commands/help.ts`
   - `src/cli/startup-contract.ts`
5. 测试：
   - `tests/unit/permissions-report.test.mjs`
   - `tests/unit/slash-commands.test.mjs`
   - `tests/unit/cli-startup.test.mjs`
   - `tests/smoke/cli-startup.smoke.test.mjs`

## TDD Plan

RED:

- report explains matching rule and default fallback.
- slash `/permissions explain bash` reads env rules and does not leak API key/session body.
- Chinese slash alias works.
- parser/help expose subcommand.
- top-level smoke exits 0 with env rules and no secret leaks.

GREEN:

- Implement minimal report and routing.

REFACTOR:

- Keep rule parsing local and conservative.
- Do not duplicate permission effect text in multiple places unnecessarily.

## Verification Commands

```powershell
npm run build
node --test tests/unit/permissions-report.test.mjs tests/unit/slash-commands.test.mjs tests/unit/cli-startup.test.mjs
node --test tests/smoke/cli-startup.smoke.test.mjs
npm run ci:check
```

## Risks

- Configured `reason` text may itself contain sensitive information. Existing permissions report already shows reasons, so this increment preserves current behavior rather than silently redacting team-supplied explanations.
- This does not classify command arguments; users must still rely on approval prompts and guard classifier for command-level risk.
