import { ToolResult } from "../types.js";

export interface ToolErrorOptions {
  retriable?: boolean;
  category?: "validation" | "permission" | "network" | "io" | "runtime";
}

export function toolError(code: string, message: string, options: ToolErrorOptions = {}): ToolResult {
  return {
    tool_call_id: "",
    output: `Error: [${code}] ${message}`,
    is_error: true,
    error: {
      code,
      message,
      retriable: options.retriable ?? false,
      category: options.category ?? inferErrorCategory(code),
    },
  };
}

export function toolSuccess(output: string): ToolResult {
  return {
    tool_call_id: "",
    output,
  };
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

function inferErrorCategory(code: string): "validation" | "permission" | "network" | "io" | "runtime" {
  if (/_INVALID_|_MISSING_|_EMPTY_|_UNSUPPORTED_/.test(code)) return "validation";
  if (/_DENIED/.test(code)) return "permission";
  if (/_NETWORK_|_URL_FETCH_|_TIMEOUT/.test(code)) return "network";
  if (/_PATH_|_FILE_|_READ_|_WRITE_/.test(code)) return "io";
  return "runtime";
}
