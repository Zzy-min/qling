import type { CliGlobalOptions, loadQlingConfig } from "../config.js";
import { runConnectionWizard, shouldRunFirstRunSetup } from "./setup.js";
type Loaded = Awaited<ReturnType<typeof loadQlingConfig>>;
/** First-run orchestration occurs before publishing derived env or constructing an AgentLoop. */
export async function prepareStartupConnection(options: {
  mode: string; json?: boolean; isTTY: boolean; loaded: Loaded; cli: CliGlobalOptions;
  load: typeof loadQlingConfig;
  wizard?: typeof runConnectionWizard;
}): Promise<{ loaded: Loaded; status: "ready" | "cancelled" | "required" }> {
  if (!["chat", "repl", "run"].includes(options.mode)) return { loaded: options.loaded, status: "ready" };
  if (!(await shouldRunFirstRunSetup(options.loaded.config, { isTTY: true }))) return { loaded: options.loaded, status: "ready" };
  if (options.mode === "run" || options.json || !options.isTTY) return { loaded: options.loaded, status: "required" };
  const result = await (options.wizard ?? runConnectionWizard)({ stateDir: options.loaded.config.runtime.file_state_dir });
  if (result.status !== "saved") return { loaded: options.loaded, status: "cancelled" };
  const loaded = await options.load(options.cli);
  return { loaded, status: await shouldRunFirstRunSetup(loaded.config, { isTTY: true }) ? "required" : "ready" };
}
