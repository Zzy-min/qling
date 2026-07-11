# Plan: Phase 3 — Harness Lean / Progressive Skills / 编排

**日期**: 2026-07-10
**Spec**: `docs/superpowers/specs/20260710-agent-ecosystem-refresh-and-phase3-roadmap-spec.md`
**目标版本**: 1.x 增量（不强制跳 major）

---

## 0. 范围

本计划覆盖 **Phase 3.0 + 3.1 优先落地**，并列出 3.2–3.5 任务卡以便后续拆 PR。
不在本轮：LSP、monorepo 分包、Desktop、默认 browser_act。

---

## 1. Phase 3.0 — Harness Lean

### 1.1 任务

| ID | 任务 | 文件 | 测试 |
|----|------|------|------|
| T3.0.1 | 导出 `summarizeToolOutputForContext` / `prepareToolResultContent` | `src/context-compactor.ts`（或 `src/context-tool-hygiene.ts`） | unit |
| T3.0.2 | AgentLoop 写入 tool 消息前应用卫生处理 | `src/agent-loop.ts` | unit（可测纯函数） |
| T3.0.3 | `estimateContextLayers` + `/context` 展示 | `src/context-report.ts`、format | unit |
| T3.0.4 | 环境变量 `QLING_TOOL_RESULT_MAX_CHARS`（默认 6000） | config / 卫生模块 | unit |

### 1.2 算法（工具输出）

```
if output.length <= maxChars: return as-is
head = first headChars
tail = last tailChars
return head + "\n…[截断: totalChars, totalLines；需要全文请 read/search]…\n" + tail
```

对 JSON 包装的 `{ output, is_error, ... }`：只压缩 `output` 字段，保持结构。

### 1.3 验收

- [ ] 超长 bash/read 结果入会话后长度 ≤ max + 开销
- [ ] tool_call_id 链完整
- [ ] `/context` 含 layer 行
- [ ] `npm run ci:check` 绿

---

## 2. Phase 3.1 — Progressive Skills + 生命周期 + 扫描

### 2.1 任务

| ID | 任务 | 文件 | 测试 |
|----|------|------|------|
| T3.1.1 | SkillMeta 增加 `triggers?: string[]` | `src/skills/types.ts`、`registry.ts` | unit |
| T3.1.2 | `buildSkillsSection` 仅索引 + triggers + 加载提示 | `src/pipeline/sections.ts` | unit |
| T3.1.3 | `scanSkillContent` 静态安全扫描 | `src/skills/security-scan.ts` | unit（恶意 fixture） |
| T3.1.4 | `skill` 加载前扫描；高危拒绝或警告 | `src/tools/skill.ts` | unit |
| T3.1.5 | 生命周期 skills 六件套（中文原创） | `skills/lifecycle-*/SKILL.md` | list 可见 |
| T3.1.6 | 更新 `docs/skills.md` | docs | 文档 review |
| T3.1.7 | （可选）`qling skills scan <path>` CLI | `src/index.ts` 或 commands | smoke |

### 2.2 扫描规则（第一版）

| 级别 | 模式示例 |
|------|----------|
| critical | 私钥 PEM、`AKIA…`、通用 api_key= 长串 |
| high | `curl \| bash`、`irm \| iex`、`Invoke-Expression`、隐藏 base64 长串解码执行 |
| medium | 大量外链、`eval(`、`child_process` 无说明 |

策略：`critical|high` → 默认 **拒绝加载**；`QLING_SKILL_SCAN=warn` 可降级为警告。

### 2.3 验收

- [ ] system skills 节不含 SKILL 正文长文
- [ ] 恶意 skill fixture 被拒
- [ ] 良性 opencli skill 仍可加载
- [ ] lifecycle skills 出现在 `skill list`

---

## 3. Phase 3.2 — Sub-agent（已落地 2026-07-10）

| ID | 任务 | 文件 | 状态 |
|----|------|------|------|
| T3.2.1 | 角色枚举 explore/implement/review + 工具白名单 | `src/agents/roles.ts` | done |
| T3.2.2 | 回传契约格式化 | `src/agent/subtask.ts`、`src/tools/subtask.ts` | done |
| T3.2.3 | `/agents` 展示角色 + missions | `src/commands/agents.ts` | done |
| T3.2.4 | unit + eval smoke | `tests/unit/subagent-roles.test.mjs`、`src/eval/tasks.ts` | done |

---

## 4. Phase 3.3–3.5

| 阶段 | 状态 | 说明 |
|------|------|------|
| 3.3 | **done** | `docs/web-routing.md` + `browser_act`（默认关）+ skill/Restrictions |
| 3.4 | **done** | eval:smoke harness 任务增量（16+ 项） |
| 3.5 | **done** | mission 通知：plain + rich（TG HTML / Slack Blocks） |
| 3.3.1 | **done** | browser_act 跨步 session |
| 3.2.1 | **done** | explore 并行（`QLING_SUBTASK_PARALLEL`） |

---

## 5. 实施顺序（本轮 PR）

```
1. Spec/Plan 入库 + README 链接
2. T3.0.1–T3.0.4
3. T3.1.1–T3.1.6
4. 测试 + CHANGELOG 小节
5. （时间允许）T3.1.7 / T3.2 起步
```

---

## 6. 验证命令

```bash
cd projects/qling
npm run build
npm run eval:smoke
# 或项目约定的 ci:check
npm test   # 若存在；否则 node --test tests/unit/*.mjs 相关文件
```

Windows：在本机 PowerShell 执行上述命令。

---

## 7. 回滚

- 工具卫生可用 `QLING_TOOL_RESULT_MAX_CHARS=0` 或极大值关闭截断（实现时约定：`0` = 不截断）。
- 技能扫描 `QLING_SKILL_SCAN=off` 关闭（仅调试）。
