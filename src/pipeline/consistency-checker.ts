// ============================================================
// 轻灵 - Tool Spec Consistency Checker (v0.3)
// 调用前检查参数是否偏离 Schema 或示例，减少幻觉
// ============================================================

import { ToolDefinition, ToolCall } from "../types.js";

export interface ConsistencyCheckResult {
  ok: boolean;
  warnings: string[];
  error?: string;
}

export function checkToolConsistency(
  call: ToolCall,
  definition: ToolDefinition
): ConsistencyCheckResult {
  const warnings: string[] = [];
  const args = call.arguments;
  const schema = definition.paramSchema;

  if (!schema) return { ok: true, warnings: [] };

  for (const [name, p] of Object.entries(schema)) {
    const val = args[name];
    
    // 1. 必填项检查
    if (p.required && (val === undefined || val === null)) {
      return { ok: false, warnings, error: `Missing required parameter: ${name}` };
    }

    if (val === undefined) continue;

    // 2. 类型基本检查
    const actualType = Array.isArray(val) ? "array" : typeof val;
    if (p.type === "number" && actualType !== "number") {
       return { ok: false, warnings, error: `Type mismatch for ${name}: expected number, got ${actualType}` };
    }
    if (p.type === "string" && actualType !== "string") {
       return { ok: false, warnings, error: `Type mismatch for ${name}: expected string, got ${actualType}` };
    }

    // 3. 枚举检查
    if (p.enum && !p.enum.includes(val as string)) {
      return { ok: false, warnings, error: `Value '${val}' for ${name} is not in enum [${p.enum.join(", ")}]` };
    }

    // 4. 正则检查 (Boost 部分：识别潜在幻觉)
    if (p.type === "string" && p.pattern) {
      const reg = new RegExp(p.pattern);
      if (!reg.test(val as string)) {
        warnings.push(`Parameter ${name} does not match recommended pattern: ${p.pattern}`);
      }
    }
  }

  return { ok: true, warnings };
}
