# Brief 04：MCP 输出落盘 + 只读标记纠正 + Plan Mode 拦截（qling）
约束：只改本地工作区，不 commit/不 push。先在改动前跑 `npm test` 记录基线失败数，改后不得新增失败；`npm run eval:smoke`、`npm run eval:tasks` 前后对比。
参考（思路，TS 重写，不拷贝）：grok-build `crates/codegen/xai-grok-tools/src/util/mcp_truncate.rs`（`truncate_mcp_text`、`McpDumpKind`、`sanitized_stem`）、`types/context.rs` `mcp_max_output_bytes_for`（Apache-2.0）。

## 任务
1. `src/mcp/registry.ts` `truncateMcpResult` 改为 async `spillMcpResult(result, {maxBytes, dumpDir, callId})`：
   - 超限时把全文写到 `<runtimeRootDir>/sessions/<sessionId>/mcp/<sanitize(callId)>.<json|txt>`（callId 仅保留 `[A-Za-z0-9_-]`，其它替换为 `_`；路径必须在 dumpDir 内）；
   - 内联：UTF-8 安全前缀（用 Buffer.subarray 后 `TextDecoder` fatal:false 去掉尾部替换字符，替换现在的逐字符 while 回退）+ `\n[MCP 输出已截断：显示前 X / 共 Y。完整内容：<path>。<提示>]`；
   - 提示：内容可 JSON.parse 且有 >2000B 的行 → "单行 JSON，read/grep 无效，请用 bash + node -e/jq 查询"；JSON → "用 jq 查询"；长行文本 → "用 bash 切片"；
   - 写盘失败 → 退回旧行为，不抛错；meta 增加 `spillPath`。
2. per-server 上限：`MCPServerConfig.max_output_bytes?`，优先于 `QLING_MCP_MAX_OUTPUT_BYTES`。
3. `src/mcp/types.ts` `MCPToolDefinition` 增加 `annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }`，`client.ts:105` 处透传；`bridge.ts` 改为 `readOnly: t.annotations?.readOnlyHint === true`、`destructive: t.annotations?.destructiveHint === true`（未声明默认非只读）。
4. `src/pipeline/hooks.ts` Plan Mode：对 `mcp__*`（readOnly 的除外）与 `use_tool` 加硬拒绝规则（确认 PermissionMatrix 的 tool_pattern 是否支持通配；不支持则在 planModeRules 外单独判断）。

## 测试（tests/unit/mcp-spill.test.mjs 等）
超限落盘且文件全文一致；恰好等于上限不截断；callId 含 `../` 不越界；中文多字节边界无乱码；写盘失败回退；annotations 映射；Plan Mode 下 `mcp__x__write` deny、readOnlyHint 工具放行。
## 度量
eval 前后通过率；手工构造 100KB JSON MCP 输出，确认模型能按提示用 bash 读回（可记入 eval:tasks 新任务）。
