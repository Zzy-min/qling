# 已知风险清单 + 防回归门禁（2026-04-30）

## 已知风险（当前版本关注）
1. `search` 在大目录扫描下可能触发性能压力（已通过 limit 早停与文件大小上限缓解）。
2. `context-compactor` 对异常消息链（孤儿 tool）只能“安全保留”，无法自动修复语义来源。
3. `bash` 输出高噪声命令可能被截断（1MB 上限），需要结合命令级过滤使用。
4. `agent-loop` 观测目前仅日志输出，尚未持久化与结构化汇总。
5. 根目录边界默认收敛后，旧用法中“任意绝对路径”可能被拦截，需要通过 `--workspace`/配置调整根。

## 发布前门禁（必须通过）
1. `npm run build`
2. `npm test`
3. `npm run test:smoke`
4. 人工抽样一条 `search` 与一条 `bash` 错误码输出，确认符合 `Error: [CODE] message`
5. 人工抽样一条 `url_fetch` 私网拦截，确认 Guard 生效并写入审计日志

## 回归关注场景（固定）
1. `search`：`pattern='.' + limit=1` 必须成功截断，禁止 `ENOBUFS`。
2. `search`：`context=0` 与 `context=1` 输出结构必须有可辨差异。
3. `context-compactor`：`recentKeep` 过小仍需保留 assistant(tool_calls) + tool 链。
4. CLI：`run|chat|repl` 与兼容别名分流正确，冲突退出码为 2。
