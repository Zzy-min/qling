# Implementation Plan（P1 修复）

## 范围
- `src/tools/search.ts`
- `src/context-compactor.ts`

## 步骤
1. 重构 `search`：
   - 引入目录递归遍历与 glob 过滤工具函数。
   - 实现全局 `limit` 早停。
   - 实现 `context` 上下文行拼装。
2. 修正 `context-compactor` tool chain 保护：
   - 调整 recent 回溯条件与边界处理。
3. 验证：
   - `npm run build`
   - 复现用例回归：
     - `search content` 高匹配 + 小 `limit`
     - `search context=0/1`
     - compactor tool chain 最小复现
4. 输出结果：
   - 汇总修复点、验证命令与结论。
