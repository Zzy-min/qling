# `qling` 全量提升蓝图实施设计（Foundation v1）

## 目标
- 将“全量蓝图”转化为可运行的第一阶段工程基座，覆盖 Phase 0-2 的核心交付。
- 在不迁移技术栈的前提下，建立统一配置平面、运行模式平面、目录根平面、安全治理平面。
- 为 Phase 3-5 预留可演进接口（记忆 WAL、MCP/Subtask、通道化）的结构化扩展点。

## 本轮范围（落地）
1. 统一配置模型（优先级固定）：
   - `CLI flags > QLING_* 环境变量 > config 文件 > 默认值`
   - 支持 `--config`，支持 JSON/YAML 配置文件。
   - 支持配置内 `${ENV_VAR}` 展开与缺失变量 warning。
2. 统一运行根目录：
   - `workspace_dir`、`file_cache_dir`、`file_state_dir`
   - read/write/search/bash 支持根别名路径解析。
3. CLI 子命令语义：
   - 新增 `run | chat | repl`
   - 保留旧入口兼容（`--tui/--repl/--once/位置参数`），输出 deprecation 提示。
4. Guard M1（最小版）：
   - 网络访问前缀白名单
   - 私网 IP 拦截
   - 重定向开关
   - 文本脱敏
5. 新增 `url_fetch` 工具：
   - 受 Guard 策略约束
   - 输出与错误语义统一
6. 错误模型升级：
   - 工具返回结构补充 machine-friendly 错误字段
   - 终端文案保持 `Error: [CODE] message` 兼容
7. Phase 0 交付物：
   - 能力现状矩阵文档
   - 关键契约 smoke 测试集合

## 本轮非目标
- 不在本轮实现 Telegram/Slack/Console 长运行通道。
- 不在本轮实现完整 WAL 投影 worker（只预留配置与接口挂点）。
- 不在本轮实现 ACP/MCP 的完整生命周期连接器（只预留运行时扩展位）。

## 验收标准
- `npm run build`
- `npm test`
- `npm run test:smoke`
- 新增测试覆盖：
  - 配置优先级解析
  - 目录根与别名路径解析
  - `run/chat/repl` 启动矩阵
  - `url_fetch` Guard 行为
  - 错误语义兼容性
