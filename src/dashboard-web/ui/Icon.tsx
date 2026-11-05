export type IconName = "search" | "refresh" | "close" | "inbox" | "error" | "arrow" | "copy" | "warning";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "search" && <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>}
      {name === "refresh" && <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-1.7 4.6L20 14" /></>}
      {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
      {name === "inbox" && <><path d="M4 5.5h16v13H4z" /><path d="M4 14h4l1.5 2h5l1.5-2h4" /></>}
      {name === "error" && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v5.5M12 16.5h.01" /></>}
      {name === "arrow" && <><path d="M5 12h14M14 7l5 5-5 5" /></>}
      {name === "copy" && <><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>}
      {name === "warning" && <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4M12 16h.01" /></>}
    </svg>
  );
}