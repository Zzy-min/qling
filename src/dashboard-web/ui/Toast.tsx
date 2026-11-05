import { useEffect } from "react";
import { m } from "motion/react";
import { Icon } from "./Icon";

export interface Notice {
  message: string;
  kind: "status" | "error";
}

export function Toast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3600);
    return () => window.clearTimeout(timer);
  }, [notice, onClose]);

  return (
    <m.div
      className={`toast toast-${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
    >
      <span>{notice.message}</span>
      <button type="button" aria-label="关闭通知" onClick={onClose}>
        <Icon name="close" size={15} />
      </button>
    </m.div>
  );
}