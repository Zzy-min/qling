import { memo } from "react";
import type { DashboardSnapshot } from "../../dashboard/types";
import { dateTime, formatTime } from "../format";
import { summaryMetrics } from "../model";
import { Icon } from "./Icon";

interface HeaderProps {
  snapshot: DashboardSnapshot | null;
  snapshotError: string;
  refreshing: boolean;
  onRefresh: () => void;
}

export const DashboardHeader = memo(function DashboardHeader({
  snapshot,
  snapshotError,
  refreshing,
  onRefresh,
}: HeaderProps) {
  const connectionLabel = snapshot?.runtime.ready
    ? "运行时就绪"
    : snapshotError
      ? "本地连接异常"
      : "连接本地运行时";

  return (
    <header className="command-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">灵</span>
        <div>
          <p>MISSION CONTROL · LOCAL ONLY</p>
          <h1>轻灵任务工作台</h1>
        </div>
      </div>
      <div className="runtime" aria-live="polite">
        <span
          className={`runtime-dot${snapshot?.runtime.ready ? " ready" : snapshotError ? " error" : ""}`}
          aria-hidden="true"
        />
        <span>{connectionLabel}</span>
        <span className="runtime-meta">{snapshot?.runtime.daemonHealthy ? "DAEMON" : "LOCAL"}</span>
        <span className="runtime-meta">权限 {snapshot?.runtime.permissionMode ?? "—"}</span>
        <button
          className="button button-ghost refresh-button"
          type="button"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={onRefresh}
        >
          <Icon name="refresh" size={16} />
          <span>{refreshing ? "刷新中" : "刷新"}</span>
        </button>
      </div>
    </header>
  );
});

export function TrustLine({ snapshot }: { snapshot: DashboardSnapshot | null }) {
  return (
    <section className="trust-line" aria-label="本地安全边界">
      <span>127.0.0.1</span>
      <span>任务正文不外传</span>
      <span>本地控制面</span>
      <span>{snapshot?.runtime.sessionId?.slice(0, 14) ?? "等待会话"}</span>
    </section>
  );
}

export function SummaryStrip({ snapshot }: { snapshot: DashboardSnapshot | null }) {
  const summary = snapshot?.summary;
  return (
    <section className="situation" aria-label="任务摘要" aria-busy={!snapshot}>
      <div className="situation-lead">
        <span>任务总数</span>
        <strong>{summary?.total ?? "—"}</strong>
      </div>
      {summaryMetrics(snapshot).map(({ key, label, value }) => (
        <div className={`metric metric-${key}${value ? " has-value" : ""}`} key={key}>
          <span>{label}</span>
          <strong>{value ?? "—"}</strong>
        </div>
      ))}
      <time dateTime={dateTime(snapshot?.generatedAt)}>
        <span>最近同步</span>
        <strong>{formatTime(snapshot?.generatedAt)}</strong>
      </time>
    </section>
  );
}