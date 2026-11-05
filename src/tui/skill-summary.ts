// ============================================================
// Skill 结果展示：对标 Grok build 的 skill block
// - 不把整份 SKILL.md 当作普通工具输出倾倒在聊天区
// - 保留名称、描述、章节、行数与安全警告，正文已注入模型上下文
// ============================================================

export interface SkillSummary {
  name: string;
  description: string;
  headings: string[];
  lineCount: number;
  warnings: string[];
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从 skill 工具输出中提炼可展示摘要；正文仍保留给模型上下文。 */
export function summarizeSkillOutput(output: string, fallbackName = ""): SkillSummary {
  const raw = String(output ?? "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n");
  let name = fallbackName.trim();
  const warnings: string[] = [];
  const body: string[] = [];

  for (const line of lines) {
    const skillMatch = line.match(/^📖\s*Skill:\s*(.+?)\s*$/);
    if (skillMatch) {
      name = skillMatch[1].trim() || name;
      continue;
    }
    if (/^⚠️\s*安全扫描警告/.test(line.trim())) continue;
    if (/^\s*-\s*\[(?:info|warn|warning|error|high|medium|low)\]/i.test(line)) {
      warnings.push(line.trim());
      continue;
    }
    body.push(line);
  }

  const cleaned = body.join("\n").replace(/^\s*\n+/, "").trim();
  const bodyLines = cleaned ? cleaned.split("\n") : [];
  const headings = bodyLines
    .map((line) => line.match(/^#{1,4}\s+(.+?)\s*$/)?.[1])
    .filter((heading): heading is string => Boolean(heading))
    .map(stripInlineMarkdown);

  const description = bodyLines
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("```") &&
        !line.startsWith("-") &&
        !line.startsWith("*") &&
        !line.startsWith("|")
    ) ?? "";

  return {
    name: name || "(unknown)",
    description: stripInlineMarkdown(description).slice(0, 120),
    headings: [...new Set(headings)],
    lineCount: bodyLines.filter((line) => line.trim().length > 0).length,
    warnings,
  };
}

/** 命令/工具卡片共用的紧凑摘要行（不含 ANSI，由调用方着色）。 */
export function formatSkillSummaryLines(
  summary: SkillSummary,
  options: { indent?: string; maxHeadings?: number } = {}
): string[] {
  const indent = options.indent ?? "";
  const lines = [`${indent}已加载 ${summary.name} · ${summary.lineCount} 行 · 已注入上下文`];
  if (summary.description) lines.push(`${indent}${summary.description}`);
  const headings = summary.headings.slice(0, options.maxHeadings ?? 3);
  if (headings.length > 0) lines.push(`${indent}章节: ${headings.join(" / ")}`);
  if (summary.warnings.length > 0) {
    lines.push(`${indent}安全警告: ${summary.warnings.length} 条`);
  }
  return lines;
}
