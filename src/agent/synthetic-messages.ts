import { createHash } from "node:crypto";
import type { Message, SyntheticReason } from "../types.js";

export function syntheticContentKey(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export function upsertSyntheticMessage(
  messages: Message[],
  reason: SyntheticReason,
  content: string,
  key = syntheticContentKey(content)
): Message {
  const next: Message = {
    role: "user",
    content,
    synthetic_reason: reason,
    synthetic_key: key,
  };
  const exact = messages.find(
    (message) => message.synthetic_reason === reason && message.synthetic_key === key
  );
  if (exact) return exact;

  const existingIndex = messages.findIndex((message) => message.synthetic_reason === reason);
  if (existingIndex >= 0) {
    messages[existingIndex] = next;
  } else {
    const firstRealUser = messages.findIndex(
      (message) => message.role === "user" && !message.synthetic_reason
    );
    if (firstRealUser >= 0) messages.splice(firstRealUser, 0, next);
    else messages.push(next);
  }
  return next;
}

export function isSyntheticMessage(message: Message): boolean {
  return Boolean(message.synthetic_reason);
}
