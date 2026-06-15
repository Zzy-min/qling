export interface ExtractedSymbol {
  name: string;
  type: "class" | "function" | "interface" | "type" | "struct";
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

      // 2. Python Def
      const defMatch = line.match(/^\s*def\s+([a-zA-Z0-9_]+)\s*\(/);
      if (defMatch) {
        symbols.push({
          name: defMatch[1],
          type: "function",
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
    }
  }

  return symbols;
}
