// ============================================================
// Phase 3.1 — Skill 静态安全扫描
// QLING_SKILL_SCAN: on（默认）| warn | off
// ============================================================

export type SkillScanSeverity = "critical" | "high" | "medium" | "low";

export interface SkillScanFinding {
  severity: SkillScanSeverity;
  rule: string;
  detail: string;
}

export interface SkillScanResult {
  ok: boolean;
  findings: SkillScanFinding[];
  mode: "on" | "warn" | "off";
}

interface ScanRule {
  severity: SkillScanSeverity;
  rule: string;
  pattern: RegExp;
  detail: string;
}

const RULES: ScanRule[] = [
  {
    severity: "critical",
    rule: "private-key-pem",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    detail: "疑似私钥 PEM 块",
  },
  {
    severity: "critical",
    rule: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    detail: "疑似 AWS Access Key ID",
  },
  {
    severity: "critical",
    rule: "generic-secret-assignment",
    pattern: /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i,
    detail: "疑似硬编码密钥赋值",
  },
  {
    severity: "high",
    rule: "curl-pipe-shell",
    pattern: /curl\s+[^\n|]*\|\s*(?:ba)?sh/i,
    detail: "curl 管道 shell 远程执行模式",
  },
  {
    severity: "high",
    rule: "irm-iex",
    pattern: /irm\s+[^\n|]*\|\s*iex|Invoke-Expression/i,
    detail: "PowerShell 远程下载执行模式",
  },
  {
    severity: "high",
    rule: "wget-pipe-shell",
    pattern: /wget\s+[^\n|]*\|\s*(?:ba)?sh/i,
    detail: "wget 管道 shell 远程执行模式",
  },
  {
    severity: "high",
    rule: "base64-decode-exec",
    pattern: /base64\s+-d[^;\n]*\|\s*(?:ba)?sh|Buffer\.from\([^)]+,\s*['"]base64['"]\)[^;]{0,80}(exec|spawn|eval)/i,
    detail: "base64 解码后执行模式",
  },
  {
    severity: "medium",
    rule: "eval-call",
    pattern: /\beval\s*\(/,
    detail: "动态 eval 调用",
  },
  {
    severity: "medium",
    rule: "child-process",
    pattern: /child_process\.(exec|spawn|execSync|spawnSync)/,
    detail: "Node child_process 直接调用（需人工确认）",
  },
];

export function resolveSkillScanMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): "on" | "warn" | "off" {
  const raw = String(env.QLING_SKILL_SCAN ?? "on").trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "warn" || raw === "warning") return "warn";
  return "on";
}

export function scanSkillContent(
  content: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): SkillScanResult {
  const mode = resolveSkillScanMode(env);
  if (mode === "off") {
    return { ok: true, findings: [], mode };
  }

  const findings: SkillScanFinding[] = [];
  for (const rule of RULES) {
    if (rule.pattern.test(content)) {
      findings.push({
        severity: rule.severity,
        rule: rule.rule,
        detail: rule.detail,
      });
    }
  }

  const blocking = findings.some((f) => f.severity === "critical" || f.severity === "high");
  if (mode === "warn") {
    return { ok: true, findings, mode };
  }
  return { ok: !blocking, findings, mode };
}

export function formatSkillScanBlockMessage(name: string, result: SkillScanResult): string {
  const lines = result.findings.map(
    (f) => `  - [${f.severity}] ${f.rule}: ${f.detail}`
  );
  return (
    `skill 安全扫描未通过: ${name}\n` +
    lines.join("\n") +
    `\n（策略 QLING_SKILL_SCAN=${result.mode}；调试可设 off/warn）`
  );
}
