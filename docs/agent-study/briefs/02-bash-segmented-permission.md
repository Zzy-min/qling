# Brief 02：Bash 命令分段判定 + 参数级权限规则（qling）
约束：不 commit/push；`npm test` 全绿；`npm run eval:tasks`、`eval:smoke` 不回退。
参考思路：grok-build `crates/codegen/xai-grok-permission-rules/src/bash_command_splitting.rs`（`all_commands_from_script`、`unwrap_wrappers`、`PlainCommand::spans_whole_script`）、`xai-grok-config-types/src/permission.rs`（RuleAction 默认 Deny）。TS 自行实现，不引入 tree-sitter。

## 任务
1. 新建 `src/guard/shell-split.ts`：`splitShell(cmd): { segments: string[][]; complex: boolean }`。处理单/双引号、反斜杠、`&& || ; | &` 与换行；出现 `$(`、反引号、`<(`、heredoc、`eval`、`bash -c`/`sh -c` 时 `complex=true`。`unwrap(words)` 去掉 `sudo env timeout nice nohup command time xargs` 及 `VAR=x` 前缀。
2. `src/pipeline/hooks.ts` `matchDangerousPatterns`：对每个 segment 的 unwrap 结果拼接后匹配；字符串模式改为字面量包含匹配（修复 `"rm -rf /*"` 被当正则的问题），RegExp 保持正则；`complex=true` 且命中任何危险关键词时升级为 ask。
3. `src/guard/permissions.ts`：`PermissionRule` 增加可选 `arg_pattern`（glob，对 bash 为单段命令）；`evaluate(toolName, args?)`。bash 多段命令必须**所有段**都命中 allow 才 allow；任一 deny 即 deny。缺省 decision 字段的配置规则按 deny 解析（保持现有构造函数默认值不变以免破坏兼容，只改配置解析处）。
4. `src/guard/permission-grants.ts`：session grant 仅在命令为单段且非 complex 时复用。

## 测试
`tests/unit/shell-split.test.mjs`：`git status && rm -rf /`、`sudo rm -rf /`、`echo "a && b"`、`bash -c "rm -rf /"`、`FOO=1 npm test`；permissions 多段 allow/deny 用例；保证现有 allow 用例（误拒绝，书 §1.2.5）仍通过。
