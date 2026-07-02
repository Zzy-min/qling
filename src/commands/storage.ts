import { buildLocalStorageReport, formatLocalStorageReport } from "../local-storage-report.js";
import { SlashCommand } from "./types.js";
import { homedir } from "os";
import { join } from "path";
import { readdir, rm, stat } from "fs/promises";

interface CleanCandidate {
  path: string;
  reason: string;
}

async function findCleanCandidates(stateDir: string): Promise<CleanCandidate[]> {
  const cands: CleanCandidate[] = [];

  // 1. runtime root temp scripts (tmp_*)
  try {
    const entries = await readdir(stateDir);
    for (const e of entries) {
      if (/^tmp_/.test(e) && (e.endsWith(".py") || e.endsWith(".ps1") || e.endsWith(".sh") || e.endsWith(".js"))) {
        cands.push({ path: join(stateDir, e), reason: "runtime temp script" });
      }
    }
  } catch {}

  // 2. cache contents (treat as cleanable for this command)
  const cacheDir = join(stateDir, "cache");
  try {
    const entries = await readdir(cacheDir);
    for (const e of entries) {
      cands.push({ path: join(cacheDir, e), reason: "cache item" });
    }
  } catch {}

  // 3. empty missions / session-tasks
  for (const sub of ["missions", "session-tasks"]) {
    const p = join(stateDir, sub);
    try {
      const entries = await readdir(p);
      if (entries.length === 0) {
        cands.push({ path: p, reason: `empty ${sub}` });
      } else {
        // if only empty subdirs, still offer
        let allEmpty = true;
        for (const ch of entries) {
          const st = await stat(join(p, ch));
          if (st.isDirectory()) {
            const subch = await readdir(join(p, ch)).catch(() => []);
            if (subch.length > 0) allEmpty = false;
          } else {
            allEmpty = false;
          }
        }
        if (allEmpty) cands.push({ path: p, reason: `empty ${sub} tree` });
      }
    } catch {}
  }

  return cands;
}

async function performClean(cands: CleanCandidate[], dryRun: boolean): Promise<string[]> {
  const results: string[] = [];
  for (const c of cands) {
    if (dryRun) {
      results.push(`[dry] would remove: ${c.path} (${c.reason})`);
      continue;
    }
    try {
      const st = await stat(c.path);
      if (st.isDirectory()) {
        await rm(c.path, { recursive: true, force: true });
      } else {
        await rm(c.path, { force: true });
      }
      results.push(`removed: ${c.path} (${c.reason})`);
    } catch (e: any) {
      results.push(`error removing ${c.path}: ${e?.message || e}`);
    }
  }
  return results;
}

export const storageCommand: SlashCommand = {
  name: "/storage",
  aliases: ["/存储"],
  description: "查看本地数据存储占用，或执行保守清理 (clean --dry-run | --yes)",
  usage: "/storage [clean --dry-run | --yes]",
  execute: async (args: string[] = [], context) => {
    const sub = (args[0] || "").toLowerCase();
    const hasClean = sub === "clean";
    const dry = args.includes("--dry-run") || args.includes("-n");
    const yes = args.includes("--yes") || args.includes("-y");

    if (!hasClean) {
      const report = await buildLocalStorageReport(context);
      for (const line of formatLocalStorageReport(report)) {
        context.writeLine(line);
      }
      context.writeLine("提示: qling storage clean --dry-run 或 /storage clean --dry-run   查看可安全清理项");
      context.writeLine("      qling storage clean --yes     或 /storage clean --yes       执行清理（仅临时脚本/cache/空 missions）");
      return;
    }

    // clean mode - NEVER touch sessions, memory, guard/audit, .env
    const stateDir =
      (context as any).env?.QLING_FILE_STATE_DIR ||
      join(homedir(), ".qling");

    const cands = await findCleanCandidates(stateDir);

    if (cands.length === 0) {
      context.writeLine("没有发现可清理的临时项（sessions/memory/guard/audit/.env 永远不会被清理）。");
      return;
    }

    if (dry || !yes) {
      context.writeLine("🧹 storage clean --dry-run 结果（不会实际删除）：");
      for (const c of cands) {
        context.writeLine(`  - ${c.path}  (${c.reason})`);
      }
      context.writeLine("");
      context.writeLine("要实际执行请使用: qling storage clean --yes 或 /storage clean --yes");
      return;
    }

    // --yes 执行
    const results = await performClean(cands, false);
    context.writeLine("🧹 storage clean 已执行：");
    for (const r of results) context.writeLine(`  ${r}`);
    context.writeLine("注意：sessions、memory、guard/audit、.env 未被触碰。");
  },
};
