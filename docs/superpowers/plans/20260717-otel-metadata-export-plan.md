# 轻灵 G5.6 OTEL 元数据导出实施计划

1. 建立独立 `otel-config` 解析器，实施双 opt-in、endpoint 校验和 header 脱敏。
2. 使用官方 OpenTelemetry trace SDK 与 OTLP/HTTP exporter，手动创建白名单 span，禁止自动插桩。
3. 将 `ExecutionEventBus` 的 run/tool 生命周期映射为 span，并在 Agent shutdown 时有界关闭。
4. 在 QlingConfig、环境变量映射、config report 与 doctor 中显示 off/armed/enabled/invalid 状态，不展示凭据。
5. 以 fake exporter 和本机 OTLP 接收端验证默认零网络、元数据白名单、父子关联、发送失败不阻断，再跑完整门禁。
