import { SlashCommand } from "./types.js";

type DashboardSurface = "tui" | "web";

function resolveDashboardSurface(args: string[]): DashboardSurface {
  const token = (args[0] || "").trim().toLowerCase();
  if (!token || token === "tui" || token === "fleet" || token === "sessions" || token === "session") {
    return "tui";
  }
  if (
    token === "web" ||
    token === "url" ||
    token === "open" ||
    token === "mc" ||
    token === "mission" ||
    token === "http"
  ) {
    return "web";
  }
  // 未知子命令：默认 TUI 舰队（对标 Grok /dashboard）
  return "tui";
}

function printWebMissionControl(context: {
  writeLine: (line: string) => void;
  agentLoop?: { dashboardServer?: { listening?: boolean } };
}): void {
  const port = process.env.QLING_DASHBOARD_PORT || "9999";
  const url = `http://127.0.0.1:${port}`;
  const enabled = process.env.QLING_FEATURES_DASHBOARD === "true";
  const ds = context.agentLoop?.dashboardServer;

  context.writeLine("");
  context.writeLine("📊 【轻灵任务工作台 / Mission Control】");
  context.writeLine("-----------------------------------------");
  if (enabled && ds?.listening) {
    context.writeLine(`本地链接 : ${url}`);
    context.writeLine("状态     : 运行中（仅 127.0.0.1）");
    context.writeLine("用途     : 查看 mission / loop / workflow · 暂停/恢复 · 最近会话");
    context.writeLine("深链     : 页面会话条显示 qling --resume <id>");
    context.writeLine("打开方式 : 浏览器地址栏粘贴上方链接（本机即可）");
    context.writeLine("TUI 舰队 : /dashboard 或 Ctrl+\\（会话列表，无需网页）");
  } else if (enabled) {
    context.writeLine(`本地链接 : ${url}`);
    context.writeLine("状态     : 已配置但服务未监听");
    context.writeLine("提示     : 另开终端执行 qling dashboard start，再刷新浏览器");
  } else {
    context.writeLine("状态     : 本会话未开启 Web 任务台");
    context.writeLine("");
    context.writeLine("如何打开网址（推荐步骤）:");
    context.writeLine("  1. 另开一个终端窗口");
    context.writeLine("  2. 运行:  qling dashboard start");
    context.writeLine(`  3. 浏览器打开:  ${url}`);
    context.writeLine("  4. 保持该终端运行（Ctrl+C 会停止服务）");
    context.writeLine("");
    context.writeLine("可选端口:  qling dashboard start --port 9999");
    context.writeLine("说明     : 仅 127.0.0.1，任务正文不外传");
    context.writeLine("TUI 舰队 : /dashboard 或 /sessions 或 Ctrl+\\（无需 Web）");
  }
  context.writeLine("-----------------------------------------");
  context.writeLine("");
}

/**
 * G4 双表面入口（对标 Grok `/dashboard` ≡ 会话舰队，另保留 Web Mission Control）
 *
 * - `/dashboard` / `tui` / `fleet` → TUI 会话舰队（与 /sessions · Ctrl+\ 同表面）
 * - `/dashboard web` / `url` / `open` → 打印本机 Mission Control 链接
 */
export const dashboardCommand: SlashCommand = {
  name: "/dashboard",
  aliases: ["/agents-dashboard", "/任务台"],
  description: "会话舰队（默认）或 Web 任务台链接",
  usage: "/dashboard [tui|web]",
  // 有参数提示：斜杠切换器选中后填入 `/dashboard ` 便于继续键入 web
  argumentHint: "[tui|web]",
  execute: async (args, context) => {
    const surface = resolveDashboardSurface(args);
    if (surface === "tui") {
      if (typeof context.openSessionPicker === "function") {
        context.openSessionPicker();
        return;
      }
      context.writeLine("");
      context.writeLine("会话舰队不可用（非交互 TUI）。可改用：");
      context.writeLine("  /sessions list");
      context.writeLine("  /dashboard web");
      context.writeLine("");
      return;
    }
    printWebMissionControl(context as {
      writeLine: (line: string) => void;
      agentLoop?: { dashboardServer?: { listening?: boolean } };
    });
  },
};

export { resolveDashboardSurface };
