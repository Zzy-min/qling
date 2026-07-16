import { SlashCommand } from "./types.js";

export const dashboardCommand: SlashCommand = {
  name: "/dashboard",
  description: "打开本地任务工作台链接",
  usage: "/dashboard",
  execute: async (_args, context) => {
    const port = process.env.QLING_DASHBOARD_PORT || "9999";
    const url = `http://127.0.0.1:${port}`;
    const enabled = process.env.QLING_FEATURES_DASHBOARD === "true";
    const ds = (context.agentLoop as { dashboardServer?: { listening?: boolean } } | undefined)
      ?.dashboardServer;

    context.writeLine("");
    context.writeLine("📊 【轻灵任务工作台 / Mission Control】");
    context.writeLine("-----------------------------------------");
    if (enabled && ds?.listening) {
      context.writeLine(`本地链接 : ${url}`);
      context.writeLine("状态     : 运行中（仅 127.0.0.1）");
      context.writeLine("用途     : 查看 mission / loop / workflow · 暂停/恢复 · 最近会话");
      context.writeLine("提示     : 浏览器打开上方链接；TUI 继续对话即可");
    } else if (enabled) {
      context.writeLine(`本地链接 : ${url}`);
      context.writeLine("状态     : 已配置但服务未监听");
      context.writeLine("提示     : 重试 qling dashboard start 或检查端口占用");
    } else {
      context.writeLine("状态     : 本会话未开启");
      context.writeLine("一键启动 : qling dashboard start");
      context.writeLine("说明     : 仅本机 loopback，任务正文不外传");
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
