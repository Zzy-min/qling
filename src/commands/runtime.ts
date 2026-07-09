import { AgentLoop } from "../agent-loop.js";
import { SessionScheduler } from "../session/session-scheduler.js";
import { SessionGoalController } from "../session/goal-controller.js";
import type { SavedSessionSummary } from "../session/session-registry.js";
import type { SessionTask } from "../session/session-scheduler.js";
import type { SessionGoalState } from "../session/session-goal-manager.js";

export interface DaemonSessionApi {
  createLoopTask: (
    sessionId: string,
    payload: {
      prompt: string;
      intervalMs: number;
      mode: "fixed" | "default";
      runner: "daemon";
    }
  ) => Promise<SessionTask>;
  setGoal: (sessionId: string, condition: string, stats?: { turnCount: number; tokens: number }) => Promise<SessionGoalState>;
  getGoal?: (sessionId: string) => Promise<SessionGoalState | null>;
  clearGoal?: (sessionId: string) => Promise<SessionGoalState>;
  listLoopTasks?: (sessionId: string) => Promise<SessionTask[]>;
  cancelLoopTask?: (sessionId: string, taskId: string) => Promise<SessionTask>;
  clearLoopTasks?: (sessionId: string) => Promise<number>;
}

export interface SlashCommandContext {
  agentLoop: AgentLoop | Record<string, any>;
  scheduler?: SessionScheduler | Record<string, any>;
  goalController?: SessionGoalController | Record<string, any>;
  inputQueue?: {
    pendingCount: number;
    maxPending?: number;
    isProcessing?: boolean;
  };
  workspaceDir?: string;
  homeDir?: string;
  listSavedSessions?: () => Promise<SavedSessionSummary[]>;
  switchSession?: (target?: string) => Promise<(SavedSessionSummary & {
    activeTaskCount?: number;
    activeGoalStatus?: string | null;
  }) | null>;
  daemonSessionApi?: DaemonSessionApi;
  statusLine?: {
    enabled: boolean;
    setEnabled: (enabled: boolean) => void;
    getLine: () => Promise<string>;
  };
  /** 长工具输出折叠：与 Ctrl+O 同源 */
  toolOutput?: {
    expanded: boolean;
    setExpanded: (expanded: boolean) => void;
    toggle: () => boolean;
  };
  setImmediatePrompt?: (prompt: string) => void;
  onModelChanged?: (model: string) => void | Promise<void>;
  writeClipboard?: (text: string) => Promise<void>;
  writeLine: (line?: string) => void;
  writeError: (line?: string) => void;
}

export function withDefaultWriters(
  context: Partial<SlashCommandContext> & { agentLoop: AgentLoop | Record<string, any> }
): SlashCommandContext {
  return {
    scheduler: context.scheduler,
    goalController: context.goalController,
    inputQueue: context.inputQueue,
    workspaceDir: context.workspaceDir,
    homeDir: context.homeDir,
    listSavedSessions: context.listSavedSessions,
    switchSession: context.switchSession,
    daemonSessionApi: context.daemonSessionApi,
    statusLine: context.statusLine,
    toolOutput: context.toolOutput,
    setImmediatePrompt: context.setImmediatePrompt,
    onModelChanged: context.onModelChanged,
    writeClipboard: context.writeClipboard,
    writeLine: context.writeLine ?? ((line = "") => console.log(line)),
    writeError: context.writeError ?? ((line = "") => console.error(line)),
    agentLoop: context.agentLoop,
  };
}
