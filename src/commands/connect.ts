import { SlashCommand } from "./types.js";

// P4: 国内平台连接器引导
// 统一入口 /connect 或 qling connect
// 先完善 Telegram/Slack, 规划 Feishu/DingTalk/WeChat
// 中文指南 + doctor 检查 + 脱敏

const CONNECTORS: Record<string, any> = {
  telegram: {
    name: "Telegram",
    guide: "准备: Bot Token (从 @BotFather 获取)\n权限: 机器人需有 chat 权限\n存放: 环境变量 QLING_CHANNEL_TELEGRAM_TOKEN\n测试: /connect telegram test",
    env: "QLING_CHANNEL_TELEGRAM_TOKEN",
    doctor: "检查 token 是否设置, 网络连通",
  },
  slack: {
    name: "Slack",
    guide: "准备: Bot Token, App Token, Channel IDs\n权限: 机器人需加入频道\n存放: QLING_CHANNEL_SLACK_BOT_TOKEN 等\n测试: /connect slack test",
    env: "QLING_CHANNEL_SLACK_BOT_TOKEN",
    doctor: "检查 tokens, app 权限",
  },
  feishu: {
    name: "飞书 (Feishu)",
    guide: "准备: App ID, App Secret, User Access Token\n权限: 应用需有 im:message 权限\n存放: 环境变量 (暂未内置)\n规划中: 使用 lark-cli 集成",
    env: "QLING_CHANNEL_FEISHU_APP_ID",
    doctor: "检查 token, 飞书开放平台权限",
  },
  dingtalk: {
    name: "钉钉 (DingTalk)",
    guide: "准备: AppKey, AppSecret, Agent ID\n权限: 机器人权限\n存放: 环境变量\n规划中",
    env: "QLING_CHANNEL_DINGTALK_APPKEY",
    doctor: "检查配置, 钉钉连接",
  },
  wechat: {
    name: "微信 (WeChat)",
    guide: "准备: 公众号/企业微信配置\n注意: 敏感, 推荐使用 opencli 或外部桥接\n存放: 绝不写入 .env\n规划中: 参考 LangBot",
    env: "",
    doctor: "使用 doctor 检查 webhook 等",
  },
};

export const connectCommand: SlashCommand = {
  name: "/connect",
  aliases: ["/连接", "/connector"],
  description: "国内平台连接器引导 (P4)",
  usage: "/connect [telegram|slack|feishu|dingtalk|wechat] [test|guide]",
  execute: async (args, context) => {
    const sub = (args[0] || "").toLowerCase();
    const action = (args[1] || "").toLowerCase();

    context.writeLine("");
    context.writeLine("🔗 【轻灵连接器】国内平台引导");
    context.writeLine("-----------------------------------------");

    if (!sub || sub === "help") {
      context.writeLine("支持: telegram, slack, feishu, dingtalk, wechat");
      context.writeLine("用法: /connect <平台> guide | test");
      context.writeLine("示例: /connect telegram guide");
      context.writeLine("优先: 完善 Telegram/Slack, 规划其他");
      context.writeLine("敏感: 绝不保存明文到 .env, 用 doctor 检查");
    } else if (CONNECTORS[sub]) {
      const c = CONNECTORS[sub];
      if (action === "guide" || action === "指南") {
        context.writeLine(`${c.name} 准备向导:`);
        context.writeLine(c.guide);
        context.writeLine(`环境变量: ${c.env || "参考 config"}`);
      } else if (action === "test" || action === "测试") {
        context.writeLine(`正在测试 ${c.name} 连通性...`);
        context.writeLine("提示: 使用 doctor 检查具体错误");
        context.writeLine("常见失败: token 无效, 权限不足, 网络问题");
        // TODO: actual test call if implemented
        context.writeLine("模拟: 连通性检查通过 (实际需实现 channel connect)");
      } else {
        context.writeLine(`${c.name} 信息:`);
        context.writeLine(c.guide.split("\n")[0]);
        context.writeLine("使用 /connect " + sub + " guide 获取完整指南");
      }
    } else {
      context.writeLine("未知平台: " + sub);
      context.writeLine("可用: " + Object.keys(CONNECTORS).join(", "));
    }

    context.writeLine("-----------------------------------------");
    context.writeLine("边界: 敏感 token 用环境变量或 secret store");
    context.writeLine("复用: scanner + doctor 警告");
    context.writeLine("");
  },
};