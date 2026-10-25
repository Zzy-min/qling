// Fold a thinking chain down to the steps worth reading.
// Grok Build collapses a finished thought to "Thought for Xs" and expands
// it with Ctrl+E. Qling keeps up to three decision steps in the collapsed
// view, because the chain is only useful when the next action is visible.

const STEP_START =
  /^(?:[-*+]|\d+[.)]\s+|#{1,6}\s+)?(?:先(?!不)|然后|接着|接下来|最后|再(?!不)|读取|查看|搜索|扫描|分析|修改|写入|运行|执行|验证|测试|修复|创建|删除|调用|确认|检查|打开|安装|更新|折叠|read\b|search\b|edit\b|write\b|run\b|test\b|verify\b|fix\b|open\b|create\b|check\b|then\b|next\b)/i;

const FILLER =
  /^(?:好的|嗯+|哦|当然|让我想想|让我思考一下|思考一下|我来看一下|总结一下|下面|如下)[，,。.!！？?\s]*$/;

export interface ThinkingFold {
  steps: string[];
  hidden: number;
  expandable: boolean;
}

export function extractImportantSteps(text: string, limit = 3): ThinkingFold {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  if (!raw) return { steps: [], hidden: 0, expandable: false };
  const pieces = splitThoughtPieces(raw);
  const compact = pieces
    .map((piece) => compactPiece(piece))
    .filter((piece) => piece.length > 0);
  if (compact.length === 0) return { steps: [], hidden: 0, expandable: false };
  const cap = Math.max(1, limit);
  const important = compact
    .map((piece, index) => ({ piece, index }))
    .filter((item) => !FILLER.test(item.piece) && STEP_START.test(item.piece));
  const picked = important.length === 0
    ? edgePieces(compact, cap)
    : important.length <= cap
      ? important
      : [
          important[0],
          ...important.slice(-(cap - 1)),
        ];
  const steps = picked.map((item) => item.piece);
  const hidden = compact.length - steps.length;
  return {
    steps,
    hidden,
    expandable: hidden > 0 || steps.join("").length + 8 < raw.replace(/\s+/g, "").length,
  };
}

function edgePieces(pieces: string[], cap: number): Array<{ piece: string; index: number }> {
  if (pieces.length <= cap) {
    return pieces.map((piece, index) => ({ piece, index }));
  }
  const tail = cap - 1;
  const indexes = [0, ...Array.from({ length: tail }, (_, offset) => pieces.length - tail + offset)];
  return indexes.map((index) => ({ piece: pieces[index], index }));
}

export function formatThinkingSummary(text: string, limit = 3): string {
  const folded = extractImportantSteps(text, limit);
  if (folded.steps.length === 0) return "";
  const lines = ["思考", ...folded.steps.map((step) => `· ${step}`)];
  if (folded.hidden > 0) lines.push(`… 另有 ${folded.hidden} 步已折叠`);
  return lines.join("\n");
}

function splitThoughtPieces(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const listItems = lines.filter((line) => /^([-*+]|\d+[.)]|#{1,6}\s)/.test(line));
  if (listItems.length >= 2) return listItems;
  if (lines.length >= 2) return lines;
  const sentences = text
    .split(/(?<=[。！？!?])\s*/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
  return sentences.length > 0 ? sentences : [text.trim()];
}

function compactPiece(piece: string): string {
  const stripped = piece
    .replace(/^([-*+]|\d+[.)]|#{1,6})\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= 72) return stripped;
  return stripped.slice(0, 71) + "…";
}
