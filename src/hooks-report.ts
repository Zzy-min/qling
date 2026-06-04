import type { GuardConfig } from "./config.js";

export interface LocalHooksReport {
  guardEnabled: boolean;
  permissionDefault: "allow" | "deny" | "ask";
  permissionRuleCount: number;
  rateLimitEnabled: boolean;
  rateLimitMaxPerMinute: number;
  classifierEnabled: boolean;
  contentFilterEnabled: boolean;
  piiDetection: boolean;
  injectionDetection: boolean;
  customContentPatternCount: number;
  failureHookEnabled: boolean;
  auditPath: string;
  redactionEnabled: boolean;
  redactionPatternCount: number;
  urlFetchPrefixCount: number;
  denyPrivateIps: boolean;
  followRedirects: boolean;
}

function boolStatus(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

function safePath(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

export function buildLocalHooksReport(guard: GuardConfig): LocalHooksReport {
  return {
    guardEnabled: Boolean(guard.enabled),
    permissionDefault: guard.permissions?.default ?? "allow",
    permissionRuleCount: guard.permissions?.rules?.length ?? 0,
    rateLimitEnabled: Boolean(guard.rate_limit?.enabled),
    rateLimitMaxPerMinute: Number(guard.rate_limit?.max_per_minute ?? 0),
    classifierEnabled: true,
    contentFilterEnabled: Boolean(guard.content_filter?.enabled),
    piiDetection: Boolean(guard.content_filter?.pii_detection),
    injectionDetection: Boolean(guard.content_filter?.injection_detection),
    customContentPatternCount: guard.content_filter?.custom_patterns?.length ?? 0,
    failureHookEnabled: true,
    auditPath: safePath(guard.audit?.jsonl_path),
    redactionEnabled: Boolean(guard.redaction?.enabled),
    redactionPatternCount: guard.redaction?.patterns?.length ?? 0,
    urlFetchPrefixCount: guard.network?.url_fetch?.allowed_url_prefixes?.length ?? 0,
    denyPrivateIps: Boolean(guard.network?.url_fetch?.deny_private_ips),
    followRedirects: Boolean(guard.network?.url_fetch?.follow_redirects),
  };
}

export function formatLocalHooksReport(report: LocalHooksReport): string[] {
  return [
    "",
    "🪝 本地 Hooks 状态",
    "-----------------------------------------",
    `Guard     : ${boolStatus(report.guardEnabled)}`,
    `PreToolUse: permission=${report.permissionDefault} rules=${report.permissionRuleCount} rate_limit=${boolStatus(report.rateLimitEnabled)}(${report.rateLimitMaxPerMinute}/min) classifier=${boolStatus(report.classifierEnabled)}`,
    `PostToolUse: content_filter=${boolStatus(report.contentFilterEnabled)} pii=${boolStatus(report.piiDetection)} injection=${boolStatus(report.injectionDetection)} custom=${report.customContentPatternCount}`,
    `Failure   : PostToolUseFailure=${boolStatus(report.failureHookEnabled)}`,
    `Audit     : ${report.auditPath}`,
    `Redaction : ${boolStatus(report.redactionEnabled)} patterns=${report.redactionPatternCount}`,
    `Network   : url_fetch prefixes=${report.urlFetchPrefixCount} deny_private_ips=${report.denyPrivateIps} follow_redirects=${report.followRedirects}`,
    "-----------------------------------------",
    "边界      : 只读取当前本地 hooks/guard 配置；不运行 hooks、不读取 audit 内容、不调用模型、不联网、不写配置；custom patterns 只显示数量。",
    "",
  ];
}
