# Brief 08：工作区信任门 + JSON hooks 的 matcher / 禁用名单 / stdin 上限 / Stop 拦截（qling）
约束：同 Brief 07。
参考思路：grok-build `xai-grok-hooks/src/trust.rs`（Trust、DisabledHooks、skip_reason）、`src/event.rs`（MAX_PAYLOAD_SIZE=128KiB、truncate_payload、stop_hook_active、MAX_HOOK_FEEDBACK_CHARS）、`src/dispatcher.rs` StopDispatchResult、`xai-grok-shell/src/session/acp_session_impl/stop_gate.rs`（每轮最多续跑 8 次）；书 §9.3.2。

## 任务
A. 工作区信任
1. 新增 `src/guard/workspace-trust.ts`：`~/.qling/trusted-workspaces`，每行一个规范化绝对路径（`#` 为注释；Windows 下不区分大小写）；导出 `isWorkspaceTrusted(dir)`（子目录继承父目录的信任）、`trustWorkspace`、`untrustWorkspace`；env `QLING_TRUST_ALL_WORKSPACES=true` 用于兼容旧行为（默认 false；如担心破坏现有用户，首版默认 true 并只输出警告——由 Pi 在 PR 描述中说明取舍）。
2. `tools/skill.ts` `getSkillDirs()`：不受信时跳过所有 cwd 级目录，并在 skills section 中提示"当前工作区未受信，项目技能未加载，运行 `qling trust`"；`agents/role-loader.ts:104` 同样处理。
3. CLI：`qling trust [dir]` / `qling untrust [dir]` / `qling trust --list`。
B. JSON hooks（`src/hooks/json-hooks.ts`）
4. `JsonHookCommand` 增加 `name?`、`matcher?`（正则，只对工具事件生效；编译失败时该条目被禁用，并在审计中记录）、`enabled?`、`timeoutMs?`。
5. 禁用名单：`<stateDir>/disabled-hooks`，按 name 逐行；`qling hooks disable|enable <name>`。
6. stdin payload 上限：序列化后超过 `QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES`（默认 128KB）时，按 UTF-8 边界截断，改为发送 `{"truncated":true,"preview":"..."}`。
7. Stop 事件：在 agent 主循环判断"本轮结束"时调用 `runner.runStop({lastAssistantText 前 2000 字, stopHookActive})`；hook 输出 `{"decision":"block","reason":"..."}` 时，把 reason（截断到 10000 字）作为用户消息注入并继续；每轮最多 `QLING_STOP_HOOK_MAX_CONTINUATIONS`（默认 8）次，达到上限时输出提示并结束；hook 出错不阻止停止（Stop 事件 fail-open，PreToolUse 保持现有 fail-closed）。
8. 可选：UserPromptSubmit（可 block，block 原因只给用户、不进模型上下文）、PreCompact（只观察）。

## 测试
信任：未受信目录下 skills/agents 不加载；受信后加载；子目录继承。hooks：matcher 只匹配 `bash` 时 read 不触发 spawn（用计数器脚本验证）；disabled 名单生效；300KB 参数被截断；Stop 返回 block 时续跑，第 9 次强制结束；Stop hook 崩溃时正常结束。
## 度量
eval:smoke / eval:tasks 不下降；记录启用一个只匹配 bash 的 hook 时，每次工具调用的平均开销前后对比。
