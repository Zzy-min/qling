import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractSymbols } from "../../dist/utils/symbol-extractor.js";
import { CognitiveIndex } from "../../dist/memory/cognitive-index.js";
import { repomapCommand } from "../../dist/commands/repomap.js";

test("symbol-extractor: extracts TS/JS symbols successfully", () => {
  const tsContent = `
    import foo from 'bar';
    export class MyClass {
      constructor() {}
    }
    export function myFunction(x: number) {
      return x;
    }
    const arrowFunc = (y) => y + 1;
    export interface MyInterface {}
    export type MyType = string;
  `;

  const symbols = extractSymbols(tsContent, "ts");
  // Enriched extraction now also captures constructor as method (richer map)
  assert.equal(symbols.length, 6);
  assert.equal(symbols[0].name, "MyClass");
  assert.equal(symbols[0].type, "class");
  assert.equal(symbols[1].name, "constructor");
  assert.equal(symbols[1].type, "method");
  assert.equal(symbols[2].name, "myFunction");
  assert.equal(symbols[2].type, "function");
  assert.equal(symbols[3].name, "arrowFunc");
  assert.equal(symbols[3].type, "function");
  assert.equal(symbols[4].name, "MyInterface");
  assert.equal(symbols[4].type, "interface");
  assert.equal(symbols[5].name, "MyType");
  assert.equal(symbols[5].type, "type");
});

test("symbol-extractor: extracts Python and Go symbols successfully", () => {
  const pyContent = `
class PythonClass(Base):
    def method(self):
        pass

def global_func():
    pass
  `;

  const pySymbols = extractSymbols(pyContent, "py");
  assert.equal(pySymbols.length, 3);
  assert.equal(pySymbols[0].name, "PythonClass");
  assert.equal(pySymbols[0].type, "class");
  assert.equal(pySymbols[1].name, "method");
  assert.equal(pySymbols[1].type, "method");  // richer: indented def as method
  assert.equal(pySymbols[2].name, "global_func");
  assert.equal(pySymbols[2].type, "function");

  const goContent = `
package main
type GoStruct struct {}
type GoInterface interface {}
func GoFunc(x int) {}
  `;

  const goSymbols = extractSymbols(goContent, "go");
  assert.equal(goSymbols.length, 3);
  assert.equal(goSymbols[0].name, "GoStruct");
  assert.equal(goSymbols[0].type, "struct");
  assert.equal(goSymbols[1].name, "GoInterface");
  assert.equal(goSymbols[1].type, "interface");
  assert.equal(goSymbols[2].name, "GoFunc");
  assert.equal(goSymbols[2].type, "function");
});

test("cognitive-index: upserts and retrieves symbols successfully", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-cognitive-index-symbols-"));
  try {
    const idx = new CognitiveIndex(dir);
    await idx.init();

    idx.upsertSymbolNode("src/app.ts", {
      name: "run",
      type: "function",
      line: 10,
      signature: "export function run()",
    });

    const symbols = idx.getSymbolsForFile("src/app.ts");
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "run");
    assert.equal(symbols[0].type, "function");
    assert.equal(symbols[0].line, 10);
    assert.equal(symbols[0].signature, "export function run()");

    idx.clearSymbolsForFile("src/app.ts");
    const symbolsAfter = idx.getSymbolsForFile("src/app.ts");
    assert.equal(symbolsAfter.length, 0);

    idx.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/repomap command output prints scanned symbols", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-repomap-command-"));
  try {
    await writeFile(join(dir, "app.ts"), "export class AppController {}", "utf-8");

    const outputs = [];
    const context = {
      workspaceDir: dir,
      writeLine: (line) => outputs.push(line),
      writeError: (line) => outputs.push(`ERROR: ${line}`),
      agentLoop: {
        getWorkspaceDir: () => dir,
      },
    };

    await repomapCommand.execute([], context);

    const joined = outputs.join("\n");
    assert.match(joined, /=== 🗺️  Repository Symbol Map/);
    assert.match(joined, /app\.ts/);
    assert.match(joined, /\[class\] L1: AppController/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
