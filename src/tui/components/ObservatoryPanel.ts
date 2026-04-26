// ============================================================
// ObservatoryPanel - 右侧观察面板
// ============================================================

import { S, divider } from "../styles/theme.js";

export interface ObservatoryPanelOptions {
  mode: string;
  model: string;
  networkStatus: "online" | "offline";
  toolStats: Record<string, number>;
  validationStats: { pass: number; fail: number; partial: number };
  errorStats: Array<{ type: string; count: number }>;
  contextTokens: number;
  maxTokens: number;
  memoryStatus: string;
  sessionTokens: number;
  availableWidth: number;
}

export function renderObservatoryPanel(opt: ObservatoryPanelOptions): string[] {
  const {
    mode, model, networkStatus,
    toolStats, validationStats, errorStats,
    contextTokens, maxTokens, memoryStatus,
    sessionTokens, availableWidth: W,
  } = opt;

  const lines: string[] = [];
  const sectionW = W - 2;

  const section = (title: string, content: string[]) => {
    lines.push(S.secondary(title));
    lines.push(S.dim(divider("─", Math.min(title.length + 2, sectionW))));
    for (const c of content) lines.push(c);
    lines.push("");
  };

  // STATE
  const stateColor = mode === "idle" ? S.secondary
    : mode === "error" ? S.error
    : S.brand;
  section("STATE", [
    ` ${stateColor("◉")} ${stateColor(mode)}`,
  ]);

  // MODEL
  section("MODEL", [
    ` ${S.brandSec(model)}`,
  ]);

  // TOOLS
  const toolLines = [` ${S.brand(`${Object.values(toolStats).reduce((a, b) => a + b, 0)} ready`)}`];
  for (const [name, count] of Object.entries(toolStats).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    toolLines.push(` ${S.dim(name.padEnd(10))} ${S.secondary(`${count}×`)}`);
  }
  section("TOOLS", toolLines);

  // VALIDATION
  section("VALIDATION", [
    ` ${S.success("✓")} pass    ${S.secondary(validationStats.pass.toString())}`,
    ` ${S.error("✕")} fail    ${S.secondary(validationStats.fail.toString())}`,
    ` ${S.warning("⚠")} partial ${S.secondary(validationStats.partial.toString())}`,
  ]);

  // ERRORS
  if (errorStats.length === 0) {
    section("ERRORS", [` ${S.secondary("none")}`]);
  } else {
    const errLines = errorStats.slice(0, 5).map((e) =>
      ` ${S.error("✕")} ${S.primary(e.type)} ${S.secondary(`×${e.count}`)}`
    );
    section("ERRORS", errLines);
  }

  // CONTEXT
  const ctxPct = maxTokens > 0 ? Math.round((contextTokens / maxTokens) * 100) : 0;
  section("CONTEXT", [
    ` ${S.secondary(`${contextTokens} / ${maxTokens}`)}`,
    ` ${S.dim(`(${ctxPct}%)`)}`,
  ]);

  // MEMORY
  section("MEMORY", [
    ` ${S.secondary(memoryStatus)}`,
  ]);

  return lines;
}
