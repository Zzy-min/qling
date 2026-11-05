const KIND_LABEL: Record<string, string> = { mission: "MISSION", loop: "LOOP", workflow: "WORKFLOW" };

const TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const LOCAL_DATE_TIME_FORMAT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("zh-CN");

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, "")} 亿`;
  if (value >= 10_000) return `${Math.round(value / 10_000)} 万`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")} k`;
  return COMPACT_NUMBER_FORMAT.format(value);
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.toUpperCase();
}

export function formatTime(value?: number): string {
  if (!value) return "—";
  return TIME_FORMAT.format(value);
}

export function localDateTime(value?: number): string | undefined {
  return value ? LOCAL_DATE_TIME_FORMAT.format(value) : undefined;
}

export function dateTime(value?: number): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export function relativeTime(value?: number, now = Date.now()): string {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((now - value) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}