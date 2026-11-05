import { memo } from "react";
import type { DashboardTask } from "../../dashboard/types";
import { kindLabel } from "../format";
import { RelativeTime } from "./RelativeTime";
import { Status } from "./Status";

interface TaskRowProps {
  task: DashboardTask;
  selected: boolean;
  tabIndex: number;
  onSelect: (task: DashboardTask, trigger: HTMLButtonElement) => void;
  onNavigate: (event: React.KeyboardEvent<HTMLButtonElement>, task: DashboardTask) => void;
  onFocus: (task: DashboardTask) => void;
}

/**
 * Row content is intentionally static. Filter changes mount/unmount rows;
 * polling does not animate every row with a layout projection.
 */
export const TaskRow = memo(function TaskRow({
  task,
  selected,
  tabIndex,
  onSelect,
  onNavigate,
  onFocus,
}: TaskRowProps) {
  return (
    <button
      type="button"
      className={`task-row${selected ? " selected" : ""}`}
      data-task-key={`${task.kind}:${task.id}`}
      tabIndex={tabIndex}
      aria-expanded={selected}
      aria-controls="task-detail"
      onClick={(event) => onSelect(task, event.currentTarget)}
      onKeyDown={(event) => onNavigate(event, task)}
      onFocus={() => onFocus(task)}
    >
      <span className="task-signal" data-status={task.status} aria-hidden="true" />
      <span className="task-copy">
        <span className="task-meta">
          <span>{kindLabel(task.kind)}</span>
          <Status status={task.status} />
          <span>{task.source.toUpperCase()}</span>
        </span>
        <strong className="task-title">{task.title}</strong>
        <span className="task-description">{task.description || "无补充说明"}</span>
      </span>
      <RelativeTime value={task.updatedAt} className="task-time" />
    </button>
  );
});