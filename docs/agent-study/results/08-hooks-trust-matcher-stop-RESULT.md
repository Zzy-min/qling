# 08 工作区信任门 + JSON hooks matcher / 禁用名单 / stdin 上限 / Stop 拦截 — RESULT

- 分支 `codex/agent-reliability-v3`，HEAD `a5fd5dd`；未 commit / push。
- 实现：pi，会话 `qling-r3-08`，模型只用 `magpie/codex-router/grok-oauth/grok-4.7`，命令末尾加 `< NUL`。共三次派发：08 主体、08b 两处修复、08c 合并顺序修复。每次最后一轮都报网关错误 `The Grok gateway could not complete the upstream response stream.`，但代码都已写完；协调者逐次只读复核，并以 pi 之后由脚本跑的 npm test 为准。协调者未手写代码。
- 信任门按用户更正后的设计实现，覆盖 brief 里"首版默认 true 只警告"的选项。

## ⚠ 行为变化（重点）
- **项目级 skills、项目级 agents（`<workspace>/.qling/agents`、`.claude/agents`）、以及任何项目级 hooks 来源，现在默认要先把项目设为受信才会加载。** 以前在任何目录下都会自动加载的项目 skills 和 agents，升级后默认不再加载。交互、headless、ACP、后台模式行为一致。
  - json-hooks 原本只从 stateDir 或 env 读 manifest，没有项目级来源，本次也没有新增。用户级 hooks 不受影响。
- 不弹窗。每个工作区每个进程只提示一次，打到 stderr，同时写进 skills 段。提示里给出受信方法：
  - 命令：`qling trust [dir]` / `qling untrust [dir]` / `qling trust --list`
  - 文件：`~/.qling/trusted-workspaces`，每行一个规范化绝对路径，`#` 为注释，子目录继承父目录，Windows 下不区分大小写，`C:\a` 不会连带信任 `C:\ab`
  - 关闭信任门：环境变量 `QLING_TRUST_ALL_WORKSPACES=true`，默认 false
- skill 优先级改为：用户 > 受信项目 > 包内 bundled。项目 skill 永远不能覆盖同名的用户 skill，受信或开启全部信任时也一样。改动前是项目 > 用户 > bundled。
- 新增 `qling hooks disable|enable <name>`，名单存在 `<stateDir>/disabled-hooks`。
- JSON hook 新增字段 `name` / `matcher` / `enabled` / `timeoutMs`。stdin payload 超过 `QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES`（默认 128KB）时，按 UTF-8 边界截断为 `{"truncated":true,"preview":...}`。
- 新增 Stop 事件。hook 返回 `{"decision":"block","reason"}` 时，把 reason（截断到 10000 字）作为用户消息注入并续跑。每轮最多续跑 `QLING_STOP_HOOK_MAX_CONTINUATIONS`（默认 8）次，第 9 次强制结束并提示。Stop hook 出错不阻止结束（fail-open）。
- **PreToolUse 的多个 hook 结果合并改为取最严格**：deny > ask > allow。改动前是"第一个有效决定直接生效"，所以以前 `allow` 在前、`deny` 在后时结果是 allow，现在是 deny（变严）。

## 为什么偏离 brief
1. brief 写的是"matcher 编译失败时该条目被禁用"。对 PreToolUse 来说这会放宽：一条写错 matcher 的拦截 hook 会失效，工具被放行；改动前该字段被忽略，hook 照常执行。用户硬规则是安全不得变宽，所以改为：
   - PreToolUse 的 matcher 编译失败，或拿不到工具名时，记一个"至少 ask"并写审计，继续跑完其余条目，最后取最严格的结果；
   - 只有只观察的事件（PostToolUse、PostToolUseFailure 等）才禁用该条目。
2. brief 的 `QLING_TRUST_ALL_WORKSPACES` 首版默认 true 只警告：按用户更正改为默认 false（信任门默认开启）。
3. 配置项 `trust.all_workspaces` 只认环境变量。项目目录或 `--config` 指定的 `qling.config.*` 里写了也会被忽略并警告，防止仓库通过自带配置把自己设为受信。qling 目前没有自动加载的用户级配置文件，所以实际只有环境变量能开启。
4. **可选的第 8 条（UserPromptSubmit / PreCompact）没做。**

