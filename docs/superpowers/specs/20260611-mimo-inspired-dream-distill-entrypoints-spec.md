# MiMo-Inspired Dream/Distill Entrypoints Spec

## 背景

MiMo-Code 的 README 把 `/dream` 和 `/distill` 作为显式自改进入口：前者把近期会话沉淀为长期项目记忆，后者把重复工作流沉淀为可复用实践。qling 已有 AutoDream、MemoryStore 和 distilled practices 报告，但用户缺少直接、可发现的 slash 入口。

## 目标

- 新增 `/dream [count]`，从当前会话的 user/assistant 消息中按本地启发式抽取记忆并写入本地 MemoryStore。
- `/dream` 不调用模型、不联网、不读取工具消息正文，输出只包含数量和边界说明，不打印抽取正文。
- 新增 `/distill [count]`，展示已有本地 distilled practices，等价于 `/memory practices [count]` 的更直观入口。
- 新入口出现在 slash 帮助中，便于发现。

## 非目标

- 不复制 MiMo-Code 的托管服务、OAuth、voice 或 Max Mode。
- 不改写 AutoDream 阈值、LLM dream 默认策略或 cognitive schema。
- 不从历史 session 文件批量读取正文。

## 验收标准

- `/dream` 有可抽取内容时写入本地记忆并保存，输出不包含原始正文。
- `/dream` 没有可抽取内容时给出本地无新记忆提示。
- `/dream` 不读取 role=tool 的消息。
- `/distill` 输出本地 distilled practices，不读取会话正文。
- 单元测试覆盖 slash 入口和隐私边界。
