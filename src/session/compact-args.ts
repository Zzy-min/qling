// ============================================================
// /compact 参数解析：保留最近轮数 + 可选主题焦点
// ============================================================

export interface CompactCommandOptions {
  /** 压缩后保留的最近消息条数（含 tool chain 保护扩展） */
  recentKeep: number;
  /** 摘要时优先保留的主题 / 关键词 */
  theme?: string;
}

const DEFAULT_KEEP = 6;
const MAX_KEEP = 40;

/**
 * 解析 /compact 参数。
 *
 * 示例：
 * - `/compact`
 * - `/compact 10`
 * - `/compact --keep 8`
 * - `/compact --theme 股票复盘`
 * - `/compact 12 保留 TCL 与日期结论`
 * - `/compact --keep=8 --theme=端午休市`
 */
export function parseCompactArgs(args: string[] = []): CompactCommandOptions {
  let recentKeep = DEFAULT_KEEP;
  const themeParts: string[] = [];
  let keepSet = false;

  for (let i = 0; i < args.length; i++) {
    const token = String(args[i] ?? "").trim();
    if (!token) continue;

    if (token === "--keep" || token === "-k") {
      const n = Number.parseInt(String(args[++i] ?? ""), 10);
      if (Number.isFinite(n) && n > 0) {
        recentKeep = Math.min(MAX_KEEP, Math.max(1, n));
        keepSet = true;
      }
      continue;
    }

    if (token.startsWith("--keep=")) {
      const n = Number.parseInt(token.slice("--keep=".length), 10);
      if (Number.isFinite(n) && n > 0) {
        recentKeep = Math.min(MAX_KEEP, Math.max(1, n));
        keepSet = true;
      }
      continue;
    }

    if (token === "--theme" || token === "-t" || token === "--focus") {
      const rest = args.slice(i + 1).join(" ").trim();
      if (rest) themeParts.push(rest);
      break;
    }

    if (token.startsWith("--theme=") || token.startsWith("--focus=")) {
      const v = token.replace(/^--(?:theme|focus)=/, "").trim();
      if (v) themeParts.push(v);
      continue;
    }

    if (!keepSet && /^\d+$/.test(token)) {
      recentKeep = Math.min(MAX_KEEP, Math.max(1, Number.parseInt(token, 10)));
      keepSet = true;
      continue;
    }

    themeParts.push(token);
  }

  const theme = themeParts.join(" ").trim();
  return {
    recentKeep,
    theme: theme || undefined,
  };
}
