# MiMo-Inspired Dream/Distill Entrypoints Plan

## 步骤

1. 在 `tests/unit/slash-commands.test.mjs` 增加 RED 测试：`/dream` 保存本地抽取记忆、无候选时不写入、忽略 tool 消息；`/distill` 委托本地 practices 报告。
2. 新增 `src/commands/dream.ts`，复用 `extractDreamMemories()`，只处理当前 `agentLoop.getMessagesSnapshot()` 的 user/assistant 消息。
3. 新增 `src/commands/distill.ts`，复用 `listLocalMemoryPractices()` 和 formatter。
4. 将两个命令注册到 `COMMANDS`，更新 `/help` 快速列表和 focused help topic。
5. 运行定向测试、完整 `npm run ci:check`、旧名扫描、diff 检查、暂存审计后提交并推送。

## 风险控制

- `/dream` 不输出候选正文，避免把用户消息或路径直接打印到终端。
- `/dream` 不读 saved session 文件，避免把历史正文引入新路径。
- `/distill` 继续走已有只读 cognitive DB 报告，不新增写入逻辑。