## 改动文件（与 `%TEMP%\qling-agent-study\r3\pre08` 快照对比）
- 新增：`src/guard/workspace-trust.ts`、`src/cli/trust-control.ts`、`src/hooks/disabled-hooks.ts`、`scripts/eval-hook-overhead.mjs`、`tests/unit/workspace-trust.test.mjs`、`tests/unit/json-hooks-policy.test.mjs`、`tests/unit/stop-hook.test.mjs`、`docs/agent-study/results/08-{pre,post}-hook-overhead.json`
- 修改（brief 范围）：`src/hooks/json-hooks.ts`、`src/tools/skill.ts`、`src/agents/role-loader.ts`、`src/agent/main-loop.ts`（Stop 续跑）、`src/agent-loop.ts`（信任提示、接入 Stop hook）
- 修改（超出 brief 文件列表，用于 CLI 和配置）：`src/config.ts`、`src/index.ts`、`src/cli/startup-contract.ts`
- 测试调整：`tests/unit/{skill,role-loader,slash-commands,opencli-skill-routing}.test.mjs`
- ⚠ **与用户原有未提交改动是同一个文件**：`src/agent-loop.ts`、`src/config.ts`、`src/index.ts`、`src/agent/main-loop.ts`、`src/cli/startup-contract.ts`、`tests/unit/opencli-skill-routing.test.mjs`

## npm test
- 本轮基线：1386 项，通过 1384，失败 1，跳过 1。
- 最终（08c 之后）：1425 项，通过 1423，失败 1，跳过 1。唯一失败为基线用例 `verify tool applies tail as an output view and preserves the full artifact`。无新增失败，新测试全部通过。

## Eval 前后
| 指标 | 改前 | 改后 |
|---|---|---|
| eval:smoke | 通过 | 通过 |
| eval:tasks | 11/11 | 11/11 |
| 只匹配 bash 的 hook：read 调用触发次数 / 平均耗时 | 20 次 / 76.4ms | 0 次 / 0.02ms |
| 同上：bash 调用触发次数 / 平均耗时 | 20 次 / 73.6ms | 20 次 / 78.7ms |

## 安全没有放宽的依据（测试名）
- PreToolUse 仍 fail-closed：`PreToolUse stays fail-closed when a hook exits non-zero, times out, or returns invalid JSON`
- 写错 matcher 不放行：`PreToolUse matcher compile failure fails closed instead of allowing the tool`、`PreToolUse matcher without a tool name fails closed`
- 合并取最严格（deny + 写错 matcher 两种顺序都得 deny；allow 在前、deny 在后得 deny；只有写错 matcher 时得 ask）：`PreToolUse merges decisions by strictest rank and keeps a prior deny`
- 只观察的事件：`PostToolUse invalid matcher disables only that entry`
- 禁用名单不影响权限判定：`disabled-hooks disables named hooks and does not change permission decisions`
- 信任门：
  - `untrusted workspace does not load project skills or project agents`
  - `trusted workspace loads project skills and agents, and child directories inherit`
  - `similar path prefixes are not trusted`
  - `windows trust matching ignores case and skips comments`
  - `project skill never overrides a same-named user skill, even when trusted or trust-all`
  - `QLING_TRUST_ALL_WORKSPACES=true restores project skill loading`
  - `project qling.config cannot enable trust.all_workspaces`
  - `untrusted workspace hint names qling trust and is emitted once per workspace`
- Stop：`stop hook continuation limit defaults to 8`、`Stop block continues the turn and the 9th stop is forced`、`a crashing Stop hook still ends the turn`
- 超大输入截断：`stdin payload over 128KB is replaced by a truncated preview`
- Stop 是唯一 fail-open 的事件。它只决定"本轮是否继续"，不放行任何工具调用。

## 仓库根目录
npm test 后无新增未跟踪文件（无 `sessions/`）。测试用的 home、stateDir、信任文件都在 `os.tmpdir()` 下创建，用完清理。
