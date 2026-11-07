import '../helpers/isolated-home.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  DEFAULT_VISION_MAX_TOKENS,
  normalizeVisionModel,
  resolveImageMimeType,
  resolveVisionLlmConfig,
  runVisionAnalyze,
} from "../../dist/tools/vision-analyze.js";
import { loadQlingConfig } from "../../dist/config.js";

test("resolveVisionLlmConfig defaults to DeepSeek (deepseek / deepseek-flash)", () => {
  const resolved = resolveVisionLlmConfig({
    DEEPSEEK_API_KEY: "ds-test-key",
  });
  assert.equal(resolved.provider, "deepseek");
  assert.equal(resolved.model, "deepseek-flash");
  assert.equal(resolved.apiKey, "ds-test-key");
  assert.equal(resolved.endpoint, "https://api.deepseek.com/chat/completions");
  assert.equal(resolved.maxTokens, DEFAULT_VISION_MAX_TOKENS);
  assert.equal(resolved.maxTokens, 8192);
});

test("resolveVisionLlmConfig migrates retired and legacy vision models to deepseek-flash", () => {
  for (const legacy of [
    "deepseek-v4-flash-vision-exp",
    "deepseek-v4-flash",
    "deepseek-chat",
    "deepseek-reasoner",
    "gpt-4o",
    "gpt-4o-mini",
  ]) {
    assert.equal(normalizeVisionModel("deepseek", legacy), "deepseek-flash", legacy);
    const resolved = resolveVisionLlmConfig({
      QLING_VISION_PROVIDER: "deepseek",
      QLING_VISION_MODEL: legacy,
      DEEPSEEK_API_KEY: "ds-key",
    });
    assert.equal(resolved.model, "deepseek-flash", legacy);
  }
});

test("loadQlingConfig normalizes vision config to deepseek / deepseek-flash", async () => {
  const { config } = await loadQlingConfig(
    {},
    {
      QLING_VISION_PROVIDER: "deepseek",
      QLING_VISION_MODEL: "deepseek-v4-flash-vision-exp",
    }
  );
  assert.equal(config.vision.provider, "deepseek");
  assert.equal(config.vision.model, "deepseek-flash");
});

test("resolveImageMimeType normalizes jpg and common image extensions", () => {
  assert.equal(resolveImageMimeType("photo.jpg"), "image/jpeg");
  assert.equal(resolveImageMimeType("photo.JPEG"), "image/jpeg");
  assert.equal(resolveImageMimeType("screen.png"), "image/png");
  assert.equal(resolveImageMimeType("banner.webp"), "image/webp");
  assert.equal(resolveImageMimeType("icon.svg"), "image/svg+xml");
});

test("runVisionAnalyze sends max_tokens=8192 with normalized MIME to DeepSeek and returns content", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-vision-test-"));
  const imgPath = path.join(tmpDir, "sample.jpg");
  await fs.writeFile(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const calls = [];
  try {
    const result = await runVisionAnalyze(
      {
        image_path: imgPath,
        prompt: "检查这张图片的排版",
        detail: "high",
      },
      {
        env: {
          DEEPSEEK_API_KEY: "ds-key-123",
        },
        postImpl: async (url, body, config) => {
          calls.push({ url, body, config });
          return {
            data: {
              choices: [
                {
                  finish_reason: "stop",
                  message: {
                    content: "中文显示正常，无缺字或裁切。",
                    reasoning_content: "逐行检查标题与正文...",
                  },
                },
              ],
            },
          };
        },
      }
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
    assert.equal(calls[0].body.model, "deepseek-flash");
    assert.equal(calls[0].body.max_tokens, 8192);
    assert.match(calls[0].body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.equal(result.is_error, undefined);
    assert.match(result.output, /deepseek-flash @ deepseek/);
    assert.match(result.output, /中文显示正常，无缺字或裁切。/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("runVisionAnalyze expands max_tokens on retry when content is empty and falls back to reasoning_content if still empty", async () => {
  const calls = [];
  const result = await runVisionAnalyze(
    {
      image_path: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      prompt: "检查封面排版",
    },
    {
      env: {
        DEEPSEEK_API_KEY: "ds-key-123",
      },
      postImpl: async (_url, body) => {
        calls.push(body.max_tokens);
        return {
          data: {
            choices: [
              {
                finish_reason: "length",
                message: {
                  content: "",
                  reasoning_content: "推理核验结论：封面中文渲染清晰，无豆腐块。",
                },
              },
            ],
          },
        };
      },
    }
  );

  assert.deepEqual(calls, [8192, 16384]);
  assert.match(result.output, /推理核验结论：封面中文渲染清晰，无豆腐块。/);
});
