// ============================================================
// Slash / adapter shared context (adapters layer)
// Kept out of cli/ so reports & TUI can import without reverse deps.
// ============================================================

import type { AgentLoop } from "./agent-loop.js";
import type { SessionScheduler } from "./session/session-scheduler.js";
import type { SessionGoalController } from "./session/goal-controller.js";
import type { SavedSessionSummary } from "./session/session-registry.js";
import type { SessionTask } from "./session/session-scheduler.js";
import type { SessionGoalState } from "./session/session-goal-manager.js";

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
  setGoal: (
    sessionId: string,
    condition: string,
    stats?: { turnCount: number; tokens: number }
  ) => Promise<SessionGoalState>;
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
  switchSession?: (
    target?: string
  ) => Promise<
    | (SavedSessionSummary & {
        activeTaskCount?: number;
        activeGoalStatus?: string | null;
      })
    | null
  >;
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
    /** 重放并展开最近一次工具输出 */
    expandLast?: () => boolean;
  };
  /** G1: 打开 TUI 会话切换器 */
  openSessionPicker?: () => void;
  /** 通用选项切换器（model/theme/sandbox/mode…）；无则命令降级文本列表 */
  openOptionPicker?: (spec: import("./tui/overlay-panel.js").OptionPickerSpec) => void;
  /** 主题等变更后清屏重画顶栏+输入框（append-only 下唯一可靠方式） */
  repaintChrome?: () => void;
  /** 原位更新 Mode/Perm 外观（不重打输入框） */
  applySessionChrome?: (patch: {
    sessionMode?: string;
    permissionMode?: string;
  }) => void;
  setImmediatePrompt?: (prompt: string) => void;
  setInputDraft?: (draft: string) => void;
  onRecoveryStateChanged?: (state: unknown | null) => void;
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
    // 必须透传：否则 /resume、/sessions、/model 等会丢 TUI 切换器，降级成文本列表
    openSessionPicker: context.openSessionPicker,
    openOptionPicker: context.openOptionPicker,
    repaintChrome: context.repaintChrome,
    applySessionChrome: context.applySessionChrome,
    setImmediatePrompt: context.setImmediatePrompt,
    setInputDraft: context.setInputDraft,
    onRecoveryStateChanged: context.onRecoveryStateChanged,
    onModelChanged: context.onModelChanged,
    writeClipboard: context.writeClipboard,
    writeLine: context.writeLine ?? ((line = "") => console.log(line)),
    writeError: context.writeError ?? ((line = "") => console.error(line)),
    agentLoop: context.agentLoop,
  };
}
