import type { SlashCommand } from "./types.js";
import {
  formatSandboxStatusLines,
  parseSandboxProfile,
  resolveSandboxProfile,
  sandboxProfileSummary,
  setSandboxProfile,
  type SandboxProfile,
} from "../runtime/sandbox-profile.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";

const ALL: SandboxProfile[] = ["workspace", "read-only", "strict", "roots", "off"];

export const sandboxCommand: SlashCommand = {
  name: "/sandbox",
  aliases: ["/沙箱", "/sbx"],
  description: "沙箱 profile 切换器",
  usage: "/sandbox [status|workspace|read-only|strict|roots|off]",
  category: "session",
  examples: ["/sandbox", "/sandbox strict", "/sandbox status"],
  execute: async (args, context) => {
    const sub = (args[0] ?? "").toLowerCase();

    const openPicker = (): boolean => {
      const current = resolveSandboxProfile();
      return openOptionPickerOrFallback(
        context,
        {
          title: "沙箱切换 · Sandbox",
          footerHint: "↑/↓ 选择 profile · Enter 应用 · Esc 取消",
          selectedId: current,
          items: ALL.map((id) => ({
            id,
            label: id,
            description: sandboxProfileSummary(id),
            active: id === current,
          })),
          onPick: (item) => {
            const profile = parseSandboxProfile(item.id);
            if (!profile) return;
            setSandboxProfile(profile);
            context.writeLine(`🛡️ Sandbox → ${resolveSandboxProfile()}`);
          },
        },
        () => {
          for (const line of formatSandboxStatusLines()) {
            context.writeLine(line);
          }
        }
      );
    };

    if (!sub || sub === "list" || sub === "ls" || sub === "pick" || sub === "ui") {
      openPicker();
      return;
    }
    if (sub === "status" || sub === "状态") {
      for (const line of formatSandboxStatusLines()) {
        context.writeLine(line);
      }
      return;
    }
    const profile = parseSandboxProfile(sub);
    if (!profile) {
      context.writeError(`未知 profile: ${sub}。可用: ${ALL.join(", ")}`);
      return;
    }
    setSandboxProfile(profile);
    context.writeLine(`🛡️ Sandbox → ${resolveSandboxProfile()}`);
  },
};
