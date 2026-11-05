import { dateTime, localDateTime, relativeTime } from "../format";
import { useNow } from "../hooks/useNow";

export function RelativeTime({
  value,
  className,
}: {
  value?: number;
  className?: string;
}) {
  const now = useNow();
  return (
    <time className={className} dateTime={dateTime(value)} title={localDateTime(value)}>
      {relativeTime(value, now)}
    </time>
  );
}