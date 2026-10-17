// Local hook-overhead probe. No network.
// Configures one JSON PreToolUse hook whose matcher is bash-only.
// Before matcher support exists, the field is ignored and every tool spawns.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonHookRunner } from "../dist/hooks/json-hooks.js";

const N = Math.max(1, Number(process.env.QLING_HOOK_OVERHEAD_N) || 20);

const dir = await mkdtemp(join(tmpdir(), "qling-hook-overhead-"));
const counterPath = join(dir, "spawns.txt");
const scriptPath = join(dir, "counter.mjs");
try {
  await writeFile(
    scriptPath,
    [
      "import { appendFileSync } from 'node:fs';",
      "let raw = '';",
      "process.stdin.on('data', (chunk) => { raw += chunk; });",
      "process.stdin.on('end', () => {",
      "  appendFileSync(process.env.COUNTER_PATH, '1\\n');",
      "});",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(counterPath, "", "utf8");
  process.env.COUNTER_PATH = counterPath;

  const runner = new JsonHookRunner(
    {
      version: 1,
      events: {
        PreToolUse: [
          {
            name: "bash-only-counter",
            matcher: "^bash$",
            command: process.execPath,
            args: [scriptPath],
          },
        ],
      },
    },
    {
      workspaceDir: dir,
      auditPath: join(dir, "audit", "events.jsonl"),
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    }
  );

  const hookContext = (toolName) => ({
    toolName,
    arguments: { path: "overhead.txt" },
    inputSchema: {},
    isReadOnly: toolName !== "bash",
    isDestructive: false,
    isConcurrencySafe: true,
    dangerousPatterns: [],
  });

  async function measure(toolName) {
    await writeFile(counterPath, "", "utf8");
    const started = performance.now();
    for (let i = 0; i < N; i++) {
      await runner.runPre(hookContext(toolName));
    }
    const elapsed = performance.now() - started;
    const text = await readFile(counterPath, "utf8");
    const spawns = text.split(/\r?\n/).filter((line) => line.length > 0).length;
    return {
      spawns,
      avgMs: Math.round((elapsed / N) * 100) / 100,
    };
  }

  const read = await measure("read");
  const bash = await measure("bash");
  process.stdout.write(
    JSON.stringify({
      readSpawns: read.spawns,
      bashSpawns: bash.spawns,
      avgMsPerReadCall: read.avgMs,
      avgMsPerBashCall: bash.avgMs,
    })
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
