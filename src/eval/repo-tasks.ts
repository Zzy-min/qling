// ============================================================
// Phase 7.0 / Sprint 4 — 本地 repo fixture 任务集（不依赖 LLM）
// 模拟常见编码任务：修测试、改文案、加函数、多文件一致性等
// Usage: npm run eval:tasks
// ============================================================

import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import type { EvalTask, EvalTaskContext, EvalTaskOutcome } from "./types.js";
import { writeFileAtomic } from "../tools/patch.js";

async function writeTree(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

async function expectFile(
  root: string,
  rel: string,
  predicate: (text: string) => boolean,
  detailOk: string,
  detailFail: string
): Promise<EvalTaskOutcome> {
  try {
    const text = await readFile(join(root, rel), "utf8");
    const ok = predicate(text);
    return { ok, detail: ok ? detailOk : detailFail };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 10 个本地 fixture：每个任务自带 broken 状态 + 确定性修复步骤。
 * 不调用外部 LLM；用于回归「编码工作台」基础能力与验收脚本。
 */
export function buildEvalRepoTasks(): EvalTask[] {
  return [
    {
      id: "fixture-fix-failing-test",
      title: "修失败断言（assert 期望值）",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "fix-test");
        await writeTree(root, {
          "math.mjs": "export function add(a, b) { return a + b; }\n",
          "math.test.mjs":
            "import assert from 'node:assert/strict';\n" +
            "import { add } from './math.mjs';\n" +
            "assert.equal(add(2, 2), 5); // broken\n",
        });
        // deterministic agent-like fix
        await writeFileAtomic(
          join(root, "math.test.mjs"),
          "import assert from 'node:assert/strict';\n" +
            "import { add } from './math.mjs';\n" +
            "assert.equal(add(2, 2), 4);\n"
        );
        return expectFile(
          root,
          "math.test.mjs",
          (t) => t.includes("add(2, 2), 4") && !t.includes(", 5"),
          "assertion fixed to 4",
          "test still expects 5"
        );
      },
    },
    {
      id: "fixture-change-ui-copy",
      title: "改文案（README 标题）",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "copy");
        await writeTree(root, {
          "README.md": "# Old Title\n\nWelcome.\n",
        });
        await writeFileAtomic(join(root, "README.md"), "# Qling Demo\n\nWelcome.\n");
        return expectFile(
          root,
          "README.md",
          (t) => t.startsWith("# Qling Demo"),
          "title updated",
          "title not updated"
        );
      },
    },
    {
      id: "fixture-add-function",
      title: "加导出函数",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "add-fn");
        await writeTree(root, {
          "util.mjs": "export function identity(x) { return x; }\n",
        });
        const next =
          "export function identity(x) { return x; }\n" +
          "export function double(x) { return x * 2; }\n";
        await writeFileAtomic(join(root, "util.mjs"), next);
        return expectFile(
          root,
          "util.mjs",
          (t) => t.includes("export function double") && t.includes("identity"),
          "double() added",
          "function missing"
        );
      },
    },
    {
      id: "fixture-rename-symbol",
      title: "重命名标识符",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "rename");
        await writeTree(root, {
          "lib.mjs": "export function oldName() { return 1; }\n",
        });
        await writeFileAtomic(
          join(root, "lib.mjs"),
          "export function newName() { return 1; }\n"
        );
        return expectFile(
          root,
          "lib.mjs",
          (t) => t.includes("newName") && !t.includes("oldName"),
          "symbol renamed",
          "oldName still present"
        );
      },
    },
    {
      id: "fixture-fix-import-path",
      title: "修复错误 import 路径",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "import-fix");
        await writeTree(root, {
          "src/helper.mjs": "export const VALUE = 42;\n",
          "src/main.mjs": "import { VALUE } from './missing.mjs';\nexport { VALUE };\n",
        });
        await writeFileAtomic(
          join(root, "src/main.mjs"),
          "import { VALUE } from './helper.mjs';\nexport { VALUE };\n"
        );
        return expectFile(
          root,
          "src/main.mjs",
          (t) => t.includes("./helper.mjs") && !t.includes("./missing.mjs"),
          "import path fixed",
          "import still broken"
        );
      },
    },
    {
      id: "fixture-update-package-script",
      title: "补 package.json scripts.test",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "pkg-script");
        await writeTree(root, {
          "package.json": JSON.stringify({ name: "demo", version: "0.0.1" }, null, 2) + "\n",
        });
        const pkg = { name: "demo", version: "0.0.1", scripts: { test: "node --test" } };
        await writeFileAtomic(join(root, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
        return expectFile(
          root,
          "package.json",
          (t) => {
            try {
              const j = JSON.parse(t);
              return j.scripts?.test === "node --test";
            } catch {
              return false;
            }
          },
          "scripts.test added",
          "scripts.test missing"
        );
      },
    },
    {
      id: "fixture-fix-json-syntax",
      title: "修复 JSON 尾逗号",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "json-fix");
        await writeTree(root, {
          "config.json": '{\n  "enabled": true,\n}\n',
        });
        await writeFileAtomic(join(root, "config.json"), '{\n  "enabled": true\n}\n');
        return expectFile(
          root,
          "config.json",
          (t) => {
            try {
              JSON.parse(t);
              return true;
            } catch {
              return false;
            }
          },
          "JSON parses",
          "JSON still invalid"
        );
      },
    },
    {
      id: "fixture-add-markdown-section",
      title: "文档增加验收小节",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "md-section");
        await writeTree(root, {
          "docs/guide.md": "# Guide\n\n## Setup\n\nInstall deps.\n",
        });
        const next =
          "# Guide\n\n## Setup\n\nInstall deps.\n\n## Acceptance\n\n- [ ] smoke passes\n";
        await writeFileAtomic(join(root, "docs/guide.md"), next);
        return expectFile(
          root,
          "docs/guide.md",
          (t) => t.includes("## Acceptance") && t.includes("smoke passes"),
          "section added",
          "section missing"
        );
      },
    },
    {
      id: "fixture-multi-file-consistency",
      title: "多文件一致改动（定义 + 调用）",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "multi");
        await writeTree(root, {
          "api.mjs": "export function greet(name) { return 'hi ' + name; }\n",
          "app.mjs": "import { greet } from './api.mjs';\nconsole.log(greet('world'));\n",
        });
        await writeFileAtomic(
          join(root, "api.mjs"),
          "export function greet(name) { return 'hello ' + name; }\n"
        );
        await writeFileAtomic(
          join(root, "app.mjs"),
          "import { greet } from './api.mjs';\nconsole.log(greet('qling'));\n"
        );
        const api = await readFile(join(root, "api.mjs"), "utf8");
        const app = await readFile(join(root, "app.mjs"), "utf8");
        const ok =
          api.includes("'hello '") &&
          app.includes("greet('qling')") &&
          app.includes("./api.mjs");
        return {
          ok,
          detail: ok ? "api+app updated consistently" : "multi-file mismatch",
        };
      },
    },
    {
      id: "fixture-cjk-filename",
      title: "中文文件名读写",
      run: async ({ workspaceDir }) => {
        const root = join(workspaceDir, "cjk");
        const rel = "笔记/说明.md";
        await writeTree(root, {
          [rel]: "# 草稿\n",
        });
        await writeFileAtomic(join(root, rel), "# 轻灵说明\n\n本地优先。\n");
        return expectFile(
          root,
          rel,
          (t) => t.includes("轻灵说明") && t.includes("本地优先"),
          "CJK path write ok",
          "CJK path write failed"
        );
      },
    },
  ];
}

/** 仅 materialize fixture，不自动修复（供可选 LLM / 人工评测） */
export async function materializeBrokenFixture(
  workspaceDir: string,
  fixtureId: string
): Promise<{ root: string; prompt: string } | null> {
  const map: Record<string, { dir: string; files: Record<string, string>; prompt: string }> = {
    "fixture-fix-failing-test": {
      dir: "fix-test",
      files: {
        "math.mjs": "export function add(a, b) { return a + b; }\n",
        "math.test.mjs":
          "import assert from 'node:assert/strict';\n" +
          "import { add } from './math.mjs';\n" +
          "assert.equal(add(2, 2), 5);\n",
      },
      prompt: "Fix the failing unit test so add(2,2) expects 4.",
    },
    "fixture-change-ui-copy": {
      dir: "copy",
      files: { "README.md": "# Old Title\n\nWelcome.\n" },
      prompt: "Rename the README title to 'Qling Demo'.",
    },
  };
  const item = map[fixtureId];
  if (!item) return null;
  const root = join(workspaceDir, item.dir);
  await writeTree(root, item.files);
  return { root, prompt: item.prompt };
}
