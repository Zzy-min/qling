import { lookup } from "dns/promises";
import * as net from "net";
import { appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { GuardConfig } from "./config.js";

export type GuardCategory = "network" | "redaction" | "permission" | "rate_limit" | "content_filter";

export interface GuardDecision {
  allowed: boolean;
  reason?: string;
  category?: GuardCategory;
}

export interface GuardAuditEvent {
  tool: string;
  action: "allow" | "deny";
  category?: GuardCategory;
  target?: string;
  reason?: string;
  status?: number;
}

export function redactText(text: string, guard: GuardConfig): string {
  if (!guard.enabled || !guard.redaction.enabled) return text;
  let out = text;

  // Built-in masks
  const builtins: RegExp[] = [
    /\b(sk-[a-zA-Z0-9]{16,})\b/g,
    /\b(Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/g,
    /\b(AKIA[0-9A-Z]{16})\b/g,
  ];
  for (const pattern of builtins) {
    out = out.replace(pattern, "[REDACTED]");
  }

  for (const raw of guard.redaction.patterns) {
    try {
      const re = new RegExp(raw, "g");
      out = out.replace(re, "[REDACTED]");
    } catch {
      // ignore invalid pattern
    }
  }
  return out;
}

export type NetworkGuardMode = "strict" | "open" | "deny";

export function resolveNetworkGuardMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): NetworkGuardMode {
  const raw = String(env.QLING_GUARD_NETWORK_MODE ?? "strict").trim().toLowerCase();
  if (raw === "deny" || raw === "deny_all" || raw === "off" || raw === "none" || raw === "block") {
    return "deny";
  }
  if (raw === "open" || raw === "permissive" || raw === "http") return "open";
  return "strict";
}

export async function checkUrlFetchPolicy(
  url: URL,
  guard: GuardConfig,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<GuardDecision> {
  if (!guard.enabled) return { allowed: true };

  const mode = resolveNetworkGuardMode(env);
  if (mode === "deny") {
    return {
      allowed: false,
      category: "network",
      reason: "network mode=deny: all outbound fetches blocked (QLING_GUARD_NETWORK_MODE)",
    };
  }

  const policy = guard.network.url_fetch;
  const href = url.toString();

  if (mode === "open") {
    // 允许 http/https，仍受私网策略约束；忽略自定义前缀收紧
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        allowed: false,
        category: "network",
        reason: `unsupported protocol in open mode: ${url.protocol}`,
      };
    }
  } else if (!policy.allowed_url_prefixes.some((prefix) => href.startsWith(prefix))) {
    return {
      allowed: false,
      category: "network",
      reason: `url not allowed by prefix policy: ${href}`,
    };
  }

  if (policy.deny_private_ips) {
    const host = url.hostname;
    if (isLiteralPrivateHost(host)) {
      return {
        allowed: false,
        category: "network",
        reason: `private ip host blocked: ${host}`,
      };
    }

    try {
      const ips = await lookup(host, { all: true });
      for (const ip of ips) {
        if (isPrivateIp(ip.address)) {
          return {
            allowed: false,
            category: "network",
            reason: `resolved private ip blocked: ${ip.address}`,
          };
        }
      }
    } catch {
      // DNS failure is handled by caller fetch path.
    }
  }

  return { allowed: true };
}

export async function appendGuardAudit(guard: GuardConfig, event: GuardAuditEvent): Promise<void> {
  if (!guard.enabled) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });
  try {
    const targetPath = guard.audit.jsonl_path;
    await mkdir(dirname(targetPath), { recursive: true });
    await appendFile(targetPath, line + "\n", "utf-8");
  } catch {
    // 审计写入失败不阻断主流程
  }
}

function isLiteralPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  if (net.isIP(hostname) === 0) return false;
  return isPrivateIp(hostname);
}

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map((x) => Number(x));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // link-local
  }
  return false;
}
