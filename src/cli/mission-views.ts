import type { Mission, MissionEvent, MissionStatus } from "../mission/types.js";

const TERMINAL_STATUSES = new Set<MissionStatus>(["succeeded", "failed", "canceled"]);

type MissionBucket = "Working" | "Needs Input" | "Completed";

interface MissionReader {
  getMission: () => Promise<Mission>;
  getLogs: () => Promise<MissionEvent[]>;
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

export function isTerminalMissionStatus(status: MissionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function renderAgentsView(missions: Mission[]): string {
  const buckets: Record<MissionBucket, Mission[]> = {
    Working: [],
    "Needs Input": [],
    Completed: [],
  };

  for (const mission of missions) {
    buckets[classifyMissionBucket(mission.status)].push(mission);
  }

  const lines: string[] = ["📂 【Agents】"];
  for (const bucket of ["Working", "Needs Input", "Completed"] as MissionBucket[]) {
    lines.push(`\n${bucket}`);
    lines.push("-----------------------------------------");
    const items = buckets[bucket].sort((a, b) => b.createdAt - a.createdAt);
    if (items.length === 0) {
      lines.push("(无)");
      continue;
    }
    for (const mission of items) {
      lines.push(`- [${mission.status.toUpperCase()}] ${mission.id} | ${mission.name}`);
      lines.push(`  时间: ${formatTimestamp(mission.createdAt)}`);
      lines.push(`  任务: ${mission.description.slice(0, 80)}`);
    }
  }
  return lines.join("\n");
}

export function renderMissionEvents(events: MissionEvent[]): string {
  if (events.length === 0) return "(无日志)";
  return events.map(renderMissionEvent).join("\n");
}

export async function followMissionAttach(
  missionId: string,
  reader: MissionReader,
  options: { pollMs?: number } = {}
): Promise<void> {
  const pollMs = options.pollMs ?? 500;
  let lastStatus: MissionStatus | null = null;
  let lastEventCount = 0;

  console.log(`🔗 以只读跟随模式 attach 到使命 ${missionId}`);
  console.log("提示: 这不是交互式接管，只会持续打印新增日志与状态变化。\n");

  while (true) {
    const [mission, logs] = await Promise.all([reader.getMission(), reader.getLogs()]);

    if (mission.status !== lastStatus) {
      console.log(`[status] ${mission.status} @ ${formatTimestamp(mission.updatedAt)}`);
      lastStatus = mission.status;
    }

    if (logs.length > lastEventCount) {
      const newEvents = logs.slice(lastEventCount);
      console.log(renderMissionEvents(newEvents));
      lastEventCount = logs.length;
    }

    if (isTerminalMissionStatus(mission.status)) {
      console.log(`\n✅ attach 结束，最终状态: ${mission.status}`);
      return;
    }

    await sleep(pollMs);
  }
}

function classifyMissionBucket(status: MissionStatus): MissionBucket {
  if (status === "queued" || status === "running") return "Working";
  if (status === "blocked" || status === "paused") return "Needs Input";
  return "Completed";
}

function renderMissionEvent(event: MissionEvent): string {
  const timestamp = formatTimestamp(event.timestamp);
  if (event.type === "state_changed") {
    return `[${timestamp}] state ${String(event.data.from ?? "null")} -> ${String(event.data.to)}`;
  }
  if (event.type === "control") {
    return `[${timestamp}] control ${String(event.data.action)} from ${String(event.data.from)} reason=${String(event.data.reason ?? "")}`;
  }
  return `[${timestamp}] log ${String(event.data.message ?? "")}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
