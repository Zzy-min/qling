import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import {
  checkSensitiveWriteTarget,
  getRuntimeRootsFromEnv,
  resolveToolPath,
} from "../runtime-paths.js";
import {
  isPathAllowedUnderProfile,
  isWriteBlockedByProfile,
  resolveSandboxProfile,
} from "../runtime/sandbox-profile.js";

const MAX_BYTES = 2 * 1024 * 1024;
const RECOVERY_RADIUS = 15;

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, " ");
}

export function fileRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export function lineAnchor(lines: string[], index: number): string {
  const payload = [lines[index - 1] ?? "", lines[index] ?? "", lines[index + 1] ?? ""]
    .map(normalizeLine)
    .join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 8);
}

export const readAnchoredTool: ToolDefinition = {
  name: "read_anchored",
  description: "Experimental: read a text file with line:hash anchors and a file revision for stale-safe edits.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      offset: { type: "number" },
      limit: { type: "number" },
    },
    required: ["path"],
  },
  readOnly: true,
  scenes: ["coding"],
  priority: 7,
};

export const patchAnchoredTool: ToolDefinition = {
  name: "patch_anchored",
  description: "Experimental: atomically replace anchored lines. Stale anchors recover only when uniquely found within ±15 lines.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      file_revision: { type: "string" },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            anchor: { type: "string", description: "line:hash from read_anchored" },
            replace: { type: "string" },
          },
          required: ["anchor", "replace"],
        },
      },
      dry_run: { type: "boolean" },
    },
    required: ["path", "file_revision", "edits"],
  },
  readOnly: false,
  scenes: ["coding"],
  priority: 7,
};

export const ANCHORED_EDIT_TOOLS = [readAnchoredTool, patchAnchoredTool];

type LoadTextResult =
  | { ok: true; path: string; content: string }
  | { ok: false; result: ToolResult };

async function loadText(inputPath: string): Promise<LoadTextResult> {
  const roots = getRuntimeRootsFromEnv();
  const resolvedPath = resolveToolPath(inputPath, roots, "workspace");
  if (!isPathAllowedUnderProfile(resolvedPath, resolveSandboxProfile(), roots)) {
    return { ok: false, result: toolError("ANCHORED_OUTSIDE_ALLOWED_ROOT", `${resolvedPath} is outside the active sandbox profile`) };
  }
  try {
    const content = await readFile(resolvedPath, "utf8");
    if (content.includes("\u0000")) return { ok: false, result: toolError("ANCHORED_BINARY_FILE", "binary files are not supported") };
    if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
      return { ok: false, result: toolError("ANCHORED_FILE_TOO_LARGE", `file exceeds ${MAX_BYTES} bytes`) };
    }
    return { ok: true, path: resolvedPath, content };
  } catch (error) {
    return { ok: false, result: toolError("ANCHORED_READ_FAILED", error instanceof Error ? error.message : String(error)) };
  }
}

export async function runReadAnchored(args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = String(args.path ?? "").trim();
  if (!inputPath) return toolError("ANCHORED_INVALID_PATH", "path is required");
  const loaded = await loadText(inputPath);
  if (!loaded.ok) return loaded.result;
  const lines = loaded.content.split(/\r?\n/);
  const offset = Math.max(0, Math.floor(Number(args.offset ?? 1)) - 1);
  const limit = Math.max(1, Math.min(2000, Math.floor(Number(args.limit ?? 500))));
  const selected = lines.slice(offset, offset + limit).map((line, relativeIndex) => {
    const index = offset + relativeIndex;
    return `${index + 1}:${lineAnchor(lines, index)}|${line}`;
  });
  const revision = fileRevision(loaded.content);
  return {
    ...toolSuccess(`revision:${revision}\n${selected.join("\n")}`),
    meta: { revision, offset: offset + 1, returnedLines: selected.length, totalLines: lines.length },
  };
}

interface AnchoredEdit {
  anchor: string;
  replace: string;
}

