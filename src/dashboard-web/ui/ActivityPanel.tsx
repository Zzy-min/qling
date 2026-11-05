import { memo, type CSSProperties } from "react";
import type { DashboardSnapshot } from "../../dashboard/types";
import { dateTime, formatTime } from "../format";

export const ActivityPanel = memo(function ActivityPanel({
  snapshot,
}: {
  snapshot: DashboardSnapshot | null;
}) {
  const activity = snapshot?.activity ?? [];
  const visibleActivity = activity.slice(0, 8);
  const activityCount = snapshot?.boundary.activityTruncated
    ? `最近 ${visibleActivity.length} 条 · 边界截断`
    : activity.length > visibleActivity.length
      ? `最近 ${visibleActivity.length} / ${activity.length} 条`
      : `${activity.length} 条`;
  return (
    <section className="activity-panel" aria-labelledby="activity-heading">
      <div className="section-heading">
        <div>
          <p>LOCAL TRACE</p>
          <h2 id="activity-heading">最近活动</h2>
        </div>
        <span>{activityCount}</span>
      </div>
      {activity.length ? (
        <ol
          style={{
            "--activity-rows": Math.max(1, Math.ceil(visibleActivity.length / 2)),
          } as CSSProperties}
        >
          {visibleActivity.map((event, index) => (
            <li key={`${event.ts}:${index}`}>
              <time dateTime={dateTime(event.ts)}>{formatTime(event.ts)}</time>
              <b>{event.type}</b>
              <span>
                {Object.entries(event.data)
                  .slice(0, 3)
                  .map(([key, value]) => `${key}=${String(value).slice(0, 44)}`)
                  .join(" · ") || "本地事件"}
              </span>
            </li>
          ))}
        </ol>
      ) : snapshot ? (
        <p className="activity-empty">暂无本地活动。任务运行和状态变更会记录在这里。</p>
      ) : (
        <div className="activity-placeholder" aria-hidden="true" />
      )}
    </section>
  );
});