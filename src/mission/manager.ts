// ============================================================
// 轻灵 - Mission Manager (v0.5)
// 负责 Mission 的持久化、状态流转与队列管理
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import { existsSync } from "fs";
import { Mission, MissionStatus, MissionEvent } from "./types.js";

const TERMINAL_STATUSES = new Set<MissionStatus>(["succeeded", "failed", "canceled"]);
const PAUSABLE_STATUSES = new Set<MissionStatus>(["queued", "running", "blocked"]);

export class MissionManager {
  private stateDir: string;
  private missions: Map<string, Mission> = new Map();

  constructor(stateDir: string) {
    this.stateDir = path.join(stateDir, "missions");
  }

  async init(): Promise<void> {
    if (!existsSync(this.stateDir)) {
      await fs.mkdir(this.stateDir, { recursive: true });
    }
    await this.loadMissions();
  }

  async createMission(
    name: string,
    description: string,
    sessionId: string,
    options: { sourceMissionId?: string } = {}
  ): Promise<Mission> {
    const mission: Mission = {
      id: `msn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      description,
      status: "queued",
      sessionId,
      sourceMissionId: options.sourceMissionId,
      lastContext: [],
      metrics: {
        startTime: Date.now(),
        totalTurns: 0,
        totalTokens: 0,
        totalToolCalls: 0,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.missions.set(mission.id, mission);
    await this.saveMission(mission);
    await this.appendEvent({
      missionId: mission.id,
      type: "state_changed",
      timestamp: Date.now(),
      data: {
        from: null,
        to: "queued",
        reason: "mission_created",
        sourceMissionId: options.sourceMissionId ?? null,
      },
    });
    return mission;
  }

  async updateStatus(
    id: string,
    status: MissionStatus,
    error?: Mission["error"],
    meta: Record<string, unknown> = {}
  ): Promise<Mission> {
    const mission = this.getMissionOrThrow(id);
    const previousStatus = mission.status;

    mission.status = status;
    if (error) mission.error = error;
    else if (status !== "failed") delete mission.error;
    mission.updatedAt = Date.now();
    
    if (TERMINAL_STATUSES.has(status)) mission.metrics.endTime = Date.now();
    else delete mission.metrics.endTime;

    await this.saveMission(mission);
    await this.appendEvent({
      missionId: mission.id,
      type: "state_changed",
      timestamp: Date.now(),
      data: {
        from: previousStatus,
        to: status,
        error: error ? { ...error } : null,
        ...meta,
      },
    });
    return mission;
  }

  getMission(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  getMissionOrThrow(id: string): Mission {
    const mission = this.missions.get(id);
    if (!mission) {
      throw this.createMissionError("MISSION_NOT_FOUND", `mission not found: ${id}`, 404);
    }
    return mission;
  }

  listMissions(): Mission[] {
    return Array.from(this.missions.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getMissionLogs(id: string): Promise<MissionEvent[]> {
    this.getMissionOrThrow(id);
    const filePath = this.getEventPath(id);
    if (!existsSync(filePath)) return [];

    const raw = await fs.readFile(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MissionEvent);
  }

  async appendLog(id: string, message: string, meta: Record<string, unknown> = {}): Promise<void> {
    const mission = this.getMissionOrThrow(id);
    mission.updatedAt = Date.now();
    await this.saveMission(mission);
    await this.appendEvent({
      missionId: id,
      type: "log",
      timestamp: Date.now(),
      data: {
        message,
        ...meta,
      },
    });
  }

  async pauseMission(id: string, reason?: string): Promise<Mission> {
    return this.applyControlTransition(id, "pause", "paused", PAUSABLE_STATUSES, reason);
  }

  async resumeMission(id: string, reason?: string): Promise<Mission> {
    return this.applyControlTransition(id, "resume", "queued", new Set(["paused"]), reason);
  }

  async cancelMission(id: string, reason?: string): Promise<Mission> {
    const mission = this.getMissionOrThrow(id);
    if (TERMINAL_STATUSES.has(mission.status)) {
      throw this.createMissionError(
        "MISSION_INVALID_TRANSITION",
        `mission ${id} is already terminal (${mission.status})`,
        409
      );
    }
    return this.applyControlTransition(
      id,
      "cancel",
      "canceled",
      new Set(["queued", "running", "blocked", "paused"]),
      reason
    );
  }

  async retryMission(id: string): Promise<Mission> {
    const mission = this.getMissionOrThrow(id);
    if (!TERMINAL_STATUSES.has(mission.status)) {
      throw this.createMissionError(
        "MISSION_INVALID_TRANSITION",
        `mission ${id} must be terminal before retry`,
        409
      );
    }

    await this.appendEvent({
      missionId: id,
      type: "control",
      timestamp: Date.now(),
      data: {
        action: "retry",
        from: mission.status,
      },
    });

    return this.createMission(mission.name, mission.description, mission.sessionId, {
      sourceMissionId: mission.id,
    });
  }

  private async saveMission(mission: Mission): Promise<void> {
    const filePath = this.getMissionPath(mission.id);
    await fs.writeFile(filePath, JSON.stringify(mission, null, 2), "utf-8");
  }

  private async loadMissions(): Promise<void> {
    const files = await fs.readdir(this.stateDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const raw = await fs.readFile(path.join(this.stateDir, file), "utf-8");
          const mission = JSON.parse(raw) as Mission;
          this.missions.set(mission.id, mission);
        } catch (err) {
          console.error(`[MissionManager] Failed to load mission ${file}: ${(err as Error).message}`);
        }
      }
    }
  }

  private getMissionPath(id: string): string {
    return path.join(this.stateDir, `${id}.json`);
  }

  private getEventPath(id: string): string {
    return path.join(this.stateDir, `${id}.events.jsonl`);
  }

  private async appendEvent(event: MissionEvent): Promise<void> {
    const filePath = this.getEventPath(event.missionId);
    await fs.appendFile(filePath, JSON.stringify(event) + "\n", "utf-8");
  }

  private async applyControlTransition(
    id: string,
    action: "pause" | "resume" | "cancel",
    nextStatus: MissionStatus,
    allowedFrom: Set<MissionStatus>,
    reason?: string
  ): Promise<Mission> {
    const mission = this.getMissionOrThrow(id);
    if (!allowedFrom.has(mission.status)) {
      throw this.createMissionError(
        "MISSION_INVALID_TRANSITION",
        `mission ${id} cannot ${action} from ${mission.status}; allowed from ${Array.from(allowedFrom).join(", ")}`,
        409
      );
    }

    await this.appendEvent({
      missionId: id,
      type: "control",
      timestamp: Date.now(),
      data: {
        action,
        from: mission.status,
        reason: reason ?? null,
      },
    });

    return this.updateStatus(id, nextStatus, undefined, {
      action,
      reason: reason ?? null,
    });
  }

  private createMissionError(code: string, message: string, statusCode: number): Error & { code: string; statusCode: number } {
    const error = new Error(message) as Error & { code: string; statusCode: number };
    error.code = code;
    error.statusCode = statusCode;
    return error;
  }
}
