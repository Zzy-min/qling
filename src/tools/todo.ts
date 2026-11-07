import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, basename, join, resolve } from "path";
import { enqueueFileOperation } from "../persistence/atomic-json.js";
import { getRuntimeRootsFromEnv, resolveEffectiveWorkspace, resolveWorkspaceStatePath } from "../runtime-paths.js";
import type { TodoCompletionState } from "../session/outcome-evidence.js";
import { ToolDefinition, ToolResult } from "../types.js";
import { toolError } from "./error-utils.js";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
  priority?: TodoPriority;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  verificationEvidence?: string;
  createdAt: string;
  updatedAt?: string;
}

interface BatchTodoUpdate {
  id: string;
  title?: string;
  content?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  verificationEvidence?: string;
}

export function resolveTodoFilePath(workspaceDir?: string | null): string {
  const base =
    workspaceDir && workspaceDir.trim()
      ? resolve(workspaceDir)
      : resolveEffectiveWorkspace(getRuntimeRootsFromEnv());
  return resolveWorkspaceStatePath(base, ".qling-todos.json");
}

export function loadTodos(workspaceDir?: string | null): TodoItem[] {
  try {
    const filePath = resolveTodoFilePath(workspaceDir);
    if (!existsSync(filePath)) return [];
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({ ...item, title: item.title ?? item.content ?? item.id }));
  } catch {
    return [];
  }
}

export function saveTodos(todos: TodoItem[], workspaceDir?: string | null): void {
  const filePath = resolveTodoFilePath(workspaceDir);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.${basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(tmpPath, JSON.stringify(todos, null, 2), "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

async function withTodoLock<T>(
  workspaceDir: string | null | undefined,
  fn: () => Promise<T> | T,
): Promise<T> {
  const filePath = resolveTodoFilePath(workspaceDir);
  let result!: T;
  await enqueueFileOperation(filePath, async () => {
    result = await fn();
  });
  return result;
}

export function loadWorkspaceTodoState(workspaceDir?: string | null): TodoCompletionState | null {
  const todos = loadTodos(workspaceDir);
  if (todos.length === 0) return null;
  let completed = 0;
  let pending = 0;
  let inProgress = 0;
  const pendingTitles: string[] = [];
  for (const item of todos) {
    if (item.status === "completed" || item.status === "cancelled") {
      completed++;
    } else if (item.status === "in_progress") {
      inProgress++;
      pendingTitles.push(`${item.id}:${item.title}`);
    } else {
      pending++;
      pendingTitles.push(`${item.id}:${item.title}`);
    }
  }
  return {
    total: todos.length,
    completed,
    pending,
    inProgress,
    pendingTitles,
  };
}

export const getWorkspaceTodoSummary = loadWorkspaceTodoState;
export const getTodoCompletionSummary = loadWorkspaceTodoState;

export const todoTool: ToolDefinition = {
  name: "todo",
  description:
    "管理任务列表（Todo List）。支持单个操作（add/list/update/remove/clear）或批量 merge/replace 更新（todos 数组），支持依赖关系与验收标准跟踪。",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "update", "remove", "clear", "batch", "done", "cancel"],
        description: "操作类型（若直接提供 todos 数组，可省略 action 默认走 batch）",
      },
      content: { type: "string", description: "Legacy todo title" },
      title: {
        type: "string",
        description: "任务标题（add 时必填）",
      },
      id: {
        type: "string",
        description: "任务 ID（update / remove 时必填）",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "cancelled"],
        description: "任务状态（update 时使用）",
      },
      priority: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "优先级（默认 medium）",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description: "前置依赖的任务 ID 列表",
      },
      acceptanceCriteria: {
        type: "string",
        description: "该待办项的完成验收标准",
      },
      verificationEvidence: {
        type: "string",
        description: "完成该待办项时的验证证据摘要",
      },
      merge: {
        type: "boolean",
        description: "批量更新模式：true（默认）为按 ID 增量合并，false 为全量替换",
      },
      todos: {
        type: "array",
        description: "批量更新的任务列表（兼容 Grok Build TodoWrite 语义）",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled"],
            },
            priority: {
              type: "string",
              enum: ["high", "medium", "low"],
            },
            dependsOn: {
              type: "array",
              items: { type: "string" },
            },
            acceptanceCriteria: { type: "string" },
            verificationEvidence: { type: "string" },
          },
          required: ["id"],
        },
      },
    },
    required: [],
  },
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  effortHint: "minimal",
  scenes: ["planning", "coding", "data", "system"],
  priority: 7,
};

