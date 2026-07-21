import axios, { AxiosInstance } from "axios";

import type { SessionTask } from "./session-scheduler.js";
import type { SessionGoalState } from "./session-goal-manager.js";
import { daemonAuthHeaders } from "../daemon-security.js";

export class DaemonSessionApi {
  private readonly client: AxiosInstance;

  constructor(baseUrl?: string) {
    const port = process.env.QLING_DAEMON_PORT || "9998";
    this.client = axios.create({
      baseURL: baseUrl ?? `http://127.0.0.1:${port}`,
      timeout: 3_000,
      headers: daemonAuthHeaders(),
    });
  }

  async createLoopTask(
    sessionId: string,
    payload: {
      prompt: string;
      intervalMs: number;
      mode: "fixed" | "default";
      runner: "daemon";
    }
  ): Promise<SessionTask> {
    const response = await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/loop-tasks`, payload);
    return response.data as SessionTask;
  }

  async setGoal(
    sessionId: string,
    condition: string,
    stats?: { turnCount: number; tokens: number }
  ): Promise<SessionGoalState> {
    const response = await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/goal`, {
      condition,
      stats,
    });
    return response.data as SessionGoalState;
  }

  async clearGoal(sessionId: string): Promise<SessionGoalState> {
    const response = await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/goal/clear`, {});
    return response.data as SessionGoalState;
  }

  async getGoal(sessionId: string): Promise<SessionGoalState | null> {
    const response = await this.client.get(`/sessions/${encodeURIComponent(sessionId)}/goal`);
    return response.data as SessionGoalState | null;
  }

  async listLoopTasks(sessionId: string): Promise<SessionTask[]> {
    const response = await this.client.get(`/sessions/${encodeURIComponent(sessionId)}/loop-tasks`);
    return (response.data as SessionTask[]) ?? [];
  }

  async cancelLoopTask(sessionId: string, taskId: string): Promise<SessionTask> {
    const response = await this.client.post(
      `/sessions/${encodeURIComponent(sessionId)}/loop-tasks/${encodeURIComponent(taskId)}/cancel`,
      {}
    );
    return response.data as SessionTask;
  }

  async clearLoopTasks(sessionId: string): Promise<number> {
    const tasks = await this.listLoopTasks(sessionId);
    const active = tasks.filter((task) => task.status === "active" || task.status === "running");
    let count = 0;
    for (const task of active) {
      await this.cancelLoopTask(sessionId, task.id);
      count += 1;
    }
    return count;
  }
}
