# 轻灵 G5.6 OTEL 元数据导出规格

## 目标

为需要企业观测的用户提供可选 OTLP/HTTP trace 导出，同时保持轻灵默认本地优先：未完成双重显式授权时不加载 OTEL SDK、不创建 exporter、不发起任何观测网络请求。

## 启用契约

- 第一层：`metrics.otel.enabled: true`（或 `QLING_METRICS_OTEL_ENABLED=true`）。
- 第二层：进程环境变量 `QLING_OTEL_EXPORT_CONFIRM=metadata-only`。
- 必须配置 `metrics.otel.endpoint`、`QLING_METRICS_OTEL_ENDPOINT`、`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_ENDPOINT`；不提供隐式远程默认值。
- endpoint 仅允许 `http:` / `https:`，禁止 URL 用户名、密码和 query/hash。

## 数据边界

允许导出的属性仅限固定白名单：轻灵版本、匿名 session 哈希、运行/工具状态、阶段、失败分类、耗时和通用工具类别。

以下内容禁止进入 span 名称、属性、事件或错误记录：用户任务、模型输入输出、系统 Prompt、工具名称、参数与输出、文件路径、工作区路径、命令、URL、API Key、Hook 内容和原始异常消息。

## 生命周期与失败处理

- 只创建 `qling.run` 和 `qling.tool` span；工具 span 关联所属 run。
- 使用批处理 exporter，并在 shutdown 时有界 flush。
- exporter 初始化或发送失败只输出脱敏状态并停用本次外部导出，不影响 Agent 任务、恢复控制器或本地 metrics。
- 不启用 HTTP/axios/文件系统等自动插桩，避免请求体、URL 或本机路径被第三方 instrumentation 捕获。

## 验收

- 默认及单层授权均不导出；双层授权和合法 endpoint 才启用。
- OTLP 测试接收端只能观察到白名单属性，注入到任务、路径、工具名和错误文本中的 canary 均不得出现。
- endpoint/header 在 config、doctor 和错误日志中保持脱敏。
- 通过定向单测、真实本地 OTLP/HTTP 冒烟、`npm run ci:check`、恢复评测与 `git diff --check`。
