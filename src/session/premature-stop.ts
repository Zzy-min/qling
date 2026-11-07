export interface PrematureStopMatch {
  pattern: string;
}

export interface PrematureStopDetailedMatch extends PrematureStopMatch {
  category:
    | "unable_to_proceed"
    | "giving_up"
    | "stopping_here"
    | "agents_in_flight"
    | "check_back_later"
    | "verdict_line"
    | "commit_push_pr"
    | "ready_for_review"
    | "please_deflection";
  matchedText: string;
}

interface PrematureStopPattern {
  pattern: string;
  category: PrematureStopDetailedMatch["category"];
  expression: RegExp;
  lineAnchored?: boolean;
  rejectUserSubject?: boolean;
}

/**
 * Strip leading Markdown list / header / bold / quote wrappers on a line,
 * mirroring Grok Build's `strip_leading_markdown` in `goal_stop_detector.rs`.
 */
export function stripLeadingMarkdown(line: string): string {
  let rest = line.trimStart();
  while (rest.length > 0) {
    if (rest.startsWith(">")) {
      rest = rest.slice(1).trimStart();
      continue;
    }
    if (rest.startsWith("#")) {
      rest = rest.replace(/^#+\s*/, "");
      continue;
    }
    if (/^[-*+]\s+/.test(rest)) {
      rest = rest.replace(/^[-*+]\s+/, "");
      continue;
    }
    if (/^\d+[.)]\s+/.test(rest)) {
      rest = rest.replace(/^\d+[.)]\s+/, "");
      continue;
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      rest = rest.slice(2).trimStart();
      continue;
    }
    if (rest.startsWith("*") || rest.startsWith("_")) {
      rest = rest.slice(1).trimStart();
      continue;
    }
    break;
  }
  return rest;
}

/**
 * Last non-empty paragraph only. "等你确认后" is intentionally not a give-up:
 * the wait pattern requires 完成/跑完后再, not a bare confirmation request.
 * Incorporates both Qling Chinese patterns and Grok Build's 9-category stop panel.
 */
const PREMATURE_STOP_PATTERNS: readonly PrematureStopPattern[] = [
  { pattern: "cannot_continue", category: "unable_to_proceed", expression: /我无法继续/ },
  { pattern: "cannot_complete", category: "unable_to_proceed", expression: /无法完成/ },
  { pattern: "stop_here", category: "stopping_here", expression: /先到这里/ },
  { pattern: "pause_here", category: "stopping_here", expression: /暂停在此/ },
  { pattern: "please_manual", category: "please_deflection", expression: /请你(?:手动|自行|运行|提供)/ },
  { pattern: "wait_until_done", category: "agents_in_flight", expression: /等.{0,20}(?:完成|跑完)后再/ },
  { pattern: "committed", category: "commit_push_pr", expression: /已提交.{0,10}commit/i },
  {
    pattern: "unable_to_proceed",
    category: "unable_to_proceed",
    expression: /(?:I\s+can(?:not|'t|’t)\s+(?:proceed|complete|continue)|unable\s+to\s+(?:proceed|complete|continue))/i,
  },
  {
    pattern: "giving_up",
    category: "giving_up",
    expression: /(?:(?<!not\s)giving up|I(?:'m| am)\s+giving\s+up)/i,
  },
  {
    pattern: "stopping_here",
    category: "stopping_here",
    expression: /(?:(?<!not\s)stopping here|I(?:'ll| will)\s+stop\s+here|pausing\s+here\s+for\s+now)/i,
  },
  {
    pattern: "agents_in_flight",
    category: "agents_in_flight",
    lineAnchored: true,
    expression: /^(?:wait(?:ing)?\s+for\s+(?:the\s+)?(?:sub-?agents?|background\s+tasks?|workers?)\s+to\s+(?:finish|complete)|once\s+(?:the\s+)?(?:sub-?agents?|background\s+tasks?)\s+(?:finish|complete))/i,
  },
  {
    pattern: "check_back_later",
    category: "check_back_later",
    lineAnchored: true,
    rejectUserSubject: true,
    expression: /^(?:(?:I(?:'ll| will)|we(?:'ll| will)|let's|you\s+can)\s+)?check\s+back\s+(?:in\s+\d+|later|once|when|after)\b/i,
  },
  {
    pattern: "verdict_line",
    category: "verdict_line",
    lineAnchored: true,
    expression: /^(?:final\s+)?(?:verdict|status)\s*:\s*(?:blocked|incomplete|partial|deferred|unable\s+to\s+complete)\b/i,
  },
  {
    pattern: "commit_push_pr",
    category: "commit_push_pr",
    lineAnchored: true,
    expression: /^(?:all\s+changes\s+(?:are\s+)?committed\s+and\s+pushed|ready\s+to\s+open\s+a\s+PR)\b/i,
  },
  {
    pattern: "ready_for_review",
    category: "ready_for_review",
    lineAnchored: true,
    expression: /^(?:this\s+is\s+)?ready\s+for\s+(?:your\s+)?(?:review|testing|merge)\b/i,
  },
  {
    pattern: "please_deflection",
    category: "please_deflection",
    lineAnchored: true,
    expression: /^please\s+(?:run|execute|provide|supply|install|configure|finish)\s+(?:the\s+)?(?:remaining|tests?|build|command|credentials?)\b/i,
  },
];

export function lastNonEmptyParagraph(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  const parts = normalized.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? "";
}

export function detectPrematureStopDetailed(text: string): PrematureStopDetailedMatch | null {
  const paragraph = lastNonEmptyParagraph(text);
  if (!paragraph) return null;

  const lines = paragraph
    .split("\n")
    .map((line) => stripLeadingMarkdown(line).trim())
    .filter(Boolean);

  for (const candidate of PREMATURE_STOP_PATTERNS) {
    if (candidate.lineAnchored) {
      for (const line of lines) {
        if (!candidate.expression.test(line)) continue;
        if (candidate.rejectUserSubject && /^you\s+can\s+check\s+back\b/i.test(line)) {
          continue;
        }
        return {
          pattern: candidate.pattern,
          category: candidate.category,
          matchedText: line,
        };
      }
      continue;
    }

    const match = paragraph.match(candidate.expression);
    if (match) {
      return {
        pattern: candidate.pattern,
        category: candidate.category,
        matchedText: match[0],
      };
    }
  }
  return null;
}

export function detectPrematureStop(text: string): PrematureStopMatch | null {
  const detailed = detectPrematureStopDetailed(text);
  if (!detailed) return null;
  return { pattern: detailed.pattern };
}
