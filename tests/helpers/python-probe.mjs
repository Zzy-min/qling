import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Host-independent environment probe for project-profile unit tests.
 * Discovery must not depend on whether the runner has Python or pytest.
 * `pythonInvocation` is absolute so the profile spawns this process, not PATH.
 */
export function hostIndependentPythonProbe(options = {}) {
  const availableModules = new Set(options.availableModules ?? ["pytest"]);
  const unavailableDistributions = new Set(options.unavailableDistributions ?? []);
  const probe = {
    commandExists: async (command) => command === "python" || command === "python3",
    pythonModuleAvailable: async (_executable, moduleName) => availableModules.has(moduleName),
    pythonDistributionAvailable: async (_executable, distribution) => {
      if (options.allDistributionsUnavailable) return false;
      return !unavailableDistributions.has(distribution);
    },
  };
  if (options.invocation) probe.pythonInvocation = options.invocation;
  return probe;
}

/** A node script that exits 0 for `python -m pytest` and writes nothing. */
export async function createPassingPytestProbe(options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "qling-pytest-stub-"));
  const script = path.join(dir, "pytest-stub.mjs");
  await writeFile(script, [
    "const args = process.argv.slice(2);",
    "if (args[0] === '-m' && args[1] === 'pytest') process.exit(0);",
    "process.stderr.write('unexpected python invocation\\n');",
    "process.exit(1);",
    "",
  ].join("\n"));
  const probe = hostIndependentPythonProbe({
    ...options,
    invocation: { executable: process.execPath, argsPrefix: [script] },
  });
  return {
    probe,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
