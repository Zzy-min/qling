import { taskStatusLabel } from "../../ui-semantics";

export function Status({ status }: { status: string }) {
  return <span className={`status status-${status}`}><span className="status-mark" aria-hidden="true" />{taskStatusLabel(status)}</span>;
}