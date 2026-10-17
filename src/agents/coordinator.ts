import path from "node:path";

export type CoordinatedSubagentRole = "explore" | "implement" | "review";
export type CoordinatedSubtaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface SubtaskSpec {
  id: string;
  parentTaskId?: string;
  objective: string;
  returnContract: string;
  role: CoordinatedSubagentRole;
  readOnly: boolean;
  ownedPaths: string[];
  workspaceMode: "shared_readonly" | "worktree";
  worktreePath?: string;
  budget: { wallClockMs: number; tokens: number; toolCalls: number };
  allowedCommunication: string[];
  cancellation: "cascade" | "independent";
  acceptance: string[];
}

export interface CoordinatedSubtask {
  spec: SubtaskSpec;
  status: CoordinatedSubtaskStatus;
  startedAt?: number;
  completedAt?: number;
  reason?: string;
}

export interface SubagentMessage {
  from: string;
  to: string;
  message: string;
  timestamp: number;
}

function normalizedOwnership(value: string): string {
  return path.normalize(value).replace(/^[.][\\/]/, "").toLowerCase();
}

function pathsOverlap(left: string, right: string): boolean {
  const a = normalizedOwnership(left);
  const b = normalizedOwnership(right);
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

export function shouldDelegateTask(input: {
  independent: boolean;
  expectedNewInformation: boolean;
  estimatedBenefit: number;
  coordinationCost: number;
}): boolean {
  return input.independent && input.expectedNewInformation && input.estimatedBenefit > input.coordinationCost;
}

export class SubagentCoordinator {
  private readonly tasks = new Map<string, CoordinatedSubtask>();
  private readonly mailboxes = new Map<string, SubagentMessage[]>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  register(spec: SubtaskSpec): CoordinatedSubtask {
    if (this.tasks.has(spec.id)) throw new Error(`subtask already registered: ${spec.id}`);
    if (spec.role === "implement" && (spec.readOnly || spec.workspaceMode !== "worktree" || spec.ownedPaths.length === 0)) {
      throw new Error("implement subtasks require write ownership and worktree isolation");
    }
    if (spec.role !== "implement" && !spec.readOnly) {
      throw new Error(`${spec.role} subtasks must remain read-only`);
    }
    if (!spec.readOnly) {
      for (const existing of this.tasks.values()) {
        if (existing.spec.readOnly || ["completed", "failed", "canceled"].includes(existing.status)) continue;
        for (const owned of spec.ownedPaths) {
          const conflict = existing.spec.ownedPaths.find((candidate) => pathsOverlap(owned, candidate));
          if (conflict) throw new Error(`ownership conflict: ${owned} overlaps ${conflict} (${existing.spec.id})`);
        }
      }
    }
    const task: CoordinatedSubtask = { spec: structuredClone(spec), status: "queued" };
    this.tasks.set(spec.id, task);
    this.mailboxes.set(spec.id, []);
    return structuredClone(task);
  }

  start(id: string): CoordinatedSubtask {
    return this.transition(id, "running");
  }

  complete(id: string): CoordinatedSubtask {
    return this.transition(id, "completed");
  }

  fail(id: string, reason: string): CoordinatedSubtask {
    return this.transition(id, "failed", reason);
  }

  cancel(id: string, reason: string): CoordinatedSubtask {
    const root = this.transition(id, "canceled", reason);
    for (const child of this.tasks.values()) {
      if (
        child.spec.parentTaskId === id &&
        child.spec.cancellation === "cascade" &&
        !["completed", "failed", "canceled"].includes(child.status)
      ) {
        this.cancel(child.spec.id, `parent ${id} canceled: ${reason}`);
      }
    }
    return root;
  }

  sendMessage(from: string, to: string, message: string): SubagentMessage {
    const sender = this.requireTask(from);
    if (!sender.spec.allowedCommunication.includes(to)) {
      throw new Error(`communication from ${from} to ${to} is not allowed`);
    }
    this.requireTask(to);
    const envelope = { from, to, message, timestamp: this.now() };
    this.mailboxes.get(to)!.push(envelope);
    return { ...envelope };
  }

  readMailbox(id: string): SubagentMessage[] {
    this.requireTask(id);
    return (this.mailboxes.get(id) ?? []).map((message) => ({ ...message }));
  }

  get(id: string): CoordinatedSubtask {
    return structuredClone(this.requireTask(id));
  }

  list(): CoordinatedSubtask[] {
    return [...this.tasks.values()].map((task) => structuredClone(task));
  }

  private transition(id: string, status: CoordinatedSubtaskStatus, reason?: string): CoordinatedSubtask {
    const task = this.requireTask(id);
    task.status = status;
    if (status === "running" && task.startedAt === undefined) task.startedAt = this.now();
    if (["completed", "failed", "canceled"].includes(status)) task.completedAt = this.now();
    task.reason = reason;
    return structuredClone(task);
  }

  private requireTask(id: string): CoordinatedSubtask {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`subtask not found: ${id}`);
    return task;
  }
}

let coordinator: SubagentCoordinator | null = null;

export function getSubagentCoordinator(): SubagentCoordinator {
  coordinator ??= new SubagentCoordinator();
  return coordinator;
}
