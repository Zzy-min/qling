import { createHash } from "node:crypto";
import path from "node:path";
import type { FailureCategory, FailureClassification } from "./types.js";

interface FailureContext {
  tool?: string;
  targetPath?: string;
  verificationCommand?: string;
  provider?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMessage(value: string): string {
  return value
    .toLowerCase()
    .replace(/[a-z]:\\[^\s]+/gi, "<path>")
    .replace(/(?:\/[^\s]+)+/g, "<path>")
    .replace(/\d{4}-\d{2}-\d{2}(?:[ t]\d{2}:\d{2}:\d{2})?/g, "<time>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyFailure(error: unknown, context: FailureContext = {}): FailureClassification {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
  let category: FailureCategory = context.provider ? "provider_terminal" : "tool_execution";

  if (status === 429 || (status !== undefined && status >= 500) || /rate limit|econnreset|etimedout|temporar/.test(lower)) {
    category = "provider_transient";
  } else if (/approval[_ ]required|requires approval/.test(lower)) {
    category = "permission_required";
  } else if (/permission denied|approval denied|forbidden/.test(lower)) {
    category = "permission_denied";
  } else if (/sandbox|outside (?:the )?workspace|path.*denied/.test(lower)) {
    category = "sandbox_denied";
  } else if (/invalid (?:tool )?arguments?|schema validation|missing required/.test(lower)) {
    category = "invalid_tool_arguments";
  } else if (/command not found|is not recognized|enoent/.test(lower)) {
    category = "tool_not_found";
  } else if (/verification|test command|build failed|exited with code/.test(lower)) {
    category = "verification_failed";
  } else if (/context (?:window )?(?:exhausted|length)|maximum context/.test(lower)) {
    category = "context_exhausted";
  } else if (/repeated action|duplicate tool call/.test(lower)) {
    category = "repeated_action";
  } else if (/cancel(?:ed|led)/.test(lower)) {
    category = "user_canceled";
  }

  const classification: FailureClassification = { category, message, ...context };
  return { ...classification, fingerprint: createFailureFingerprint(classification) };
}

export function createFailureFingerprint(failure: Omit<FailureClassification, "fingerprint">): string {
  const target = failure.targetPath ? path.basename(failure.targetPath).toLowerCase() : "";
  const stable = [
    failure.category,
    failure.tool ?? "",
    normalizeMessage(failure.message),
    target,
    normalizeMessage(failure.verificationCommand ?? ""),
  ].join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 20);
}
