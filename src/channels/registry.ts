// ============================================================
// 轻灵 - Channel Registry（通道注册表）
// ============================================================

import type { Channel } from "./types.js";

export class ChannelRegistry {
  private channels = new Map<string, Channel>();

  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  get(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  getAll(): Channel[] {
    return Array.from(this.channels.values());
  }

  async startAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }
}
