// ============================================================
// 轻灵 - Guard M2: 内容过滤器
// PII 检测 + Prompt Injection 扫描
// ============================================================

export interface ContentFilterResult {
  blocked: boolean;
  reason?: string;
  matches?: string[];
}

// --- PII Patterns ---

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; mask: string }> = [
  // 中国手机号（1开头11位）
  { name: "phone_cn", pattern: /1[3-9]\d{9}/g, mask: "***phone***" },
  // 中国身份证号（18位）
  { name: "id_card_cn", pattern: /\d{6}(19|20)\d{9}[0-9Xx]/g, mask: "***id***" },
  // 邮箱地址
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, mask: "***email***" },
  // 信用卡号（13-19位数字，可能有空格/横线分隔）
  { name: "credit_card", pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g, mask: "***card***" },
];

// --- Prompt Injection Patterns ---

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?prior\s+(instructions|prompts)/i,
  /forget\s+(everything|all)\s+(you|about)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /new\s+instructions?:/i,
  /system\s*:\s*you\s+are/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /override\s+(safety|security|content)\s+(filter|policy)/i,
];

// --- Custom Patterns ---

let customPatterns: RegExp[] = [];

export function setCustomPatterns(patterns: string[]): void {
  customPatterns = patterns
    .map((p) => {
      try {
        return new RegExp(p, "i");
      } catch {
        return null;
      }
    })
    .filter((p): p is RegExp => p !== null);
}

// --- Filter Functions ---

export function filterPII(text: string): ContentFilterResult {
  const matches: string[] = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found.map((m) => name + ": " + m));
    }
  }
  if (matches.length > 0) {
    return { blocked: true, reason: "PII detected", matches };
  }
  return { blocked: false };
}

export function filterInjection(text: string): ContentFilterResult {
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const found = text.match(pattern);
    if (found) {
      matches.push(found[0]);
    }
  }
  if (matches.length > 0) {
    return { blocked: true, reason: "prompt injection pattern detected", matches };
  }
  return { blocked: false };
}

export function filterCustom(text: string): ContentFilterResult {
  const matches: string[] = [];
  for (const pattern of customPatterns) {
    const found = text.match(pattern);
    if (found) {
      matches.push(found[0]);
    }
  }
  if (matches.length > 0) {
    return { blocked: true, reason: "custom pattern matched", matches };
  }
  return { blocked: false };
}

export function applyContentFilter(
  text: string,
  options: {
    pii?: boolean;
    injection?: boolean;
    custom?: boolean;
  } = {}
): ContentFilterResult {
  const { pii = true, injection = true, custom = true } = options;

  if (pii) {
    const r = filterPII(text);
    if (r.blocked) return r;
  }
  if (injection) {
    const r = filterInjection(text);
    if (r.blocked) return r;
  }
  if (custom) {
    const r = filterCustom(text);
    if (r.blocked) return r;
  }
  return { blocked: false };
}
