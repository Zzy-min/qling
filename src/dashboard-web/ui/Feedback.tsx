import { Icon } from "./Icon";

export function EmptyState({
  error = false, title, description, actionLabel, onAction,
}: {
  error?: boolean;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`empty-state${error ? " error-state" : ""}`} role={error ? "alert" : "status"}>
      <span className="empty-icon"><Icon name={error ? "error" : "inbox"} size={24} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {actionLabel && onAction && <button className="button button-ghost" type="button" onClick={onAction}>{actionLabel}<Icon name="arrow" size={16} /></button>}
    </div>
  );
}

export function TaskListSkeleton() {
  return (
    <div className="task-skeleton" role="status">
      <span className="sr-only">正在读取本地任务</span>
      {[0, 1, 2].map((item) => <div className="skeleton-row" aria-hidden="true" key={item}><span /><div><i /><i /><i /></div></div>)}
    </div>
  );
}