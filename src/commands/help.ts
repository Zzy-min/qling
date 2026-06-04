import { SlashCommand } from "./types.js";
import { formatFocusedHelp } from "../help-topics.js";

export const HELP_LINES = [
  "",
  "【轻灵 Slash Commands】",
  "-----------------------------------------",
  "/help, /?               - 显示此帮助信息",
  "/skill [name]           - 查询或挂载技能",
  "/sessions               - 查看最近保存的会话快照",
  "/resume [session|latest] - 恢复最近一次或指定会话",
  "/clear, /reset          - 清空当前对话上下文",
  "/compact                - 手动触发上下文压缩",
  "/goal [condition|clear] - 设定、查询或清除当前 session 的目标条件",
  "/goal daemon            - 查询 daemon runner 的 goal 状态",
  "/goal daemon clear      - 清理 daemon runner 的 goal",
  "/goal daemon <condition> - 将 goal 交由 qlingd 在后台持续推进",
  "/loop [interval] [prompt] - 在当前 session 内周期性重跑 prompt",
  "/loop daemon [interval] [prompt] - 创建 daemon-backed durable loop",
  "/tasks [cancel <id>|clear] - 查看或取消当前 session 的 loop 任务",
  "/tasks daemon [cancel <id>|clear] - 查看或取消 daemon runner 的 loop 任务",
  "/agents, /代理         - 查看本地后台 mission 分组视图",
  "/mission, /使命        - 查看或控制本地 mission",
  "/permissions [status|allow|deny|ask] - 查看或切换工具权限默认策略",
  "/permissions explain <tool> - 解释指定工具的本地权限决策",
  "/statusline [on|off]   - 查看或切换 prompt 前本地状态线",
  "/recap [count], /回顾   - 查看当前本地会话回顾",
  "/privacy, /隐私         - 查看本地数据留存路径与边界说明",
  "/shortcuts, /快捷键     - 查看 TUI 输入快捷键",
  "/queue [clear], /队列 [清空] - TUI 中即时查看或清空 pending 输入队列",
  "/export, /导出          - 将当前会话导出为本地 Markdown",
  "/exports [count], /导出列表 - 查看本地 Markdown 导出列表",
  "/memory [count], /记忆   - 查看本地持久化记忆索引",
  "/memory search <query>   - 搜索本地持久化记忆并显示匹配路径",
  "/memory practices [count] - 查看本地蒸馏实践摘要",
  "/memory graph [count]   - 查看本地知识图谱节点摘要",
  "/memory show <id>       - 查看指定本地记忆详情",
  "/storage, /存储         - 查看本地数据存储占用",
  "/mcp, /外部工具         - 查看本地 MCP server 配置摘要",
  "/hooks, /钩子           - 查看本地 hooks/guard 配置摘要",
  "/doctor, /诊断          - 运行本地稳定性与数据留存诊断",
  "/context, /上下文       - 查看上下文占用与本地留存路径",
  "/config                 - 查看当前生效配置",
  "/status                 - 查看会话状态与 Token 统计",
  "/dashboard              - 获取观测控制台链接",
  "-----------------------------------------",
  "",
];

export const helpCommand: SlashCommand = {
  name: "/help",
  aliases: ["/?"],
  description: "显示可用指令列表",
  usage: "/help [topic]",
  execute: async (args, context) => {
    const lines = args.length ? formatFocusedHelp(args.join(" "), { surface: "slash" }) : HELP_LINES;
    for (const line of lines) {
      context.writeLine(line);
    }
  },
};
