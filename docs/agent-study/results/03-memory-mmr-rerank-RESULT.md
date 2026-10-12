# RESULT 03：记忆检索 MMR 多样性重排（范围已缩小为 brief 第 2、3 条）

- 实现者：pi 0.99.2，用 `pi -p` 运行，会话名 `qling-agent-study-03`；协调者没有手写实现代码。
- 没有 commit/push，没有读 .env，没有加依赖，package*.json 未改。
- 改动的区分方法：做 03 之前，把 src/tests/scripts 存了一份快照 `%TEMP%\qling-agent-study\pre03\`，下文的改动都是和这份快照逐文件比出来的。

## 与现有 memory-card-index MMR 的重复程度，以及为什么只做第 2、3 条
- 现有 MMR 在 `src/memory/memory-card-index.ts` 的 `search()` 里（第 238–251 行）：
  - 用于 memory-v2 卡片检索，需要打开 `memory_cards` 特性开关，依赖 SQLite；
  - 相似度 = 余弦 × 0.7 + Jaccard × 0.3，λ 默认 0.7；
  - 代码写在函数内部、没有导出；分词函数 `tokenize` 和 `jaccard` 都是模块私有的，也不对中文做 bigram。
- brief 第 1 条要做的通用 `mmrRerank` 在算法上和它基本重复，都是 λ·相关度 − (1−λ)·与已选结果的最大相似度。所以按已确认的决定**不新建 `src/memory/mmr.ts`**，也**不改 memory-card-index.ts**。
- 真正缺失的是第 2、3 条：默认路径 `PersistedMemory`（`src/memory.ts`）检索合并排序后直接 `slice(limit)`，没有任何多样性处理。本次只补了这一块。
- 实际仍有的重叠：`src/memory.ts` 里新写了一套私有的 Jaccard + MMR，和 card-index 的做法同类，代码没有共享。以后如果要统一，可以再把它抽成第 1 条那样的公共模块。

## pi 改动的文件（以 pre03 快照为基准）
| 文件 | 改动 | 内容 |
|---|---|---|
| `src/memory.ts`（基线里是干净的） | +97 / −11 | 新增几个私有函数：`isCorrectionEntry`、`resolveMmrLambda`、`similarityTokens`、`jaccardSimilarity`、`mmrRerank`。<br>• `PersistedMemory.getRelevant` 在合并排序之后，取 `limit*3` 个候选做 MMR，再截取前 `limit` 个。<br>• 分词：拉丁字符按 `[^\p{L}\p{N}_]` 切词并转小写；汉字加字符 bigram。<br>• λ 读环境变量 `QLING_MEMORY_MMR_LAMBDA`：取值 0–1，非法值回退 0.7；λ=1 或候选数 n≤1 时保持原顺序。<br>• correction 记忆先保底入选，剩余名额再做 MMR。 |
| `tests/unit/memory-mmr.test.mjs` | 新增，5 个用例 | • 3 条近重复 + 2 条不同主题，limit=3 时结果至少含 2 个主题<br>• λ=1 时顺序不变<br>• 非法 λ 回退 0.7<br>• 中文用例<br>• correction 保底 |
| `scripts/eval-memory-dedup.mjs` | 新增 | 确定性的"重复记忆"测评脚本，在临时目录里构造数据，直接 `node` 运行，没有加 npm script |

## 偏离点
1. 范围缩小：没有实现 brief 第 1 条（已确认）。MMR 辅助逻辑写在 `src/memory.ts` 内部。
2. 纠错判定：仓库里没有 `isCorrection` 字段。实际的判定条件是 `source === "user-correction"`，或内容包含 `[用户纠错` 或 `必须遵守`。pi 把这个条件抽成 `isCorrectionEntry`，并让同一文件里原有的两处相同判定也改用它（keyword 打分、`MemoryStore.getRelevant` 里的全局纠错计数）。这属于同一文件内的纯重构，行为不变，相关测试全部通过。
3. eval 的"改动前"数据：brief 要求的"重复记忆"场景原来不存在，是这次新加的。因此"改动前"数据用 `QLING_MEMORY_MMR_LAMBDA=1` 得到：λ=1 时直接返回原顺序，按设计等同于改动前的 `slice(limit)`。此外，改动前后都跑了一遍现有的 `eval:memory`。

## 测试结果
- `npm test`：共 1351，通过 1349，失败 1，跳过 1。
  - 唯一失败是基线就有的 `verify tool applies tail…`。原因：npm 12 打印的 `npm notice run` 横幅把 `console.log('one')` 带进了输出，和本次改动无关。
  - 这一点偏离了"全绿"要求，已确认按"不比基线多出新的失败"验收。
- 新增测试单独跑：5/5 通过。

## eval 前后对比
| eval | 改动前 | 改动后 |
|---|---|---|
| eval-memory-dedup（top-5，含英文、中文近重复簇和 4 个不同主题） | λ=1：uniqueTopicRate 0.4，duplicateRate 0.6，主题依次为 dup-en×4、dup-zh | λ=0.7：uniqueTopicRate 1.0，duplicateRate 0.0，主题依次为 dup-en、dup-zh、db、ui、security |
| eval:memory（卡片检索，500 个查询） | recall@5=1，MRR=1，泄漏均为 0 | 结果相同 |
| eval:smoke | 22/22 | 22/22 |

注：eval:memory 测的是 memory-card-index 的检索路径，这次没有改这条路径，所以结果不变是预期之内的。
