# 可选 OTEL 元数据导出

轻灵默认不启动 OpenTelemetry，也不会为观测目的联网。外部 trace 导出需要同时满足：

1. 配置 `metrics.otel.enabled: true` 或环境变量 `QLING_METRICS_OTEL_ENABLED=true`；
2. 当前进程显式设置 `QLING_OTEL_EXPORT_CONFIRM=metadata-only`；
3. 配置合法的 OTLP/HTTP trace endpoint。

PowerShell 示例：

```powershell
$env:QLING_METRICS_OTEL_ENABLED = "true"
$env:QLING_OTEL_EXPORT_CONFIRM = "metadata-only"
$env:QLING_METRICS_OTEL_ENDPOINT = "http://127.0.0.1:4318/v1/traces"
qling doctor
qling
```

也可使用标准的 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`，或用
`OTEL_EXPORTER_OTLP_ENDPOINT` 配置基础地址（轻灵会追加 `/v1/traces`）。认证 header
只从 `OTEL_EXPORTER_OTLP_TRACES_HEADERS` / `OTEL_EXPORTER_OTLP_HEADERS` 读取，不会显示在
`qling config`、`qling doctor` 或错误日志中。

## 导出边界

只导出两个固定 span：`qling.run` 和 `qling.tool`。属性限于轻灵版本、匿名 session
哈希、运行/工具状态、通用工具类别、固定失败分类、固定阶段和耗时。

不会导出用户任务、模型输入输出、系统 Prompt、工具原名、工具参数或输出、文件与工作区
路径、命令、URL、API Key、Hook 内容和原始异常。轻灵不启用 HTTP、文件系统或命令等自动
插桩。导出失败会停用当前进程的后续 OTEL 发送，不阻断 Agent 任务和本地 metrics。

关闭时移除 `QLING_METRICS_OTEL_ENABLED` 或设为 `false`。`qling doctor` 只读取并脱敏显示
状态，不会联系 collector。
