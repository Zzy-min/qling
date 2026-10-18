export interface ParsedAgentEvalOutput {
  answer: Record<string, unknown>;
  ok: boolean;
  usage: Record<string, unknown>;
  toolCalls: number;
  toolFailures: number;
  tools: string[];
  answerParseError?: string;
}

function parseAnswer(raw: unknown): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? extractJsonObject(text) ?? text;
  const parsed = JSON.parse(candidate);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Agent answer is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function extractJsonObject(text: string): string | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

export function parseAgentEvalOutput(stdout: string): ParsedAgentEvalOutput {
  const events = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  const result = [...events].reverse().find((event) => event.type === "result");
  if (!result) throw new Error("Agent evaluation produced no terminal result event");
  const tools = events.filter((event) => event.type === "tool_completed");
  let answer: Record<string, unknown> = {};
  let answerParseError: string | undefined;
  try {
    answer = parseAnswer(result.result);
  } catch (error) {
    answerParseError = error instanceof Error ? error.message : String(error);
  }
  return {
    answer,
    ok: result.ok === true,
    usage: result.usage && typeof result.usage === "object"
      ? result.usage as Record<string, unknown>
      : {},
    toolCalls: tools.length,
    toolFailures: tools.filter((event) => event.status === "failed").length,
    tools: tools.map((event) => String(event.tool ?? "unknown")),
    ...(answerParseError ? { answerParseError } : {}),
  };
}
