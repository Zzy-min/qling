import { SlashCommand } from "./types.js";

export const dashboardCommand: SlashCommand = {
  name: "/dashboard",
  description: "获取观测控制台链接",
  usage: "/dashboard",
  execute: async (_args, context) => {
    const port = process.env.QINGLING_DASHBOARD_PORT || "9999";
    const enabled = process.env.QINGLING_FEATURES_DASHBOARD === "true";

    context.writeLine("");
    context.writeLine("📊 【Observability Dashboard】");
    context.writeLine("-----------------------------------------");
    if (enabled) {
      context.writeLine(`本地链接 : http://localhost:${port}`);
      context.writeLine("状态     : 运行中");
    } else {
      context.writeLine("状态     : 未开启");
      context.writeLine("提示     : 请设置环境变量 QINGLING_FEATURES_DASHBOARD=true 以启用。");
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
