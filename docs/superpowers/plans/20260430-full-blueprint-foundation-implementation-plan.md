# `qling` 全量蓝图实施计划（Foundation v1）

## Step 1: 配置平面
- 新增统一配置模块：默认值、配置文件读取、环境变量映射、CLI 覆盖合并。
- 新增 `${ENV_VAR}` 展开器和缺失变量告警。
- 新增 `QLING_*` 映射规则并固化测试。

## Step 2: 运行模式平面
- 扩展 CLI 为 `run|chat|repl` 子命令。
- 保留旧入口兼容并增加 deprecation 提示。
- 将 `--workspace`、`--no-workspace`、`--file-cache-dir`、`--file-state-dir` 接入运行时。

## Step 3: 路径根与工具治理
- 新增路径别名解析模块（`workspace_dir/...`、`file_cache_dir/...`、`file_state_dir/...`）。
- 改造 read/write/search/bash 使用统一路径解析。
- 补齐路径根相关单测。

## Step 4: Guard M1 + `url_fetch`
- 新增 Guard 配置模型和网络策略检查（前缀白名单、私网拦截、重定向开关）。
- 新增 `url_fetch` 工具并注册。
- 新增脱敏逻辑并验证输出。

## Step 5: 错误语义与测试门禁
- 在 `ToolResult` 中增加结构化错误字段，保持终端字符串兼容。
- 新增“关键行为矩阵 smoke”。
- 更新 README 与能力矩阵文档。

## Step 6: 验证
- `npm run build`
- `npm test`
- `npm run test:smoke`
- 人工抽样：`run/chat/repl`、`url_fetch`、路径别名解析。
