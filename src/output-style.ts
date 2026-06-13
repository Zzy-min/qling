export type KeyValueRow = readonly [label: string, value: unknown];

export interface LocalPanelSection {
  heading: string;
  rows: readonly KeyValueRow[];
}

export interface LocalPanelOptions {
  icon?: string;
  title: string;
  sections: readonly LocalPanelSection[];
  boundary: string;
}

const PANEL_RULE = "─────────────────────────────────────────";

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function formatKeyValueRows(rows: readonly KeyValueRow[]): string[] {
  const labels = rows.map(([label]) => label);
  const width = labels.reduce((max, label) => Math.max(max, label.length), 0);
  return rows.map(([label, value]) => `${label.padEnd(width, " ")} : ${formatValue(value)}`);
}

export function formatLocalPanel(options: LocalPanelOptions): string[] {
  const icon = options.icon?.trim() || "◇";
  const lines = [
    "",
    `${icon} 轻灵 · ${options.title}`,
    PANEL_RULE,
  ];

  options.sections.forEach((section, index) => {
    if (index > 0) lines.push("");
    lines.push(`▸ ${section.heading}`);
    lines.push(...formatKeyValueRows(section.rows).map((line) => `  ${line}`));
  });

  lines.push(PANEL_RULE);
  lines.push(`边界 : ${options.boundary}`);
  lines.push("");
  return lines;
}
