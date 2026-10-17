# Brief 03：记忆检索 MMR 多样性重排（qling）
约束：不 commit/push；`npm test` 全绿；在 eval（`src/eval/tasks.ts` 或新增 smoke 任务）中加入"重复记忆"场景前后对比 top-k 去重率。
参考思路：grok-build `crates/codegen/xai-grok-memory/src/mmr.rs` `mmr_rerank`（Apache-2.0）。

## 任务
1. 新建 `src/memory/mmr.ts`：`mmrRerank<T>(items: T[], relevance: number[], text:(t:T)=>string, {lambda=0.7, enabled=true})`。相似度=Jaccard；分词：拉丁字符按 `[^\p{L}\p{N}_]` 切词并小写，CJK 用字符 bigram（Grok 原分词对中文无效，不可照搬）。λ=1 或 n≤1 直接返回。
2. `src/memory.ts` `PersistedMemory` 检索合并排序后（约 292–305 行 `merged` 排序处），取 `limit*3` 候选做 MMR 后截取 limit。环境变量 `QLING_MEMORY_MMR_LAMBDA`（0–1，设 1 关闭）。
3. 不改变 correction 记忆优先：isCorrection 条目先保底入选。

## 测试
`tests/unit/memory-mmr.test.mjs`：3 条近重复 + 2 条不同主题，limit=3 时结果应含 ≥2 个主题；λ=1 顺序不变；中文用例。
