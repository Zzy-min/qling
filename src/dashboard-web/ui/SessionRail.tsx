import { memo } from "react";
import type { DashboardSessionSummary } from "../../dashboard/types";
import { compactNumber } from "../format";
import { Icon } from "./Icon";
import { RelativeTime } from "./RelativeTime";

interface SessionRailProps {
  sessions: readonly DashboardSessionSummary[];
  onCopy: (session: DashboardSessionSummary) => void;
}

export const SessionRail = memo(function SessionRail({ sessions, onCopy }: SessionRailProps) {
  return (
    <nav className="session-rail" aria-label="最近会话">
      <div className="rail-heading">
        <span>SESSIONS</span>
        <b>{sessions.length}</b>
      </div>
      {sessions.length ? sessions.map((session) => {
        const updatedAt = Date.parse(session.updatedAt);
        return (
          <div
            className={`session-item${session.active ? " active" : ""}`}
            key={session.sessionId}
            aria-current={session.active ? "true" : undefined}
          >
            <div className="session-heading">
              <span className="session-name" title={session.name}>{session.name}</span>
              {session.resumeCommand && (
                <button
                  className="session-copy"
                  type="button"
                  aria-label={`复制 ${session.name} 的恢复命令`}
                  title="复制恢复命令"
                  onClick={() => onCopy(session)}
                >
                  <Icon name="copy" size={14} />
                  <span>复制</span>
                </button>
              )}
            </div>
            <small title={`${session.turnCount} 轮 · ${session.sessionTokens.toLocaleString("zh-CN")} Token`}>
              {session.turnCount} 轮 · {compactNumber(session.sessionTokens)} Token
              {" · "}
              <RelativeTime value={Number.isFinite(updatedAt) ? updatedAt : undefined} />
            </small>
            <code title={session.resumeCommand}>{session.resumeCommand}</code>
          </div>
        );
      }) : <p className="rail-empty">暂无最近会话。可在 TUI 开始对话。</p>}
    </nav>
  );
});