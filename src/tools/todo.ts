import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { ToolDefinition, ToolResult } from "../types.js";

const TODO_FILE = resolve(process.cwd(), ".qling-todos.json");

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

async function readTodos(): Promise<TodoItem[]> {
  if (!existsSync(TODO_FILE)) return [];
  try {
    return JSON.parse(await readFile(TODO_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function saveTodos(todos: TodoItem[]): Promise<void> {
  await mkdir(resolve(process.cwd(), ".qling-todos.json").replace(/[/\\][^/\\]+$/, ""), {
    recursive: true,
  });
  await writeFile(TODO_FILE, JSON.stringify(todos, null, 2), "utf-8");
}

export const todoTool: ToolDefinition = {
  name: "todo",
  description:
    "Manage a persistent task list (stored in .qling-todos.json). Create, update, list, or remove tasks. Use for planning multi-step tasks and tracking session progress.",
  longDescription: `管理持久化任务列表，存储在 .qling-todos.json 中。**不会直接执行任何操作**。

**Action 类型**:
- list: 列出所有任务（默认）
- add: 添加新任务
- done: 标记任务为已完成
- cancel: 标记任务为已取消
- remove: 删除单个任务
- clear: 清空所有任务

**任务状态**:
- pending（待处理，默认）
- in_progress（进行中）
- completed（已完成）
- cancelled（已取消）

**使用建议**:
- 复杂任务先用 todo add 创建计划
- 每完成一步用 todo done 标记
- 用 todo list 查看整体进度

**注意**: 任务列表在会话之间持久化，清空操作需谨慎。`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "add", "done", "cancel", "remove", "clear"],
        description: "Action: list | add | done | cancel | remove | clear",
      },
      content: {
        type: "string",
        description: "Task content (required for action=add)",
      },
      id: {
        type: "string",
        description: "Task ID (required for action=done/cancel/remove)",
      },
    },
    required: ["action"],
  },
  paramSchema: {
    action: {
      type: "string",
      description: "操作类型：list=列表，add=添加，done=完成，cancel=取消，remove=删除，clear=清空",
      enum: ["list", "add", "done", "cancel", "remove", "clear"],
      required: true,
    },
    content: {
      type: "string",
      description: "任务内容描述（仅 action=add 时需要）",
    },
    id: {
      type: "string",
      description: "任务 ID（action=done/cancel/remove 时需要）",
    },
  },
  examples: [
    'todo action="list"',
    'todo action="add" content="完成登录功能"',
    'todo action="done" id="abc123"',
    'todo action="remove" id="abc123"',
  ],
  seeAlso: ["bash"],
  scenes: ["planning"],
  priority: 7,
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  effortHint: "minimal",
};

export async function runTodo(args: {
  action: string;
  content?: string;
  id?: string;
}): Promise<ToolResult> {
  try {
    const todos = await readTodos();

    switch (args.action) {
      case "list": {
        if (todos.length === 0) {
          return { tool_call_id: "", output: "📋 暂无任务" };
        }
        const lines = todos.map((t) => {
          const icon =
            t.status === "completed"
              ? "✅"
              : t.status === "in_progress"
              ? "🔄"
              : t.status === "cancelled"
              ? "❌"
              : "⬜";
          return `${icon} [${t.id}] ${t.content}`;
        });
        return { tool_call_id: "", output: "📋 任务列表:\n" + lines.join("\n") };
      }

      case "add": {
        const id = Date.now().toString(36);
        const now = new Date().toISOString();
        const item: TodoItem = {
          id,
          content: args.content ?? "",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
        todos.push(item);
        await saveTodos(todos);
        return { tool_call_id: "", output: `✅ 已添加任务 [${id}]: ${item.content}` };
      }

      case "done": {
        const todo = todos.find((t) => t.id === args.id);
        if (!todo) return { tool_call_id: "", output: `未找到任务 [${args.id}]`, is_error: true };
        todo.status = "completed";
        todo.updatedAt = new Date().toISOString();
        await saveTodos(todos);
        return { tool_call_id: "", output: `✅ 已完成 [${args.id}]: ${todo.content}` };
      }

      case "cancel": {
        const todo = todos.find((t) => t.id === args.id);
        if (!todo) return { tool_call_id: "", output: `未找到任务 [${args.id}]`, is_error: true };
        todo.status = "cancelled";
        todo.updatedAt = new Date().toISOString();
        await saveTodos(todos);
        return { tool_call_id: "", output: `❌ 已取消 [${args.id}]: ${todo.content}` };
      }

      case "remove": {
        const idx = todos.findIndex((t) => t.id === args.id);
        if (idx === -1) return { tool_call_id: "", output: `未找到任务 [${args.id}]`, is_error: true };
        todos.splice(idx, 1);
        await saveTodos(todos);
        return { tool_call_id: "", output: `🗑️ 已删除 [${args.id}]` };
      }

      case "clear": {
        await saveTodos([]);
        return { tool_call_id: "", output: "🗑️ 任务列表已清空" };
      }

      default:
        return {
          tool_call_id: "",
          output: `未知 action: ${args.action}`,
          is_error: true,
        };
    }
  } catch (err: unknown) {
    return { tool_call_id: "", output: `Error: ${(err as Error).message}`, is_error: true };
  }
}
