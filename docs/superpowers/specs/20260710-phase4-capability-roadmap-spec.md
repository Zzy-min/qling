# Spec: 轻灵 Phase 4 能力路线

**日期**: 2026-07-10
**状态**: Accepted（分步实施）
**前置**: Phase 3（Harness Lean / Skills / Sub-agent / browser_act / mission notify）已闭环

---

## 1. 定位

Phase 3 解决了「更省上下文、技能可渐进、可编排、可通知」。
Phase 4 目标：**编码精度与可证明质量**，仍不克隆 OpenCode 全量。

> 轻灵 4.x 方向：本地优先 + 中文工作台 + **可导航代码语义** + **可选真实评测** + 渐进架构演进。

---

## 2. 分期

| 阶段 | 名称 | 说明 | 优先级 |
|------|------|------|--------|
| **4.0** | 路线冻结 | 本 spec + plan 锚点 | P0 |
| **4.1** | 可选 LLM eval | 有 key 时可跑；无 key / 未开开关则 skip | P0 |
| **4.2** | 轻量代码符号导航 | `code_symbols` 工具（regex 符号，非完整 LSP） | P0 |
| **4.3** | 可选 TS 语义查询 | `lsp` 工具 + 进程内 TypeScript LanguageService（`QLING_LSP=1`） | P0 落地 / 多语言延后 |
| **4.4** | 包拆分预备 | `docs/architecture-layers.md` + `scripts/dep-layers.mjs`；`--strict` 待债清零 | P0 文档落地 |

### 明确不做（本阶段）

- Desktop App
- 默认上传代码
- 完整 LSP 语言服务内嵌
- 强制 CI 依赖外部 LLM

---

## 3. 4.1 可选 LLM eval

### 需求

1. `npm run eval:llm` 独立入口，**不进入 `ci:check` 默认链路**。
2. 仅当 `QLING_EVAL_LLM=1` **且** 存在 API key 时执行真实请求；否则全部 skip。
3. 最小任务：
   - 连通性：模型返回固定 token / 短语
   - harness：一次带 tools 的假循环可后续扩展；首版仅 chat 连通

### 验收

- 无 env 时：skip ≥ 1，fail = 0
- 有 env + key + 网络：pass ≥ 1

---

## 4. 4.2 code_symbols

### 需求

1. 工具 `code_symbols`：按名称/模式在工作区内搜索符号。
2. 复用 `extractSymbols`，支持 ts/js/py/go 等已有扩展。
3. 输出：`file:line type name signature`，截断上限防爆上下文。
4. Plan Mode 允许（只读）。

### 验收

- 单元测试：临时目录内造 `foo.ts` 能查到函数
- eval:smoke 增加本地符号检索任务

---

## 5. Phase 4.4 包边界

- 文档：`docs/architecture-layers.md`
- 扫描：`npm run dep:layers`（`scripts/dep-layers.mjs`）
- 规则：分层 rank 仅允许向下依赖；反向边记入债务，暂不 `--strict` 进 CI
- 拆包门槛：`forbiddenCount === 0` + SDK 契约稳定

## 6. 风险

| 风险 | 缓解 |
|------|------|
| LLM eval 不稳定 | 不进默认 CI；超时短；断言宽松 |
| 符号提取假阳性 | 标注「非 LSP」；4.3 进程内 TS LS |
| 大仓扫描慢 | path 限定 + limit + 文件数护栏 |
| 分层误报 | eval 归 adapters；持续校准 layerOf |

---

## 7. 参考

- `docs/superpowers/specs/20260710-agent-ecosystem-refresh-and-phase3-roadmap-spec.md`
- `docs/architecture-layers.md`
- `src/utils/symbol-extractor.ts`
- `src/eval/*`
- `src/tools/lsp.ts`
