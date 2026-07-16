// ============================================================
// G3.2 — 后台任务工具：bg_list / bg_wait / bg_kill
// ============================================================

import type { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import {
  formatBgTaskLine,
  getBackgroundTaskRegistry,
} from "../runtime/background-tasks.js";

export const bgListTool: ToolDefinition = {
  name: "bg_list",
  description: "List background shell tasks (task_id, status, command).",
  parameters: {
    type: "object",
    properties: {
      include_finished: {
        type: "boolean",
        description: "Include completed/failed/killed (default true)",
      },
      limit: {
        type: "number",
        description: "Max rows (default 20)",
      },
    },
  },
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
};

export const bgWaitTool: ToolDefinition = {
  name: "bg_wait",
  description: "Wait for a background task_id to finish; returns status and output.",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Background task id (bg_…)",
      },
      timeout_ms: {
        type: "number",
        description: "Wait timeout in ms (default 120000)",
      },
    },
    required: ["task_id"],
  },
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
};

export const bgKillTool: ToolDefinition = {
  name: "bg_kill",
  description: "Kill a running background task by task_id.",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Background task id (bg_…)",
      },
    },
    required: ["task_id"],
  },
  readOnly: false,
  destructive: true,
  concurrencySafe: false,
};

export async function runBgList(args: {
  include_finished?: boolean;
  limit?: number;
}): Promise<ToolResult> {
  const reg = getBackgroundTaskRegistry();
  const tasks = reg.list({
    includeFinished: args.include_finished !== false,
    limit: typeof args.limit === "number" ? args.limit : 20,
  });
  if (!tasks.length) {
    return toolSuccess("(no background tasks)");
  }
  return toolSuccess(tasks.map(formatBgTaskLine).join("\n"));
}

export async function runBgWait(args: {
  task_id?: string;
  timeout_ms?: number;
}): Promise<ToolResult> {
  const taskId = String(args.task_id ?? "").trim();
  if (!taskId) {
    return toolError("BG_WAIT_MISSING_ID", "task_id is required");
  }
  const timeoutMs =
    typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
      ? Math.max(0, Math.floor(args.timeout_ms))
      : 120_000;
  try {
    const reg = getBackgroundTaskRegistry();
    const task = await reg.wait(taskId, timeoutMs);
    const out = [
      `task_id: ${task.taskId}`,
      `status: ${task.status}`,
      `exit_code: ${task.exitCode ?? "-"}`,
      `command: ${task.command}`,
      "--- output ---",
      task.output || "(empty)",
    ].join("\n");
    if (task.status === "completed") return toolSuccess(out);
    return toolError("BG_WAIT_NOT_OK", out);
  } catch (err) {
    return toolError("BG_WAIT_FAILED", err instanceof Error ? err.message : String(err));
  }
}

export async function runBgKill(args: { task_id?: string }): Promise<ToolResult> {
  const taskId = String(args.task_id ?? "").trim();
  if (!taskId) {
    return toolError("BG_KILL_MISSING_ID", "task_id is required");
  }
  try {
    const reg = getBackgroundTaskRegistry();
    const task = await reg.kill(taskId, "user");
    return toolSuccess(
      [`task_id: ${task.taskId}`, `status: ${task.status}`, `command: ${task.command}`].join("\n")
    );
  } catch (err) {
    return toolError("BG_KILL_FAILED", err instanceof Error ? err.message : String(err));
  }
}
