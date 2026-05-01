# P1 修复设计说明（search + context-compactor）

## 背景
本次修复聚焦 3 个已确认 P1 问题：

1. `search` 在子进程输出全部缓冲后才应用 `limit`，会触发 `ENOBUFS`。
2. Windows 分支将 `context` 错误映射为 `findstr /C:`，语义错误。
3. `ContextCompactor` 的 tool chain 保护条件恒不成立，可能留下孤儿 `tool` 消息。

## 目标
- `search` 必须在采集阶段执行全局 `limit`，避免大输出缓冲溢出。
- `search` 在 Windows/Linux 上都要保持一致的 `context` 语义。
- `ContextCompactor` 必须保证 recent 区间中若包含 `tool`，则保留对应 `assistant(tool_calls)`。

## 方案
### A. `src/tools/search.ts`
- 用 Node 原生文件遍历 + 行级匹配替代外部 `grep/findstr` 输出缓冲路径。
- 内容搜索：
  - 支持 `pattern`（JS RegExp）。
  - 支持 `context`（前后文行）。
  - 支持 `file_glob` 过滤。
  - 命中条目全局累计，达到 `limit` 即停止遍历。
- 文件搜索：
  - 用 glob-to-regex 匹配文件名。
  - 全局达到 `limit` 即停止遍历。

### B. `src/context-compactor.ts`
- 修正 tool chain 保护逻辑：若 recent 里出现 `tool`，向外回溯到最近的 `assistant(tool_calls)`；找不到则退化为从该 `tool` 开始保留，避免切断链路。

## 验收标准
- `npm run build` 通过。
- `search` 在高匹配场景（如 `pattern='.'`, `limit=1`）不再报 `ENOBUFS`。
- `search` 的 `context=1` 与 `context=0` 语义正确区分。
- compactor 在 `recentKeep` 较小场景下不再输出孤儿 `tool` 消息。
