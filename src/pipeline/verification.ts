// ============================================================
// 轻灵 - Verification Agent（精简版，已 deprecated）
//
// 写操作失败恢复闭环请使用 StagedVerifier + resolveVerificationStages。
// 本类仅作无验证命令时的 advisory 旁路提示，不得驱动 RecoveryController。
// - 默认规则判断；LLM 路径需 QLING_VERIFY_LLM=1 显式开启
// ============================================================

import {
  VerificationResult,
  VerificationVerdict,
  VerificationStep,
} from "../types.js";
import type { LlmHttpClient } from "../providers/llm-client.js";

const VERIFICATION_PROMPT = `你是轻灵的验证 Agent，负责判断操作是否成功。

【输出规则】必须严格遵循以下格式，禁止添加任何额外内容：

PASS  // 操作完全成功
FAIL  // 操作明显失败
PARTIAL  // 部分成功，有警告

一行说明：原因

【判断标准】
- PASS: 达到了预期结果，无错误
- FAIL: 错误、异常、或未达到预期
- PARTIAL: 达到了核心目标，但有小问题

请直接返回判决和说明，不要解释验证过程。`;

/** @deprecated Prefer StagedVerifier for recovery-driving verification. */
export class VerificationAgent {
  constructor(
    private client: Pick<LlmHttpClient, "chatCompletions">,
    private model: string = "deepseek-chat"
  ) {}

  async verify(
    operation: string,
    expectedOutcome: string,
    actualOutput: string,
    context?: string
  ): Promise<VerificationResult> {
    // 规则验证（快速路径）；advisory only — never feeds RecoveryController
    const ruleResult = this.ruleBasedVerify(operation, expectedOutcome, actualOutput);
    const llmEnabled = ["1", "true", "on", "yes"].includes(
      String(process.env.QLING_VERIFY_LLM ?? "").trim().toLowerCase()
    );
    // 如果 output 很短且显式开启 LLM 旁路，才调用模型
    const isSimple = actualOutput.length < 100 || actualOutput.includes("denied") || actualOutput.includes("not found") || actualOutput.includes("Error");
    if (llmEnabled && isSimple) {
      try {
        const llmResult = await this.verifyWithLLM(operation, actualOutput, ruleResult);
        return llmResult;
      } catch {
        // LLM 失败，降级到规则
        return ruleResult;
      }
    }
    return ruleResult;
  }

  private async verifyWithLLM(
    operation: string,
    actualOutput: string,
    fallback: VerificationResult
  ): Promise<VerificationResult> {
    const prompt = `${VERIFICATION_PROMPT}

【操作类型】${operation}
【实际输出】${actualOutput.slice(0, 500)}${actualOutput.length > 500 ? "..." : ""}`;

    try {
      const response = await this.callLLM(prompt);
      return this.parseResponse(response);
    } catch {
      return fallback;
    }
  }

  private async callLLM(prompt: string): Promise<string> {
    const response = await this.client.chatCompletions({
      model: this.model,
      systemPrompt: VERIFICATION_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [],
      overrides: {
        max_tokens: 150,
        temperature: 0,
      },
    });
    return response.content;
  }

  private parseResponse(response: string): VerificationResult {
    const lines = response.split("\n").map((l) => l.trim()).filter(Boolean);
    let verdict: VerificationVerdict = "PARTIAL";
    let details = response;
    const steps: VerificationStep[] = [];

    for (const line of lines) {
      if (line.startsWith("PASS")) {
        verdict = "PASS";
        details = line.replace(/^PASS\s*/, "").replace(/^一行说明：/, "").trim();
        steps.push({ description: "通过", passed: true });
      } else if (line.startsWith("FAIL")) {
        verdict = "FAIL";
        details = line.replace(/^FAIL\s*/, "").replace(/^一行说明：/, "").trim();
        steps.push({ description: "失败", passed: false });
      } else if (line.startsWith("PARTIAL")) {
        verdict = "PARTIAL";
        details = line.replace(/^PARTIAL\s*/, "").replace(/^一行说明：/, "").trim();
        steps.push({ description: "部分成功", passed: true });
      }
    }

    return { verdict, details, steps };
  }

  // 规则验证（无 LLM 时降级，也作为快速路径）
  private ruleBasedVerify(
    operation: string,
    expected: string,
    actual: string
  ): VerificationResult {
    const steps: VerificationStep[] = [];
    let failedChecks = 0;

    // 检查明显的错误标记
    const errorPatterns = [
      "error", "Error", "ERROR", "failed", "Failed", "FAILED",
      "denied", "permission", "not found", "NotADirectory",
      "WinError", "Traceback", "SyntaxError", "cannot",
    ];
    const hasError = errorPatterns.some((p) => actual.toLowerCase().includes(p.toLowerCase()));
    if (hasError) {
      steps.push({ description: "输出包含错误标记", passed: false });
      failedChecks++;
    } else {
      steps.push({ description: "无错误标记", passed: true });
    }

    // 检查 exit code 标记
    if (actual.includes("exit code: 0") || actual.includes("✅")) {
      steps.push({ description: "成功退出", passed: true });
    } else if (/\bexit code: [1-9]\b/.test(actual) || /\bexit code: null\b/.test(actual)) {
      steps.push({ description: "非零退出码", passed: false });
      failedChecks++;
    }

    const verdict: VerificationVerdict =
      failedChecks === 0 ? "PASS" : failedChecks < steps.length ? "PARTIAL" : "FAIL";

    return {
      verdict,
      details: failedChecks === 0
        ? "规则验证通过"
        : `规则验证: ${failedChecks} 项失败`,
      steps,
    };
  }
}
