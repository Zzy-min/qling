import { SlashCommand } from "./types.js";
import { runSkill, getSkillDirs } from "../tools/skill.js";
import { listSkills, searchSkills } from "../skills/registry.js";
import { curateSkillCatalog } from "../skills/skill-catalog.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";

export const skillCommand: SlashCommand = {
  name: "/skill",
  aliases: ["/技能"],
  description: "技能切换器：选择可执行/可读的本地 skill",
  usage: "/skill [list|search <query>|name|archived]",
  execute: async (args, context) => {
    const [subcommand, ...rest] = args;
    const normalized = String(subcommand ?? "").trim().toLowerCase();

    const loadCatalog = async (query?: string) => {
      let dirs: string[] = [];
      try {
        dirs = getSkillDirs();
      } catch {
        dirs = [];
      }
      const raw = query
        ? await searchSkills(query, dirs)
        : await listSkills(dirs);
      return curateSkillCatalog(raw);
    };

    const openSkillPicker = async (query?: string): Promise<boolean> => {
      const { usable, archived } = await loadCatalog(query);
      if (usable.length === 0) {
        context.writeLine(query ? `(无可用匹配: ${query})` : "(无可用技能)");
        if (archived.length > 0) {
          context.writeLine(
            `已归档/占位 ${archived.length} 个 · /skill archived 可查看`
          );
        }
        return false;
      }
      // Grok 对齐：filterable 切换器内可键入（含空格）检索 skill
      // 打开前清空输入区，避免残留 `/skill` 干扰过滤
      if (typeof context.setInputDraft === "function") {
        context.setInputDraft(query ? String(query) : "");
      }
      return openOptionPickerOrFallback(
        context,
        {
          title: query ? `技能 · ${query}` : "技能切换 · Skills",
          footerHint: `键入检索(可空格) · ↑/↓ · Enter 加载 · Esc · 可用 ${usable.length} · 归档 ${archived.length}`,
          filterable: true,
          items: usable.slice(0, 80).map((s) => ({
            id: s.name,
            label: s.name,
            description: (s.description || "").slice(0, 60),
          })),
          onPick: async (item) => {
            if (!item.id) return;
            const result = await runSkill({ name: item.id });
            if (result.is_error) {
              context.writeError(result.output);
              return;
            }
            const lines = String(result.output || "").split("\n");
            const head = lines.slice(0, 40);
            for (const line of head) context.writeLine(line);
            if (lines.length > 40) {
              context.writeLine(
                `… 另有 ${lines.length - 40} 行 · /skill ${item.id}`
              );
            }
          },
        },
        () => {
          for (const s of usable.slice(0, 40)) {
            context.writeLine(
              `- ${s.name}${s.description ? `  ${s.description.slice(0, 50)}` : ""}`
            );
          }
          if (archived.length > 0) {
            context.writeLine(`(另有 ${archived.length} 个已归档/占位 · /skill archived)`);
          }
        }
      );
    };

    if (
      normalized === "" ||
      normalized === "list" ||
      normalized === "ls" ||
      normalized === "pick"
    ) {
      await openSkillPicker();
      return;
    }

    if (normalized === "archived" || normalized === "archive" || normalized === "归档") {
      const { archived } = await loadCatalog();
      if (archived.length === 0) {
        context.writeLine("(无归档项)");
        return;
      }
      // 归档列表也用切换器，仅展示说明（Enter 不加载执行）
      openOptionPickerOrFallback(
        context,
        {
          title: "已归档 / 不可执行 Skills",
          footerHint: "↑/↓ 浏览 · Enter 关闭说明 · Esc 取消 · 不执行",
          items: archived.slice(0, 80).map((s) => ({
            id: s.name,
            label: s.name,
            description: `${(s.description || "占位/模板/重复").slice(0, 40)} · archived`,
          })),
          onPick: (item) => {
            context.writeLine(
              `📦 ${item.label} 已归档（模板/占位/他端），轻灵不加载执行。`
            );
          },
        },
        () => {
          for (const s of archived.slice(0, 40)) {
            context.writeLine(`- ${s.name}  (archived)`);
          }
        }
      );
      return;
    }

    if (normalized === "search") {
      const q = rest.join(" ").trim();
      if (!q) {
        context.writeError("用法: /skill search <query>");
        return;
      }
      await openSkillPicker(q);
      return;
    }

    const result = await runSkill({ name: args.join(" ").trim() });
    if (result.is_error) {
      context.writeError(result.output);
      return;
    }
    context.writeLine(result.output);
  },
};
