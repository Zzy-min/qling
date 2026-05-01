# `qingling` 稳定性优先落地实施计划（执行清单）

## Phase 1：基线稳态
1. 新增测试目录与回归用例：
   - `search`：limit 截断、context 差异、glob 过滤、Windows 路径兼容。
   - `context-compactor`：tool chain 保护（含退化场景）。
   - `agent-loop`：最小工具链 smoke。
2. 新增脚本：
   - `npm test`（构建后跑单测）
   - `npm run test:smoke`（构建后跑 smoke）
3. 新增 CI：
   - GitHub Actions 最低门槛：`build + test + test:smoke`
4. 更新 README：
   - 增加“稳定性保障”章节与本地验证命令。

## Phase 2：可靠性增强（本轮可落地子集）
1. 新增工具错误语义辅助模块，统一错误格式。
2. 改造 `search/read/write/bash`：
   - 输入合法性校验
   - 超时/超长/超大文件等边界处理
   - 统一错误码输出
3. 改造 `agent-loop`：
   - 记录并打印每轮工具数、失败数/失败率、压缩触发计数、重试计数。

## 文档与门禁
1. 新增风险与防回归清单文档。
2. 新增外部资源映射与“可选适配点”说明文档（不引入框架）。

## 验证
1. `npm run build`
2. `npm test`
3. `npm run test:smoke`
4. 抽样运行关键复现场景（search + compactor）
