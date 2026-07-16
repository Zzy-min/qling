// ============================================================
// session-fleet — TUI 会话舰队行模型（对标 Grok Dashboard rows）
//
// Grok 源码依据：
// - views/dashboard/row.rs  classify_top_level / build_rows / RowBadge
// - views/dashboard/state.rs RowState group_priority
// - 23-dashboard.md          状态点 · 次行 · 可扫性
//
// 轻灵诚实边界：磁盘会话无 live agent 时，用 active + 时效近似
// NeedsInput/Working/Idle/Inactive 子集：active | idle | stale。
// ============================================================

export type SessionFleetState = "active" | "idle" | "stale";

export interface SessionFleetInput {
  sessionId: string;
  name: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  sessionTokens?: number;
  workspaceDir?: string | null;
  active?: boolean;
}

export interface SessionFleetRow {
  sessionId: string;
  name: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  sessionTokens: number;
  workspaceDir: string | null;
  active: boolean;
  state: SessionFleetState;
  /** 相对时间（如 12m / 2h / 3d） */
  ageLabel: string;
  /** 状态图标：● active · ○ idle · · stale */
  stateIcon: string;
  /** 主行标签（无 mark） */
  primaryLabel: string;
  /** 次行元数据 */
  secondaryLine: string;
}

/** Idle 与 stale 分界：24h（对标 Grok Idle 新鲜窗口的简化） */
export const FLEET_STALE_MS = 24 * 60 * 60 * 1000;

const STATE_PRIORITY: Record<SessionFleetState, number> = {
  active: 3,
  idle: 2,
  stale: 1,
};

const STATE_ICON: Record<SessionFleetState, string> = {
  active: "●",
  idle: "○",
  stale: "·",
};

export function fleetStatePriority(state: SessionFleetState): number {
  return STATE_PRIORITY[state];
}

export function fleetStateIcon(state: SessionFleetState): string {
  return STATE_ICON[state];
}

export function fleetStateLabel(state: SessionFleetState): string {
  switch (state) {
    case "active":
      return "当前";
    case "idle":
      return "近期";
    case "stale":
      return "陈旧";
  }
}

/**
 * 对标 Grok classify_top_level 的磁盘会话近似：
 * - 当前会话 → active（Grok Idle 中的「你在看的那一个」+ 高亮）
 * - 24h 内 → idle
 * - 更早 → stale（≈ Inactive）
 */
export function classifySessionFleetState(
  item: Pick<SessionFleetInput, "active" | "updatedAt">,
  nowMs: number = Date.now()
): SessionFleetState {
  if (item.active) return "active";
  const ts = Date.parse(item.updatedAt);
  if (Number.isNaN(ts)) return "stale";
  if (nowMs - ts <= FLEET_STALE_MS) return "idle";
  return "stale";
}

/** 对标 Grok age 列：紧凑相对时间 */
export function relativeAge(iso: string, nowMs: number = Date.now()): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso.slice(0, 16);
  const delta = Math.max(0, nowMs - ts);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mon = Math.floor(day / 30);
  return `${mon}mo`;
}

function shortWorkspace(dir: string | null | undefined): string | null {
  if (!dir) return null;
  const normalized = dir.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return parts.slice(-2).join("/");
}

function compactId(sessionId: string): string {
  return sessionId.length > 18 ? sessionId.slice(0, 16) + "…" : sessionId;
}

export function buildSessionFleetRow(
  item: SessionFleetInput,
  nowMs: number = Date.now()
): SessionFleetRow {
  const state = classifySessionFleetState(item, nowMs);
  const ageLabel = relativeAge(item.updatedAt, nowMs);
  const tokens = item.sessionTokens ?? 0;
  const ws = shortWorkspace(item.workspaceDir);
  const tokenPart =
    tokens > 0
      ? tokens >= 1000
        ? `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k tok`
        : `${tokens} tok`
      : null;
  const secondaryParts = [
    ageLabel,
    `${item.turnCount}t`,
    `${item.messageCount}m`,
    tokenPart,
    ws,
    compactId(item.sessionId),
  ].filter(Boolean) as string[];

  return {
    sessionId: item.sessionId,
    name: item.name,
    updatedAt: item.updatedAt,
    turnCount: item.turnCount,
    messageCount: item.messageCount,
    sessionTokens: tokens,
    workspaceDir: item.workspaceDir ?? null,
    active: Boolean(item.active),
    state,
    ageLabel,
    stateIcon: fleetStateIcon(state),
    primaryLabel: `${fleetStateIcon(state)} ${item.name}${item.active ? " · 当前" : ""}`,
    secondaryLine: secondaryParts.join(" · "),
  };
}

/**
 * 对标 Grok sort_rows / group_priority：
 * 状态优先级降序，同级 updatedAt 降序。
 */
export function sortSessionFleet(
  items: SessionFleetInput[],
  nowMs: number = Date.now()
): SessionFleetRow[] {
  const rows = items.map((item) => buildSessionFleetRow(item, nowMs));
  rows.sort((a, b) => {
    const dp = fleetStatePriority(b.state) - fleetStatePriority(a.state);
    if (dp !== 0) return dp;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
  return rows;
}

/** Web / CLI 深链：与 startup-contract --resume 对齐 */
export function formatResumeCommand(sessionId: string, bin = "qling"): string {
  const id = sessionId.trim();
  if (!id) return `${bin} --resume <session-id>`;
  // 含空格时加引号
  if (/\s/.test(id)) return `${bin} --resume "${id}"`;
  return `${bin} --resume ${id}`;
}

export const FLEET_EMPTY_HINT =
  "尚无会话 — 在下方输入开始第一轮对话 · Web 任务台用 /dashboard web";

export const FLEET_PANEL_TITLE = "会话舰队 · Session Dashboard";
