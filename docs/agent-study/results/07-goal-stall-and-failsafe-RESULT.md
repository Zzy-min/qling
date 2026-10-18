# 07 Goal 停滞检测 + 评估器故障策略 + 过早放弃检测 — RESULT

- 分支 `codex/agent-reliability-v3`，HEAD `a5fd5dd`；未 commit / push。
- 实现：pi（`magpie/codex-router/grok-oauth/grok-4.7`，会话 `qling-r3-07b`，160 次调用全部为该模型，0 次错误）。协调者未手写代码。
- 第一次派发（会话 `qling-r3-07`）因 Magpie 网关（127.0.0.1:3425）未运行而 `Connection error`，未产生改动；拉起 Magpie 并 ping 验证后重派。

## 改动文件（与 `%TEMP%\qling-agent-study\r3\pre07` 快照逐文件对比）
brief 列出的：
- `src/session/session-goal-manager.ts`
- `src/session/goal-controller.ts`
- `src/session/goal-evaluator.ts`
- `src/session/premature-stop.ts`（新）
- `src/tui/streaming-repl.ts` ⚠ **用户原有未提交改动的文件**
- `src/agent/durable-session-supervisor.ts`
- `src/repl.ts`
测试 / eval：
- `tests/unit/goal-stall-failsafe.test.mjs`（新，16 个用例）
- `tests/unit/goal-controller.test.mjs` ⚠ **用户原有未提交改动的文件**（旧用例"超限即 clear"改为期望 `paused_budget`）
- `scripts/eval-goal-stall.mjs`（新）、`docs/agent-study/results/07-{pre,post}-goal-stall.json`
超出 brief 列出范围（为 `/goal resume` 所需，轻微偏离）：
- `src/commands/goal.ts`、`src/commands/help.ts`、`src/help-topics.ts`

## npm test
- 基线：1386 项，通过 1384，失败 1，跳过 1。
- 改动后：1402 项，通过 1400，失败 1，跳过 1。唯一失败为基线用例 `verify tool applies tail as an output view and preserves the full artifact`（npm 12 输出 `npm notice run` 含 `console.log('one')` 字面量，与本次无关）。无新增失败；新增 16 个用例全部通过。

## Eval 前后
| 指标 | 改前 | 改后 |
|---|---|---|
| eval:recovery | ok，15 fixtures，finalSuccessRate 1 | 同左（无变化） |
| eval:tasks | 全部 PASS | 全部 PASS（pass=11 fail=0） |
| eval-goal-stall：相同未完成原因 | autoTurns 13，cleared，目标丢失，approxTokens 243 | autoTurns 2，paused_no_progress，目标保留，approxTokens 41 |
| eval-goal-stall：评估器每次抛错 | autoTurns 13，cleared，evaluatorErrorTurns 12，目标丢失 | autoTurns 2，paused_infra，evaluatorErrorTurns 2，目标保留 |
改前 13 而非 12：原判断为 `spent > 12`。改后 2，满足 brief 预期 ≤3。

## 安全 / fail-closed 依据（均有测试）
- 损坏 JSON / 未知 status 一律 `paused_infra`，永不以 active 加载：`corrupt or unknown goal snapshots never load as active`；`.bak` 回退：`unreadable primary falls back to .bak ...`。
- `paused_*` 只能显式 `/goal resume` 回 active：`only paused goals resume ...`。
- 评估器故障不再当作"未完成继续推进"（改前会空转 12 轮）：`two evaluator throws pause as paused_infra and the first throw does not continue`、`missing evaluator key and unparseable results are infra failures, not progress`。
- `evaluate` 不再抛出：`goal evaluator reports network, timeout, missing key, and unparseable results without throwing`。
- 原子写：`saveGoal writes atomically and keeps a .bak after the second save`。
- `QLING_FEATURES_EVIDENCE_GOALS` 旧语义保留：`QLING_FEATURES_EVIDENCE_GOALS still blocks at the auto-turn cap`。
结论：只增加暂停/停止条件，没有新增任何让目标继续自动运行的路径，不比原来宽松。

## 行为变化
- 超出自动轮数不再清除目标，改为可恢复的 `paused_budget`（evidence 模式仍为 blocked）。
- 评估器第一次故障即停止本轮自动续跑（返回 `evaluator_error`），连续两次 `paused_infra`。
- 过早放弃命中时续跑提示改为"不要交还给用户，先尝试其他方案"，并 emit `goal_premature_stop`；"等你确认后"不命中。
- 调用方 afterTurn 均包 try/catch，并对 paused / blocked / evaluator_error 给出提示。

## 偏离（pi 自述，协调者已复核，均判为轻微）
1. `paused_budget` 时把 baselineTurns/baselineTokens 移到触发上限的那一轮，否则 resume 后会立刻再次暂停。
2. 证据契约（outcomeContract）路径不做缺口停滞检测，与改前一致（不放宽）。
3. 用 `.bak` 修复主文件时沿用现有 `atomicWriteJson({backup:true})`，损坏的主文件会覆盖到 `.bak`；未改 `atomic-json.ts`。
4. 过早放弃事件发在 controller 的 `goal_premature_stop` 上，未另建 events.jsonl。
5. 构造参数 `stallThreshold` / `evidenceGoals` 仅供测试注入，正式路径仍读环境变量。
6. 超出 brief 文件列表：`src/commands/goal.ts`、`src/commands/help.ts`、`src/help-topics.ts`。

## 仓库根目录
npm test 后无新增未跟踪文件（无 `sessions/`）；git status 新增项仅为上面列出的文件。
