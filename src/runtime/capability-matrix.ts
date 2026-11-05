// ============================================================
// 运行能力矩阵：显式列出“默认模式”与“候选开关”
// 对照 Grok 的可验证边界：实现存在 ≠ 默认启用 ≠ 已验收
// ============================================================

export type RuntimeToggle = "on" | "off";

export interface RuntimeCapability {
  id: string;
  label: string;
  enabled: boolean;
  detail: string;
}

function toggle(value: string | undefined): RuntimeToggle {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim()) ? "on" : "off";
}

export function getRuntimeCapabilityMatrix(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): RuntimeCapability[] {
  const actor = String(env.QLING_RUNTIME_MODE ?? "legacy").trim().toLowerCase() === "actor";
  return [
    {
      id: "runtime",
      label: `runtime=${actor ? "actor" : "legacy"}`,
      enabled: actor,
      detail: "actor 提供事件日志/租约/恢复；legacy 为默认对话循环",
    },
    {
      id: "workflow_runtime",
      label: `workflow_runtime=${toggle(env.QLING_FEATURES_WORKFLOW_RUNTIME)}`,
      enabled: toggle(env.QLING_FEATURES_WORKFLOW_RUNTIME) === "on",
      detail: "审批/工具状态机接入运行层",
    },
    {
      id: "tool_capabilities",
      label: `tool_capabilities=${toggle(env.QLING_FEATURES_TOOL_CAPABILITIES)}`,
      enabled: toggle(env.QLING_FEATURES_TOOL_CAPABILITIES) === "on",
      detail: "按调用声明副作用/并发能力",
    },
    {
      id: "reliability_v2",
      label: `reliability_v2=${toggle(env.QLING_FEATURES_RELIABILITY_V2)}`,
      enabled: toggle(env.QLING_FEATURES_RELIABILITY_V2) === "on",
      detail: "租约 fencing、后台账本、未知结果恢复",
    },
    {
      id: "trust_boundary",
      label: `trust_boundary=${toggle(env.QLING_FEATURES_TRUST_BOUNDARY)}`,
      enabled: toggle(env.QLING_FEATURES_TRUST_BOUNDARY) === "on",
      detail: "工作区信任边界与项目级能力加载",
    },
    {
      id: "controlled_subagents",
      label: `controlled_subagents=${toggle(env.QLING_FEATURES_CONTROLLED_SUBAGENTS)}`,
      enabled: toggle(env.QLING_FEATURES_CONTROLLED_SUBAGENTS) === "on",
      detail: "受控 implement 子代理与 owned_paths",
    },
  ];
}

export function formatRuntimeCapabilityLines(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string[] {
  return getRuntimeCapabilityMatrix(env)
    .filter((item) => item.id === "runtime" || item.enabled)
    .map((item) => `${item.label} · ${item.detail}`);
}
