import type { SlashCommand } from "./types.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const traceCommand: SlashCommand = {
  name: "/trace",
  aliases: ["/轨迹"],
  description: "查看脱敏后的本地执行摘要轨迹",
  usage: "/trace current | last | show <runId> | export <runId>",
  category: "session",
  argumentHint: "current | last | show <runId> | export <runId>",
  examples: ["/trace last", "/trace show run_abc"],
  execute: async (args, context) => {
    const agent = context.agentLoop as any;
    if (typeof agent.listRunTraceIds !== "function" || typeof agent.readRunTrace !== "function") {
      context.writeError("轨迹查询不可用：当前 AgentLoop 未启用本地摘要轨迹。");
      return;
    }
    const sub = (args[0] ?? "last").toLowerCase();
    const ids = await agent.listRunTraceIds();
    let runId = args[1];
    if (sub === "current") runId = agent.getActiveRun?.()?.runId;
    if (sub === "last") runId = ids[0];
    if (!runId || !["current", "last", "show", "export"].includes(sub)) {
      context.writeError(ids.length === 0 ? "暂无本地执行轨迹。" : "用法: /trace current | last | show <runId> | export <runId>");
      return;
    }
    const events = await agent.readRunTrace(runId);
    if (sub === "export") {
      const root = typeof agent.getRuntimeRootDir === "function" ? agent.getRuntimeRootDir() : path.join(process.cwd(), ".qling");
      const exportDir = path.join(root, "exports");
      const exportPath = path.join(exportDir, `trace-${runId}.jsonl`);
      await mkdir(exportDir, { recursive: true });
      await writeFile(exportPath, events.map((event: unknown) => JSON.stringify(event)).join("\n") + "\n", "utf8");
      context.writeLine(`脱敏轨迹已导出: ${exportPath}`);
      context.writeLine("边界: 导出不包含 prompt、模型思考或工具正文。");
      return;
    }
    context.writeLine(`执行轨迹 ${runId} (${events.length} events)`);
    for (const event of events) {
      context.writeLine(`${new Date(event.timestamp).toISOString()}  ${event.type}  ${event.status ?? "-"}  ${event.category ?? "-"}  ${event.fingerprint ?? "-"}`);
    }
    context.writeLine("边界: 仅显示脱敏摘要，不包含 prompt、模型思考或工具正文。");
  },
};