function formatTodoList(todos: TodoItem[]): string {
  if (todos.length === 0) return "📋 任务列表为空";
  const statusIcon: Record<TodoStatus, string> = {
    pending: "⬜",
    in_progress: "🔄",
    completed: "✅",
    cancelled: "🚫",
  };
  const lines = todos.map((t) => {
    const deps = t.dependsOn && t.dependsOn.length > 0 ? ` [依赖: ${t.dependsOn.join(", ")}]` : "";
    const criteria = t.acceptanceCriteria ? ` (验收: ${t.acceptanceCriteria})` : "";
    const evidence = t.verificationEvidence ? ` {证据: ${t.verificationEvidence}}` : "";
    return `${statusIcon[t.status] ?? "⬜"} [${t.id}] ${t.title} (${t.status})${deps}${criteria}${evidence}`;
  });
  return `📋 任务列表（共 ${todos.length} 项）：\n${lines.join("\n")}`;
}

export async function runTodo(args: {
  action?: string;
  title?: string;
  content?: string;
  id?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  verificationEvidence?: string;
  merge?: boolean;
  todos?: BatchTodoUpdate[];
  workspaceDir?: string;
  __qling_workspace_dir?: string;
}): Promise<ToolResult> {
  const workspaceDir = args.workspaceDir ?? args.__qling_workspace_dir;
  return withTodoLock(workspaceDir, () => {
    const todos = loadTodos(workspaceDir);
    const nowIso = new Date().toISOString();

    // Support Grok Build style batch `todos` array even when `action` is omitted or `"batch"`
    if (Array.isArray(args.todos)) {
      const seenIds = new Set<string>();
      for (const item of args.todos) {
        if (!item.id || !String(item.id).trim()) {
          return toolError("TODO_MISSING_ID", "Missing todo item id in batch update.", {
            category: "validation",
          });
        }
        const normId = String(item.id).trim();
        if (seenIds.has(normId)) {
          return toolError("TODO_DUPLICATE_ID", `Duplicate todo ID in batch update: ${normId}`, {
            category: "validation",
          });
        }
        seenIds.add(normId);
      }

      const merge = args.merge !== false;
      const nextTodos: TodoItem[] = merge ? [...todos] : [];

      for (const u of args.todos) {
        const id = String(u.id).trim();
        const titleText = (u.title ?? u.content ?? "").trim();
        const existingIdx = nextTodos.findIndex((t) => t.id === id);
        if (existingIdx >= 0) {
          const existing = nextTodos[existingIdx]!;
          nextTodos[existingIdx] = {
            ...existing,
            title: titleText || existing.title,
            status: u.status ?? existing.status,
            priority: u.priority ?? existing.priority,
            ...(u.dependsOn ? { dependsOn: u.dependsOn } : {}),
            ...(u.acceptanceCriteria ? { acceptanceCriteria: u.acceptanceCriteria } : {}),
            ...(u.verificationEvidence ? { verificationEvidence: u.verificationEvidence } : {}),
            updatedAt: nowIso,
          };
        } else {
          nextTodos.push({
            id,
            title: titleText || id,
            status: u.status ?? "pending",
            priority: u.priority ?? "medium",
            ...(u.dependsOn ? { dependsOn: u.dependsOn } : {}),
            ...(u.acceptanceCriteria ? { acceptanceCriteria: u.acceptanceCriteria } : {}),
            ...(u.verificationEvidence ? { verificationEvidence: u.verificationEvidence } : {}),
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      for (const item of nextTodos) {
        if (item.status === "completed" && item.dependsOn && item.dependsOn.length > 0) {
          const unmetDeps = item.dependsOn.filter((depId) => {
            const depItem = nextTodos.find((t) => t.id === depId);
            return depItem && depItem.status !== "completed" && depItem.status !== "cancelled";
          });
          if (unmetDeps.length > 0) {
            return toolError(
              "TODO_DEPENDENCY_UNMET",
              `Cannot mark todo #${item.id} as completed before dependencies are completed: ${unmetDeps.join(", ")}`,
              { category: "validation" }
            );
          }
        }
      }

      saveTodos(nextTodos, workspaceDir);
      return {
        tool_call_id: "",
        output: formatTodoList(nextTodos),
      };
    }

    switch (args.action) {
      case "add": {
        const title = (args.title ?? args.content ?? "").trim();
        if (!title) {
          return toolError(
            "TODO_MISSING_TITLE",
            "Missing 'title' for todo add action. Provide a non-empty task title.",
            { category: "validation" }
          );
        }
        const nextNum =
          todos.reduce((max, t) => {
            const n = Number(t.id);
            return Number.isFinite(n) && n > max ? n : max;
          }, 0) + 1;
        const resolvedId = args.id?.trim() || String(nextNum);
        if (todos.some((t) => t.id === resolvedId)) {
          return toolError("TODO_DUPLICATE_ID", `Duplicate todo ID: ${resolvedId}`, {
            category: "validation",
          });
        }
        const newItem: TodoItem = {
          id: resolvedId,
          title,
          status: args.status ?? "pending",
          priority: args.priority ?? "medium",
          ...(args.dependsOn ? { dependsOn: args.dependsOn } : {}),
          ...(args.acceptanceCriteria ? { acceptanceCriteria: args.acceptanceCriteria } : {}),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        todos.push(newItem);
        saveTodos(todos, workspaceDir);
        return {
          tool_call_id: "",
          output: `✅ 已添加任务 #${newItem.id}: ${newItem.title}`,
        };
      }

      case "list": {
        return {
          tool_call_id: "",
          output: formatTodoList(todos),
        };
      }

      case "done":
      case "cancel":
      case "update": {
        const status = args.action === "done" ? "completed" : args.action === "cancel" ? "cancelled" : args.status;
        if (!args.id || !status) {
          return toolError(
            "TODO_MISSING_UPDATE_FIELDS",
            "Missing 'id' or 'status' for todo update action.",
            { category: "validation" }
          );
        }
        const item = todos.find((t) => t.id === args.id);
        if (!item) {
          return toolError(
            "TODO_NOT_FOUND",
            `Todo #${args.id} was not found. Run todo with action='list' first.`,
            { category: "validation" }
          );
        }
        if (status === "completed" && item.dependsOn && item.dependsOn.length > 0) {
          const unmetDeps = item.dependsOn.filter((depId) => {
            const depItem = todos.find((t) => t.id === depId);
            return depItem && depItem.status !== "completed" && depItem.status !== "cancelled";
          });
          if (unmetDeps.length > 0) {
            return toolError(
              "TODO_DEPENDENCY_UNMET",
              `Cannot mark todo #${args.id} as completed before dependencies are completed: ${unmetDeps.join(", ")}`,
              { category: "validation" }
            );
          }
        }
        item.status = status;
        if (args.title) item.title = args.title.trim();
        if (args.priority) item.priority = args.priority;
        if (args.verificationEvidence) item.verificationEvidence = args.verificationEvidence;
        if (args.acceptanceCriteria) item.acceptanceCriteria = args.acceptanceCriteria;
        item.updatedAt = nowIso;
        saveTodos(todos, workspaceDir);
        return {
          tool_call_id: "",
          output: `✅ 任务 #${item.id} 状态已更新为: ${item.status}`,
        };
      }

      case "remove": {
        if (!args.id) {
          return toolError("TODO_MISSING_ID", "Missing 'id' for todo remove action.", {
            category: "validation",
          });
        }
        const idx = todos.findIndex((t) => t.id === args.id);
        if (idx === -1) {
          return toolError(
            "TODO_NOT_FOUND",
            `Todo #${args.id} was not found. Run todo with action='list' first.`,
            { category: "validation" }
          );
        }
        const removed = todos.splice(idx, 1)[0]!;
        saveTodos(todos, workspaceDir);
        return {
          tool_call_id: "",
          output: `🗑️ 已删除任务 #${removed.id}: ${removed.title}`,
        };
      }

      case "clear": {
        saveTodos([], workspaceDir);
        return { tool_call_id: "", output: "🗑️ 已清空所有任务" };
      }

      default:
        return toolError("TODO_UNKNOWN_ACTION", `Unknown todo action '${String(args.action)}'.`, {
          category: "validation",
        });
    }
  });
}
