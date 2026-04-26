// ============================================================
// WorkspaceSidebar - 左侧工作区面板
// ============================================================

import { S, divider } from "../styles/theme.js";

export interface WorkspaceSidebarOptions {
  currentSession: number;
  projectName: string;
  terminalWidth: number;
}

export function renderWorkspaceSidebar(opt: WorkspaceSidebarOptions): string[] {
  const { currentSession, projectName, terminalWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  const section = (title: string, items: string[]) => {
    lines.push(S.secondary(title));
    lines.push(S.dim(divider("─", Math.min(14, bodyW))));
    for (const item of items) {
      lines.push(S.primary(item));
    }
    lines.push("");
  };

  // SESSION
  section("SESSION", [
    ` ● 当前会话`,
  ]);

  // COMMANDS
  const commands = [
    [`${S.dim("/plan")}`, "制定计划"],
    [`${S.dim("/reset")}`, "重置对话"],
    [`${S.dim("/tools")}`, "工具列表"],
    [`${S.dim("/memory")}`, "记忆面板"],
    [`${S.dim("/debug")}`, "调试模式"],
    [`${S.dim("/compact")}`, "压缩上下文"],
  ];
  lines.push(S.secondary("COMMANDS"));
  lines.push(S.dim(divider("─", Math.min(14, bodyW))));
  for (const [cmd, desc] of commands) {
    const line = `${cmd}  ${S.secondary(desc)}`;
    lines.push(line);
  }
  lines.push("");

  // PROJECT
  lines.push(S.secondary("PROJECT"));
  lines.push(S.dim(divider("─", Math.min(14, bodyW))));
  lines.push(S.primary(` 📁 ${projectName}`));

  return lines;
}
