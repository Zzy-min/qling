export interface PrematureStopMatch {
  pattern: string;
}

interface PrematureStopPattern {
  pattern: string;
  expression: RegExp;
}

/**
 * Last non-empty paragraph only. "等你确认后" is intentionally not a give-up:
 * the wait pattern requires 完成/跑完后再, not a bare confirmation request.
 */
const PREMATURE_STOP_PATTERNS: readonly PrematureStopPattern[] = [
  { pattern: "cannot_continue", expression: /我无法继续/ },
  { pattern: "cannot_complete", expression: /无法完成/ },
  { pattern: "stop_here", expression: /先到这里/ },
  { pattern: "pause_here", expression: /暂停在此/ },
  { pattern: "please_manual", expression: /请你(?:手动|自行|运行|提供)/ },
  { pattern: "wait_until_done", expression: /等.{0,20}(?:完成|跑完)后再/ },
  { pattern: "committed", expression: /已提交.{0,10}commit/i },
  { pattern: "unable_to_proceed", expression: /I can(?:not|'t|’t) proceed/i },
  { pattern: "giving_up", expression: /(?<!not\s)giving up/i },
  { pattern: "stopping_here", expression: /stopping here/i },
];

export function lastNonEmptyParagraph(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const parts = normalized.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? "";
}

export function detectPrematureStop(text: string): PrematureStopMatch | null {
  const paragraph = lastNonEmptyParagraph(text);
  if (!paragraph) return null;
  for (const candidate of PREMATURE_STOP_PATTERNS) {
    if (candidate.expression.test(paragraph)) {
      return { pattern: candidate.pattern };
    }
  }
  return null;
}
