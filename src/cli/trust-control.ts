import path from "node:path";
import {
  listTrustedWorkspaces,
  resolveQlingHome,
  trustWorkspace,
  untrustWorkspace,
  type WorkspaceTrustOptions,
} from "../guard/workspace-trust.js";

function trustOptions(options: { homeDir?: string; env?: NodeJS.ProcessEnv }): WorkspaceTrustOptions {
  const env = options.env ?? process.env;
  return {
    env,
    homeDir: options.homeDir ?? resolveQlingHome(env),
  };
}

export async function runTrustCommand(
  args: string[],
  options: { cwd: string; homeDir?: string; env?: NodeJS.ProcessEnv }
): Promise<number> {
  const trustOpts = trustOptions(options);
  if (args.includes("--list") || args.includes("-l")) {
    const entries = await listTrustedWorkspaces(trustOpts);
    if (entries.length === 0) console.log("(无受信工作区)");
    else {
      for (const entry of entries) console.log(entry);
    }
    return 0;
  }
  const dirArg = args.find((arg) => arg && !arg.startsWith("-"));
  const dir = dirArg ? path.resolve(dirArg) : path.resolve(options.cwd);
  const saved = await trustWorkspace(dir, trustOpts);
  console.log(`已受信: ${saved}`);
  console.log("子目录会继承该信任。取消：qling untrust [dir]");
  return 0;
}

export async function runUntrustCommand(
  args: string[],
  options: { cwd: string; homeDir?: string; env?: NodeJS.ProcessEnv }
): Promise<number> {
  const trustOpts = trustOptions(options);
  const dirArg = args.find((arg) => arg && !arg.startsWith("-"));
  const dir = dirArg ? path.resolve(dirArg) : path.resolve(options.cwd);
  const removed = await untrustWorkspace(dir, trustOpts);
  if (removed) console.log(`已取消受信: ${dir}`);
  else console.log(`受信列表中没有精确条目: ${dir}（从父目录继承的信任不会被这一条取消）`);
  return 0;
}
