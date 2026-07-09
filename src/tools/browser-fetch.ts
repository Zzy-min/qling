// ============================================================
// 轻灵 - browser_fetch 工具 (v0.5 M3)
// 基于 Playwright 的文档抓取工具，支持 JS 渲染与分页摘要
// ============================================================

import { ToolDefinition, ToolResult } from "../types.js";
import { chromium } from "playwright";
import { appendGuardAudit, checkUrlFetchPolicy } from "../guard.js";
import { guardConfigFromEnv } from "../config.js";
import { toolError } from "./error-utils.js";

export const browserFetchTool: ToolDefinition = {
  name: "browser_fetch",
  description: "Fetch and summarize content from JavaScript-heavy websites using a real browser.",
  longDescription: `高级网页抓取工具。使用 Chromium 内核加载页面，支持单页应用 (SPA) 与 JS 动态渲染。

**使用场景**:
- 抓取现代技术文档（如 React, Next.js 官网）
- 提取需要等待加载的动态数据
- 获取网页的清晰文本摘要（自动过滤广告与杂质）

**约束**:
- 仅限文档检索与公开信息获取。
- 不支持登录、表单提交或任何交互式自动化。`,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL of the website to fetch",
      },
      wait_for: {
        type: "string",
        description: "Optional CSS selector to wait for before extracting content",
      }
    },
    required: ["url"],
  },
  paramSchema: {
    url: {
      type: "string",
      description: "要访问的网页 URL。",
      pattern: "^https?://",
      required: true,
    },
    wait_for: {
      type: "string",
      description: "可选的 CSS 选择器。等待该元素出现后再提取内容，适用于异步加载页面。",
    }
  },
  examples: [
    'browser_fetch url="https://playwright.dev/docs/intro"',
    'browser_fetch url="https://nextjs.org/docs" wait_for=".prose"',
  ],
  scenes: ["web", "research", "documentation"],
  priority: 8,
  readOnly: true,
  destructive: false,
  concurrencySafe: false, // 浏览器操作较重，建议顺序执行
  effortHint: "high",
};

export async function runBrowserFetch(args: {
  url: string;
  wait_for?: string;
}): Promise<ToolResult> {
  const rawUrl = String(args.url ?? "").trim();
  if (!rawUrl) {
    return toolError("BROWSER_FETCH_MISSING_URL", "url is required");
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return toolError("BROWSER_FETCH_INVALID_URL", `invalid url: ${rawUrl}`);
  }

  // Phase 1.5: 与 url_fetch 共用网络 Guard（prefix / 私网 / network mode）
  const guard = guardConfigFromEnv();
  const decision = await checkUrlFetchPolicy(target, guard);
  if (!decision.allowed) {
    await appendGuardAudit(guard, {
      tool: "browser_fetch",
      action: "deny",
      category: decision.category,
      target: target.toString(),
      reason: decision.reason,
    });
    return toolError(
      "BROWSER_FETCH_GUARD_BLOCKED",
      decision.reason ?? "guard denied browser_fetch",
      { category: "network" }
    );
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  try {
    console.error(`🌐 正在打开浏览器访问: ${rawUrl}...`);
    await page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (args.wait_for) {
      await page.waitForSelector(args.wait_for, { timeout: 10000 });
    } else {
      // 默认等待 2 秒确保某些动态脚本执行
      await page.waitForTimeout(2000);
    }

    // 提取核心文本
    const title = await page.title();
    const content = await page.evaluate(() => {
      // 移除干扰元素
      const junk = document.querySelectorAll("nav, footer, script, style, ads, .ads, #ads");
      junk.forEach(el => el.remove());
      return document.body.innerText;
    });

    await browser.close();

    const cleanedContent = content
      .replace(/\n\s*\n/g, "\n\n")
      .trim()
      .slice(0, 15000); // 截断以防超出 context

    await appendGuardAudit(guard, {
      tool: "browser_fetch",
      action: "allow",
      category: "network",
      target: rawUrl,
    });

    return {
      tool_call_id: "",
      output: `📄 【网页抓取结果】: ${title}\nURL: ${rawUrl}\n\n${cleanedContent}`,
      meta: { title, url: rawUrl }
    };

  } catch (err: any) {
    await browser.close();
    return {
      tool_call_id: "",
      output: `Error: Failed to fetch page via browser: ${err.message}`,
      is_error: true,
      error: { code: "BROWSER_FETCH_FAILED", message: err.message, category: "network" }
    };
  }
}
