# Dream Duplicate Guard Plan

## 步骤

1. 在 `tests/unit/slash-commands.test.mjs` 增加 RED 测试：全重复候选不写入、不保存；部分重复候选只写新增项。
2. 在 `src/commands/dream.ts` 中读取 `memoryStore.exportPersisted()`，构建现有 content 集合。
3. 将抽取候选按 content 完全匹配去重，仅对新增候选调用 `memoryStore.add()`。
4. 跑定向测试、完整 `npm run ci:check`、旧名扫描和 diff 检查。
5. 暂存审计后提交并推送。

## 风险控制

- 如果 MemoryStore 不支持 `exportPersisted()`，保持原有写入行为，避免破坏测试替身或第三方兼容对象。
- 去重不输出候选正文，只输出新增数量和本地边界。
