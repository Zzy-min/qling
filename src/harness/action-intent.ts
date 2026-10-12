import * as path from "node:path";
import type { ToolSideEffect } from "../runtime/types.js";

export type TrustLabel =
  | "trusted_instruction"
  | "workspace_data"
  | "remote_data"
  | "secret";

export interface ActionIntent {
  tool: string;
  allowedEffects: ToolSideEffect[];
  allowedTargets: string[];
  sourceEventIds: string[];
  expiresAt: number;
  trust: TrustLabel;
}

export interface ActionAuthorization {
  allowed: boolean;
  reason: string;
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function authorizeActionIntent(input: {
  intent: ActionIntent;
  tool: string;
  effect: ToolSideEffect;
  target?: string;
  now?: number;
}): ActionAuthorization {
  const now = input.now ?? Date.now();
  if (input.effect === "none") return { allowed: true, reason: "read-only action" };
  if (input.intent.trust !== "trusted_instruction") {
    return { allowed: false, reason: "side effects require a trusted instruction source" };
  }
  if (input.intent.expiresAt <= now) return { allowed: false, reason: "action intent expired" };
  if (input.intent.tool !== "*" && input.intent.tool !== input.tool) {
    return { allowed: false, reason: `intent does not authorize tool ${input.tool}` };
  }
  if (!input.intent.allowedEffects.includes(input.effect)) {
    return { allowed: false, reason: `intent does not authorize ${input.effect} effects` };
  }
  const target = input.target;
  if (target && !input.intent.allowedTargets.some((root) => isWithin(root, target))) {
    return { allowed: false, reason: `target is outside the authorized workspace: ${target}` };
  }
  return { allowed: true, reason: "authorized by current user task" };
}

export function deriveUserActionIntent(input: {
  userMessage: string;
  workspaceDir: string;
  sourceEventId: string;
  now?: number;
}): ActionIntent {
  const message = input.userMessage.toLowerCase();
  const allowedEffects: ToolSideEffect[] = ["process"];
  if (/\b(?:fix|implement|edit|write|change|add|remove|refactor|build|commit|push)\b|修复|实现|修改|写入|添加|删除|重构|构建|更新|处理|提交|推送/.test(message)) {
    allowedEffects.push("workspace");
  }
  if (/\b(?:browse|fetch|download|install|clone|pull|curl|wget|http|github)\b|搜索|联网|下载|安装|拉取/.test(message)) {
    allowedEffects.push("network");
  }
  if (/\b(?:push|publish|deploy|submit|send|merge)\b|推送|发布|部署|提交到|发送/.test(message)) {
    allowedEffects.push("external");
  }
  return {
    tool: "*",
    allowedEffects,
    allowedTargets: [path.resolve(input.workspaceDir)],
    sourceEventIds: [input.sourceEventId],
    expiresAt: (input.now ?? Date.now()) + 60 * 60 * 1000,
    trust: "trusted_instruction",
  };
}
