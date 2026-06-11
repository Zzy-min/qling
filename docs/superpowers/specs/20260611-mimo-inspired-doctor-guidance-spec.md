# MiMo-Inspired Doctor Guidance Spec

## 背景

MiMo-Code 的 README 强调首次启动配置引导、项目/全局配置目录、跨会话记忆和本地状态透明。qling 已经有 `/doctor`、`config`、`storage`、`privacy` 等本地报告能力，因此本次不复制 MiMo-Code 的 monorepo 架构或托管服务能力，只借鉴“用户能一眼知道下一步做什么”的入口体验。

## 目标

- `doctor` 报告在检查失败或警告时给出明确下一步建议。
- 建议必须保持 local-first：只提示本地命令或本地路径，不引导上传诊断数据。
- 建议必须避免泄漏密钥、endpoint token、MCP headers 或权限规则原因。
- 输出继续兼容现有 slash command 和 CLI doctor 路径。

## 非目标

- 不新增在线服务、OAuth、托管匿名通道或 MiMo Auto 类能力。
- 不引入新的配置文件格式或迁移 `.qling` 数据目录。
- 不改变现有 `/doctor` 的检查项语义，只增强可执行提示。

## 验收标准

- 缺失 API key 时，doctor 输出包含 `qling setup` 建议。
- 本地 state/cache 目录缺失时，doctor 输出包含首次运行会初始化本地数据的说明。
- daemon 不可达时，doctor 输出包含 `qling daemon start` 建议。
- 健康报告不输出空建议区。
- 单元测试覆盖新增建议，并验证不泄漏敏感值。