function resolveAnchor(lines: string[], raw: string): { index?: number; error?: string } {
  const match = raw.match(/^(\d+):([a-f0-9]{8})$/i);
  if (!match) return { error: `invalid anchor '${raw}'` };
  const expectedIndex = Number(match[1]) - 1;
  const hash = match[2].toLowerCase();
  if (expectedIndex >= 0 && expectedIndex < lines.length && lineAnchor(lines, expectedIndex) === hash) {
    return { index: expectedIndex };
  }
  const start = Math.max(0, expectedIndex - RECOVERY_RADIUS);
  const end = Math.min(lines.length - 1, expectedIndex + RECOVERY_RADIUS);
  const matches: number[] = [];
  for (let index = start; index <= end; index++) {
    if (lineAnchor(lines, index) === hash) matches.push(index);
  }
  if (matches.length === 1) return { index: matches[0] };
  if (matches.length === 0) return { error: `stale anchor '${raw}' was not found within ±${RECOVERY_RADIUS} lines` };
  return { error: `anchor '${raw}' is ambiguous within ±${RECOVERY_RADIUS} lines` };
}

export async function runPatchAnchored(args: Record<string, unknown>): Promise<ToolResult> {
  const inputPath = String(args.path ?? "").trim();
  const expectedRevision = String(args.file_revision ?? "").trim();
  const edits = args.edits as AnchoredEdit[] | undefined;
  if (!inputPath || !expectedRevision || !Array.isArray(edits) || edits.length === 0) {
    return toolError("ANCHORED_INVALID_INPUT", "path, file_revision and non-empty edits are required");
  }
  const profile = resolveSandboxProfile();
  if (isWriteBlockedByProfile(profile)) {
    return toolError("ANCHORED_SANDBOX_READ_ONLY", `sandbox profile '${profile}' blocks writes`);
  }
  const loaded = await loadText(inputPath);
  if (!loaded.ok) return loaded.result;
  const sensitive = checkSensitiveWriteTarget(loaded.path);
  if (sensitive?.blocked) return toolError(sensitive.code, sensitive.reason);
  const currentRevision = fileRevision(loaded.content);
  const lines = loaded.content.split(/\r?\n/);
  const resolved: Array<{ index: number; replace: string; anchor: string }> = [];
  const used = new Set<number>();
  for (const edit of edits) {
    if (!edit || typeof edit.replace !== "string") {
      return toolError("ANCHORED_INVALID_EDIT", "each edit requires anchor and string replace");
    }
    const target = resolveAnchor(lines, String(edit.anchor ?? ""));
    if (target.error || target.index === undefined) {
      return toolError("ANCHORED_STALE_OR_AMBIGUOUS", target.error ?? "anchor resolution failed", {
        category: "validation",
      });
    }
    if (used.has(target.index)) {
      return toolError("ANCHORED_DUPLICATE_TARGET", `multiple edits target line ${target.index + 1}`);
    }
    used.add(target.index);
    resolved.push({ index: target.index, replace: edit.replace, anchor: edit.anchor });
  }
  const nextLines = [...lines];
  for (const edit of resolved.sort((a, b) => b.index - a.index)) {
    nextLines.splice(edit.index, 1, ...edit.replace.split(/\r?\n/));
  }
  const nextContent = nextLines.join(loaded.content.includes("\r\n") ? "\r\n" : "\n");
  if (nextContent === loaded.content) return toolError("ANCHORED_NOOP", "edits produce no change");
  const summary = {
    currentRevision,
    expectedRevision,
    revisionMatched: currentRevision === expectedRevision,
    edits: resolved.map((edit) => ({ anchor: edit.anchor, resolvedLine: edit.index + 1 })),
    nextRevision: fileRevision(nextContent),
  };
  if (args.dry_run === true) return toolSuccess(JSON.stringify({ dryRun: true, ...summary }, null, 2));
  const tempPath = join(dirname(loaded.path), `.qling-anchor-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tempPath, nextContent, "utf8");
    await rename(tempPath, loaded.path);
    return toolSuccess(JSON.stringify({ written: true, ...summary }, null, 2));
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    return toolError("ANCHORED_WRITE_FAILED", error instanceof Error ? error.message : String(error));
  }
}
