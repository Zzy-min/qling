export interface ExtractedSymbol {
  name: string;
  type: "class" | "function" | "interface" | "type" | "struct" | "variable" | "method";
  line: number;
  signature: string;
}

export function extractSymbols(fileContent: string, fileExtension: string): ExtractedSymbol[] {
  const lines = fileContent.split(/\r?\n/);
  const symbols: ExtractedSymbol[] = [];
  const ext = fileExtension.toLowerCase().replace(/^\./, "");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (ext === "ts" || ext === "js" || ext === "tsx" || ext === "jsx") {
      // 1. TS/JS Class
      const classMatch = line.match(/^\s*(?:export\s+)?(?:default\s+)?class\s+([a-zA-Z0-9_$]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: "class",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // 2. TS/JS Function
      const funcMatch = line.match(/^\s*(?:export\s+)?(?:default\s+)?function\s+([a-zA-Z0-9_$]+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          type: "function",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // 3. TS/JS Arrow Function (const foo = () =>)
      const arrowMatch = line.match(/^\s*(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/);
      if (arrowMatch) {
        symbols.push({
          name: arrowMatch[1],
          type: "function",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // 4. TS Interface
      const interfaceMatch = line.match(/^\s*(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          type: "interface",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // 5. TS Type Alias
      const typeMatch = line.match(/^\s*(?:export\s+)?type\s+([a-zA-Z0-9_$]+)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          type: "type",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
    } else if (ext === "py") {
      // 1. Python Class
      const classMatch = line.match(/^\s*class\s+([a-zA-Z0-9_]+)\s*(?:\(|:)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          type: "class",
          line: lineNum,
          signature: line.trim().replace(/:$/, ""),
        });
        continue;
      }

      // 2. Python Def (top level function or indented method)
      const defMatch = line.match(/^(\s*)def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (defMatch) {
        const isMethod = defMatch[1].length > 0;
        symbols.push({
          name: defMatch[2],
          type: isMethod ? "method" : "function",
          line: lineNum,
          signature: line.trim().replace(/:$/, ""),
        });
        continue;
      }
    } else if (ext === "go") {
      // 1. Go Struct
      const structMatch = line.match(/^\s*type\s+([a-zA-Z0-9_]+)\s+struct/);
      if (structMatch) {
        symbols.push({
          name: structMatch[1],
          type: "struct",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // 2. Go Interface
      const interfaceMatch = line.match(/^\s*type\s+([a-zA-Z0-9_]+)\s+interface/);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          type: "interface",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }

      // 3. Go Func
      const funcMatch = line.match(/^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          type: "function",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
    } else if (ext === "rs") {
      // Rust fn
      const fnMatch = line.match(/^\s*(?:pub\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          type: "function",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
      // Rust struct
      const structMatch = line.match(/^\s*(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/);
      if (structMatch) {
        symbols.push({
          name: structMatch[1],
          type: "struct",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
    }

    // Additional TS/JS: exported const/var assigned function expr (more complete)
    if (["ts", "js", "tsx", "jsx"].includes(ext)) {
      const fnExprMatch = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?function/);
      if (fnExprMatch) {
        symbols.push({
          name: fnExprMatch[1],
          type: "function",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
    }

    // Top-level variables (const/let/var not functions)
    if (["ts", "js", "tsx", "jsx"].includes(ext)) {
      const varMatch = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*[:=](?!\s*(?:async\s+)?(?:function|\(|\s*=>))/);
      if (varMatch) {
        symbols.push({
          name: varMatch[1],
          type: "variable",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
    }

    // Rough class/instance methods (indented name(...) { or : type { )
    if (["ts", "js", "tsx", "jsx"].includes(ext)) {
      const methMatch = line.match(/^\s+([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*[{]/);
      if (methMatch && !line.trim().startsWith("if ") && !line.trim().startsWith("for ") && !line.trim().startsWith("while ")) {
        symbols.push({
          name: methMatch[1],
          type: "method",
          line: lineNum,
          signature: line.trim(),
        });
        continue;
      }
    }
  }

  return symbols;
}
