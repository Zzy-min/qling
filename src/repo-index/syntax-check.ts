import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Lang, parse, registerDynamicLanguage } from "@ast-grep/napi";

let dynamicRegistered = false;

async function ensureDynamicLanguages(): Promise<void> {
  if (dynamicRegistered) return;
  const [python, go, java, rust] = await Promise.all([
    import("@ast-grep/lang-python"),
    import("@ast-grep/lang-go"),
    import("@ast-grep/lang-java"),
    import("@ast-grep/lang-rust"),
  ]);
  registerDynamicLanguage({ python: python.default, go: go.default, java: java.default, rust: rust.default });
  dynamicRegistered = true;
}

function languageFor(file: string): Lang | string | null {
  switch (path.extname(file).toLowerCase()) {
    case ".ts": return Lang.TypeScript;
    case ".tsx": return Lang.Tsx;
    case ".js":
    case ".mjs":
    case ".cjs": return Lang.JavaScript;
    case ".jsx": return Lang.Tsx;
    case ".py": return "python";
    case ".go": return "go";
    case ".java": return "java";
    case ".rs": return "rust";
    default: return null;
  }
}

export async function checkFileSyntax(file: string): Promise<{ ok: boolean; reason: string }> {
  const language = languageFor(file);
  if (!language) return { ok: true, reason: "no parser registered for file type" };
  await ensureDynamicLanguages();
  try {
    const source = await fs.readFile(file, "utf8");
    const root = parse(language as never, source).root();
    const stack = [...root.children()];
    let error = root.find({ rule: { kind: "ERROR" } });
    while (!error && stack.length > 0) {
      const node = stack.pop()!;
      if (node.kind() === "ERROR" || node.text() === "") {
        error = node;
        break;
      }
      stack.push(...node.children());
    }
    return error
      ? { ok: false, reason: `syntax error near line ${error.range().start.line + 1}` }
      : { ok: true, reason: "syntax parsed successfully" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
