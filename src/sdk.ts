// ============================================================
// 轻灵 Qling — SDK 导出面（Phase 2.0 雏形）
//
// 用法:
//   import { AgentLoop, loadQlingConfig, listProviderPresets } from "@qlingzzy/qling";
//
// 说明: 此为可嵌入入口；CLI 入口仍是 dist/index.js (bin: qling)
// ============================================================

export { AgentLoop, type LlmSessionPatch } from "./agent-loop.js";
export {
  loadQlingConfig,
  applyConfigToProcessEnv,
  buildDefaultConfig,
  guardConfigFromEnv,
  type QlingConfig,
  type CliGlobalOptions,
  type LoadedConfig,
} from "./config.js";
export {
  getProviderPreset,
  listProviderPresets,
  resolveModelCandidates,
  type ProviderPreset,
} from "./providers/presets.js";
export {
  getMcpPreset,
  listMcpPresets,
  type McpPreset,
} from "./mcp/presets.js";
export {
  addMcpPresetToStore,
  loadMcpStore,
  saveMcpStore,
  defaultMcpStorePath,
  type McpStoreFile,
} from "./mcp/store.js";
export {
  getRuntimeRootsFromEnv,
  isPathAllowedForWrite,
  checkSensitiveWriteTarget,
  resolveWriteSandboxMode,
  type RuntimeRoots,
  type WriteSandboxMode,
} from "./runtime-paths.js";
export {
  runEvalSuite,
  formatEvalReport,
  type RunEvalOptions,
} from "./eval/runner.js";
export { buildEvalSmokeTasks } from "./eval/tasks.js";
export { buildEvalRepoTasks, materializeBrokenFixture } from "./eval/repo-tasks.js";
export { ALL_TOOLS, buildToolRegistry, dispatch } from "./tools/index.js";
export {
  getPackageVersion,
  formatCliVersion,
  formatDaemonVersion,
} from "./package-version.js";
export type { AgentConfig, Message, ToolDefinition, ToolResult } from "./types.js";
