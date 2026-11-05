import type { DashboardTaskAction } from "../dashboard/types";

export type ActionTone = "primary" | "default" | "danger";

export interface TaskActionConfirm {
  groupLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface TaskActionSpec {
  label: string;
  busyLabel: string;
  tone: ActionTone;
  confirm?: TaskActionConfirm;
}

export const TASK_ACTION_SPECS: Record<DashboardTaskAction, TaskActionSpec> = {
  pause: {
    label: "暂停",
    busyLabel: "处理中…",
    tone: "default",
  },
  resume: {
    label: "恢复",
    busyLabel: "处理中…",
    tone: "primary",
  },
  cancel: {
    label: "取消",
    busyLabel: "处理中…",
    tone: "danger",
    confirm: {
      groupLabel: "取消任务确认",
      title: "确认取消这个任务？",
      description: "取消会停止当前运行，并保留已有上下文与运行记录。",
      confirmLabel: "确认取消任务",
      cancelLabel: "返回",
    },
  },
  retry: {
    label: "重新执行",
    busyLabel: "处理中…",
    tone: "primary",
  },
};

export function taskActionSpec(action: DashboardTaskAction): TaskActionSpec {
  return TASK_ACTION_SPECS[action];
}

export function taskActionButtonClass(action: DashboardTaskAction): string {
  const tone = TASK_ACTION_SPECS[action].tone;
  return `button${tone === "primary" ? " button-primary" : tone === "danger" ? " button-danger" : ""}`;
}

export function actionPendingKey(
  task: Pick<{ id: string; kind: string }, "id" | "kind">,
  action: DashboardTaskAction
): string {
  return `${task.kind}:${task.id}:${action}`;
}