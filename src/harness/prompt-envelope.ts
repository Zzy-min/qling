import { createHash } from "node:crypto";

export type PromptSensitivity = "public" | "internal" | "sensitive";

export interface PromptSourceSection {
  id: string;
  content: string;
  source: string;
  priority?: number;
  updatedAt?: number;
  sensitivity?: PromptSensitivity;
}

export interface PromptProvenance {
  id: string;
  source: string;
  priority: number;
  updatedAt?: number;
  sensitivity: PromptSensitivity;
  hash: string;
}

export interface PromptEnvelope {
  stablePrefix: string;
  stableHash: string;
  scopedRules: string;
  dynamicContext: string;
  memoryContext: string;
  evidenceDigest: string;
  provenance: PromptProvenance[];
}

export interface PromptEnvelopeInput {
  stableSections: PromptSourceSection[];
  scopedRules?: PromptSourceSection[];
  dynamicContext?: string;
  memoryContext?: string;
  evidenceDigest?: string;
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeSections(sections: PromptSourceSection[]): PromptSourceSection[] {
  return [...sections]
    .filter((section) => section.content.trim().length > 0)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id));
}

function renderSections(sections: PromptSourceSection[]): string {
  return normalizeSections(sections)
    .map((section) => `<section id="${section.id}">${section.content.trim()}</section>`)
    .join("\n");
}

function provenanceFor(sections: PromptSourceSection[]): PromptProvenance[] {
  return normalizeSections(sections).map((section) => ({
    id: section.id,
    source: section.source,
    priority: section.priority ?? 0,
    ...(section.updatedAt !== undefined ? { updatedAt: section.updatedAt } : {}),
    sensitivity: section.sensitivity ?? "internal",
    hash: hash(section.content),
  }));
}

export function redactPromptDiagnostics(value: string): string {
  return value
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/-----BEGIN (?:(?:RSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----[\s\S]*?-----END (?:(?:RSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s<]+/gi, "$1[REDACTED]")
    .replace(/(["']?(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL)|DATABASE_URL)["']?\s*[=:]\s*["']?)[^"'\s,}<]+/gi, "$1[REDACTED]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:)[^\s/@]+(@)/gi, "$1[REDACTED]$2");
}

export function buildPromptEnvelope(input: PromptEnvelopeInput): PromptEnvelope {
  const stablePrefix = renderSections(input.stableSections);
  const scopedRules = renderSections(input.scopedRules ?? []);
  return {
    stablePrefix,
    stableHash: hash(stablePrefix),
    scopedRules,
    dynamicContext: input.dynamicContext?.trim() ?? "",
    memoryContext: input.memoryContext?.trim() ?? "",
    evidenceDigest: input.evidenceDigest?.trim() ?? "",
    provenance: provenanceFor([...input.stableSections, ...(input.scopedRules ?? [])]),
  };
}

export function renderPromptEnvelope(
  envelope: PromptEnvelope,
  options: { diagnostics?: boolean } = {}
): string {
  const rendered = [
    `<stable_prefix sha256="${envelope.stableHash}">\n${envelope.stablePrefix}\n</stable_prefix>`,
    envelope.scopedRules ? `<scoped_rules>\n${envelope.scopedRules}\n</scoped_rules>` : "",
    envelope.dynamicContext ? `<dynamic_context>\n${envelope.dynamicContext}\n</dynamic_context>` : "",
    envelope.memoryContext ? `<memory_context>\n${envelope.memoryContext}\n</memory_context>` : "",
    envelope.evidenceDigest ? `<evidence_digest>\n${envelope.evidenceDigest}\n</evidence_digest>` : "",
  ].filter(Boolean).join("\n\n");
  return options.diagnostics ? redactPromptDiagnostics(rendered) : rendered;
}
