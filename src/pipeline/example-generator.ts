// ============================================================
// 轻灵 - Tool Spec Example Generator (v0.3)
// 根据 ToolParam Schema 自动生成调用示例与反例
// ============================================================

import { ToolDefinition, ToolParam } from "../types.js";

export function generateExamplesFromSchema(tool: ToolDefinition): string[] {
  if (!tool.paramSchema) return [];

  const autoExamples: string[] = [];
  const requiredParams = Object.entries(tool.paramSchema).filter(([_, p]) => p.required);
  
  // 1. 生成基础成功示例 (包含所有必填项)
  if (requiredParams.length > 0) {
    const baseArgs = requiredParams.map(([name, p]) => {
      return `${name}=${formatExampleValue(p)}`;
    }).join(" ");
    autoExamples.push(`${tool.name} ${baseArgs}`);
  }

  // 2. 生成全选示例 (包含所有参数)
  const allArgs = Object.entries(tool.paramSchema).map(([name, p]) => {
    return `${name}=${formatExampleValue(p)}`;
  }).join(" ");
  autoExamples.push(`${tool.name} ${allArgs}`);

  return autoExamples;
}

function formatExampleValue(p: ToolParam): string {
  if (p.enum && p.enum.length > 0) return `"${p.enum[0]}"`;
  
  switch (p.type) {
    case "string":
      return p.pattern ? '"MATCHES_PATTERN"' : '"example_text"';
    case "number":
      return (p.minimum ?? 0).toString();
    case "boolean":
      return "true";
    case "array":
      return '["item1", "item2"]';
    case "object":
      return '{"key": "value"}';
    default:
      return '"value"';
  }
}

export function buildToolSpecBoostPrompt(tools: ToolDefinition[]): string {
  let prompt = "【工具调用规范增强】\n为了确保调用准确，请参考以下 Schema 约束与示例：\n\n";

  for (const tool of tools) {
    if (!tool.paramSchema) continue;
    
    prompt += `### ${tool.name}\n`;
    prompt += `参数约束:\n`;
    for (const [name, p] of Object.entries(tool.paramSchema)) {
      prompt += `- ${name} (${p.type}${p.required ? ", 必填" : ""}): ${p.description}\n`;
      if (p.enum) prompt += `  枚举值: [${p.enum.join(", ")}]\n`;
    }
    
    const examples = [...(tool.examples || []), ...generateExamplesFromSchema(tool)];
    if (examples.length > 0) {
      prompt += `调用示例:\n`;
      examples.slice(0, 3).forEach(ex => {
        prompt += `  ${ex}\n`;
      });
    }
    prompt += "\n";
  }

  return prompt;
}
