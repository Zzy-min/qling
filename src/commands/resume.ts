import { SlashCommand } from "./types.js";

type ResumeMode =
  | { kind: "picker" }
  | { kind: "latest" }
  | { kind: "id"; id: string };

/**
 * /resume          → 打开会话切换器（与 /sessions 一致）
 * /resume pick|ui  → 同上
 * /resume latest   → 直接恢复最近会话
 * /resume <id>     → 直接恢复指定会话
 */
export function resolveResumeMode(args: string[]): ResumeMode {
  const raw = args.join(" ").trim();
  if (!raw) return { kind: "picker" };

  const head = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (
    head === "pick" ||
    head === "ui" ||
    head === "切换" ||
    head === "picker" ||
    head === "list" // list 在 resume 语境下也进选择器更直观
  ) {
    return { kind: "picker" };
  }
  if (head === "latest" || head === "last" || head === "continue" || head === "最近") {
    return { kind: "latest" };
  }
  return { kind: "id", id: raw };
}

function openPickerQuietly(context: {
  openSessionPicker?: () => void;
  writeLine: (line?: string) => void;
  writeError: (line?: string) => void;
}): boolean {
  if (typeof context.openSessionPicker !== "function") {
    return false;
  }
  // TUI 浮层即反馈；勿 writeLine，避免与输入框/浮层叠画
  context.openSessionPicker();
  return true;
}

export const resumeCommand: SlashCommand = {
  name: "/resume",
  aliases: ["/恢复"],
  description: "打开会话切换器，或恢复指定/最近会话",
  usage: "/resume [pick|latest|<sessionId>]",
  execute: async (args, context) => {
    const mode = resolveResumeMode(args);

    if (mode.kind === "picker") {
      if (openPickerQuietly(context)) {
        return;
      }
      // 无 TUI 切换器时降级：列出最近会话，提示带 id 恢复
      const sessions =
        context.listSavedSessions
          ? await context.listSavedSessions()
          : typeof (context.agentLoop as { listSessionsDetailed?: () => Promise<unknown[]> }).listSessionsDetailed ===
              "function"
            ? await (context.agentLoop as { listSessionsDetailed: () => Promise<Array<{ name?: string; title?: string; sessionId?: string }>> }).listSessionsDetailed()
            : [];
      context.writeLine("");
      context.writeLine("♻️ 【选择要恢复的会话】");
      context.writeLine("-----------------------------------------");
      if (!Array.isArray(sessions) || sessions.length === 0) {
        context.writeLine("(无已保存会话)");
      } else {
        const list = sessions as Array<{
          title?: string;
          name?: string;
          sessionId?: string;
          turnCount?: number;
        }>;
        context.writeLine(`共 ${list.length} 条本地会话（全部列出）:`);
        for (const session of list) {
          const title = session.title || session.name || session.sessionId || "?";
          context.writeLine(`- ${title}`);
          context.writeLine(`  id: ${session.sessionId || session.name} · turns=${session.turnCount ?? 0}`);
        }
        context.writeLine("用法: /resume <sessionId>  或  /resume latest");
      }
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    let restored =
      mode.kind === "latest"
        ? context.switchSession
          ? await context.switchSession(undefined)
          : await (context.agentLoop as { restoreLatestSession?: () => Promise<unknown> }).restoreLatestSession?.()
        : context.switchSession
          ? await context.switchSession(mode.id)
          : await (context.agentLoop as { restoreSession?: (id: string) => Promise<unknown> }).restoreSession?.(
              mode.id
            );

    if (!restored) {
      context.writeError(
        mode.kind === "latest"
          ? "❌ 没有可恢复的最近会话。"
          : `❌ 找不到会话: ${mode.kind === "id" ? mode.id : ""}`
      );
      context.writeLine("提示: 输入 /resume 打开会话切换器。");
      return;
    }

    const r = restored as {
      name?: string;
      title?: string;
      sessionId?: string;
      turnCount?: number;
      messageCount?: number;
      activeTaskCount?: number;
      activeGoalStatus?: string | null;
    };

    context.writeLine("");
    context.writeLine("♻️ 【会话已恢复】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`名称       : ${r.title || r.name || "-"}`);
    context.writeLine(`Session ID : ${r.sessionId || "-"}`);
    context.writeLine(`Turns      : ${r.turnCount ?? 0}`);
    context.writeLine(`Messages   : ${r.messageCount ?? 0}`);
    if ("activeTaskCount" in r && r.activeTaskCount != null) {
      context.writeLine(`Loop Tasks : ${r.activeTaskCount}`);
    }
    if (r.activeGoalStatus) {
      context.writeLine(`Goal       : ${r.activeGoalStatus}`);
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
