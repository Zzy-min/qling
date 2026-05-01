// ============================================================
// 可复用的 Fake OpenAI 兼容 LLM 服务器
// 支持多轮 tool_calls 交互
// ============================================================

import { createServer } from "node:http";

/**
 * 创建一个 fake OpenAI /chat/completions 服务器。
 *
 * @param {Array<Object>} responses - 预设的响应队列，每次请求消费一个。
 *   每个响应格式：
 *   - `{ content: string, tool_calls?: Array }` — 对应 OpenAI choices[0].message
 *   - 如果队列耗尽，返回 `{ content: "[fake-llm] no more responses" }`
 *
 * @returns {{ server: import("node:http").Server, endpoint: string, getRequestLog: () => Array<Object>, close: () => Promise<void> }}
 */
export function createFakeLLM(responses) {
  const requestLog = [];
  let responseIndex = 0;

  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat/completions") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          requestLog.push(JSON.parse(body));
        } catch {
          requestLog.push({ _raw: body });
        }

        const canned = responses[responseIndex] ?? { content: "[fake-llm] no more responses" };
        responseIndex++;

        const message = { role: "assistant", content: canned.content ?? "" };
        if (canned.tool_calls && canned.tool_calls.length > 0) {
          message.tool_calls = canned.tool_calls;
        }

        const payload = {
          id: "cmpl-fake-" + responseIndex,
          object: "chat.completion",
          choices: [{
            index: 0,
            message,
            finish_reason: message.tool_calls ? "tool_calls" : "stop",
          }],
        };

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  let endpoint = null;

  const listenPromise = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      endpoint = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  return {
    server,
    get endpoint() { return endpoint; },
    getRequestLog() { return requestLog; },
    async ready() { await listenPromise; },
    async close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
