import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCliArgs, buildHelpText, buildVersionText } from "../../dist/cli/startup-contract.js";
import { getPackageVersion } from "../../dist/package-version.js";

test("package metadata exposes qling as the official CLI binary", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8"));

  assert.equal(pkg.name, "@qlingzzy/qling");
  assert.ok(pkg.bin?.qling === "dist/index.js" || pkg.bin?.qling === "./dist/index.js");
});

test("cli: --version and -V route to version mode without requiring API key", () => {
  for (const args of [["--version"], ["-V"], ["-v"], ["version"]]) {
    const result = parseCliArgs(args);
    assert.equal(result.kind, "ok", args.join(" "));
    assert.equal(result.mode, "version", args.join(" "));
  }
});

test("cli: --help still wins over --version", () => {
  const result = parseCliArgs(["--version", "--help"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "help");
});

test("cli: version text matches package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8"));
  assert.equal(getPackageVersion(), pkg.version);
  assert.equal(buildVersionText("qling"), `qling/${pkg.version}`);
});

test("cli: help text no longer advertises stale v0.3/v0.5 section labels", () => {
  const help = buildHelpText("qling");
  assert.match(help, /--version/);
  assert.doesNotMatch(help, /管理命令 \(v0\.3\)/);
  assert.doesNotMatch(help, /使命管理 \(v0\.5/);
  assert.match(help, new RegExp(`qling ${getPackageVersion()}`));
});

test("cli: no args defaults to chat (TUI)", () => {
  const result = parseCliArgs([]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "chat");
});

test("cli: --help has highest priority", () => {
  const result = parseCliArgs(["--help", "--repl", "--once", "x"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "help");
  assert.deepEqual(result.subArgs, []);
});

test("cli: help flags preserve focused local help topics", () => {
  const helpBeforeTopic = parseCliArgs(["--help", "exports"]);
  const shortHelpBeforeTopic = parseCliArgs(["-h", "permissions"]);
  const helpAfterCommand = parseCliArgs(["exports", "--help"]);
  const helpAfterChineseAlias = parseCliArgs(["导出列表", "-h"]);
  const helpAfterTypo = parseCliArgs(["expors", "--help"]);

  assert.equal(helpBeforeTopic.kind, "ok");
  assert.equal(helpBeforeTopic.mode, "help");
  assert.deepEqual(helpBeforeTopic.subArgs, ["exports"]);

  assert.equal(shortHelpBeforeTopic.kind, "ok");
  assert.equal(shortHelpBeforeTopic.mode, "help");
  assert.deepEqual(shortHelpBeforeTopic.subArgs, ["permissions"]);

  assert.equal(helpAfterCommand.kind, "ok");
  assert.equal(helpAfterCommand.mode, "help");
  assert.deepEqual(helpAfterCommand.subArgs, ["exports"]);

  assert.equal(helpAfterChineseAlias.kind, "ok");
  assert.equal(helpAfterChineseAlias.mode, "help");
  assert.deepEqual(helpAfterChineseAlias.subArgs, ["exports"]);

  assert.equal(helpAfterTypo.kind, "ok");
  assert.equal(helpAfterTypo.mode, "help");
  assert.deepEqual(helpAfterTypo.subArgs, ["expors"]);
});

test("cli: explicit subcommands route correctly", () => {
  const chat = parseCliArgs(["chat"]);
  const repl = parseCliArgs(["repl"]);
  const run = parseCliArgs(["run", "fix bug"]);
  const mission = parseCliArgs(["mission", "show", "msn_123"]);
  const daemon = parseCliArgs(["daemon", "status"]);
  const agents = parseCliArgs(["agents"]);
  const logs = parseCliArgs(["logs", "msn_123"]);
  const doctor = parseCliArgs(["doctor"]);
  const status = parseCliArgs(["status"]);
  const storage = parseCliArgs(["storage"]);
  const exportsList = parseCliArgs(["exports", "2"]);
  const sessions = parseCliArgs(["sessions", "2"]);
  const checkpoint = parseCliArgs(["checkpoint", "before-refactor"]);
  const checkpointSession = parseCliArgs(["checkpoint", "manual-save", "--session", "session-123"]);
  const privacy = parseCliArgs(["privacy"]);
  const context = parseCliArgs(["context"]);
  const shortcuts = parseCliArgs(["shortcuts"]);
  const statusline = parseCliArgs(["statusline"]);
  const recap = parseCliArgs(["recap", "latest", "2"]);
  const permissions = parseCliArgs(["permissions"]);
  const permissionsExplain = parseCliArgs(["permissions", "explain", "bash"]);
  const config = parseCliArgs(["config"]);
  const mcp = parseCliArgs(["mcp"]);
  const hooks = parseCliArgs(["hooks"]);
  const tasks = parseCliArgs(["tasks", "list", "3"]);
  const goal = parseCliArgs(["goal", "status", "latest"]);
  const memory = parseCliArgs(["memory", "status", "3"]);
  const memorySearch = parseCliArgs(["memory", "search", "permission", "3"]);
  const memoryPractices = parseCliArgs(["memory", "practices", "3"]);
  const memoryGraph = parseCliArgs(["memory", "graph", "3"]);
  const help = parseCliArgs(["help"]);
  const helpTopic = parseCliArgs(["help", "exports"]);
  const bootstrap = parseCliArgs(["bootstrap"]);
  const bootstrapFlags = parseCliArgs(["bootstrap", "--yes", "--with-browser", "--profile", "dev"]);
  assert.equal(chat.kind, "ok");
  assert.equal(chat.mode, "chat");
  assert.equal(repl.kind, "ok");
  assert.equal(repl.mode, "repl");
  assert.equal(run.kind, "ok");
  assert.equal(run.mode, "run");
  assert.equal(run.task, "fix bug");
  assert.equal(mission.kind, "ok");
  assert.equal(mission.mode, "mission");
  assert.deepEqual(mission.subArgs, ["show", "msn_123"]);
  assert.equal(daemon.kind, "ok");
  assert.equal(daemon.mode, "daemon");
  assert.deepEqual(daemon.subArgs, ["status"]);
  assert.equal(agents.kind, "ok");
  assert.equal(agents.mode, "agents");
  assert.equal(logs.kind, "ok");
  assert.equal(logs.mode, "logs");
  assert.deepEqual(logs.subArgs, ["msn_123"]);
  assert.equal(doctor.kind, "ok");
  assert.equal(doctor.mode, "doctor");
  assert.equal(status.kind, "ok");
  assert.equal(status.mode, "status");
  assert.equal(storage.kind, "ok");
  assert.equal(storage.mode, "storage");
  assert.equal(exportsList.kind, "ok");
  assert.equal(exportsList.mode, "exports");
  assert.deepEqual(exportsList.subArgs, ["2"]);
  assert.equal(sessions.kind, "ok");
  assert.equal(sessions.mode, "sessions");
  assert.deepEqual(sessions.subArgs, ["2"]);
  assert.equal(checkpoint.kind, "ok");
  assert.equal(checkpoint.mode, "checkpoint");
  assert.deepEqual(checkpoint.subArgs, ["before-refactor"]);
  assert.equal(checkpointSession.kind, "ok");
  assert.equal(checkpointSession.mode, "checkpoint");
  assert.deepEqual(checkpointSession.subArgs, ["manual-save", "--session", "session-123"]);
  assert.equal(privacy.kind, "ok");
  assert.equal(privacy.mode, "privacy");
  assert.equal(context.kind, "ok");
  assert.equal(context.mode, "context");
  assert.equal(shortcuts.kind, "ok");
  assert.equal(shortcuts.mode, "shortcuts");
  assert.equal(statusline.kind, "ok");
  assert.equal(statusline.mode, "statusline");
  assert.equal(recap.kind, "ok");
  assert.equal(recap.mode, "recap");
  assert.deepEqual(recap.subArgs, ["latest", "2"]);
  assert.equal(permissions.kind, "ok");
  assert.equal(permissions.mode, "permissions");
  assert.equal(permissionsExplain.kind, "ok");
  assert.equal(permissionsExplain.mode, "permissions");
  assert.deepEqual(permissionsExplain.subArgs, ["explain", "bash"]);
  assert.equal(config.kind, "ok");
  assert.equal(config.mode, "config");
  assert.equal(mcp.kind, "ok");
  assert.equal(mcp.mode, "mcp");
  assert.equal(hooks.kind, "ok");
  assert.equal(hooks.mode, "hooks");
  assert.equal(tasks.kind, "ok");
  assert.equal(tasks.mode, "tasks");
  assert.deepEqual(tasks.subArgs, ["list", "3"]);
  assert.equal(goal.kind, "ok");
  assert.equal(goal.mode, "goal");
  assert.deepEqual(goal.subArgs, ["status", "latest"]);
  assert.equal(memory.kind, "ok");
  assert.equal(memory.mode, "memory");
  assert.deepEqual(memory.subArgs, ["status", "3"]);
  assert.equal(memorySearch.kind, "ok");
  assert.equal(memorySearch.mode, "memory");
  assert.deepEqual(memorySearch.subArgs, ["search", "permission", "3"]);
  assert.equal(memoryPractices.kind, "ok");
  assert.equal(memoryPractices.mode, "memory");
  assert.deepEqual(memoryPractices.subArgs, ["practices", "3"]);
  assert.equal(memoryGraph.kind, "ok");
  assert.equal(memoryGraph.mode, "memory");
  assert.deepEqual(memoryGraph.subArgs, ["graph", "3"]);
  assert.equal(help.kind, "ok");
  assert.equal(help.mode, "help");
  assert.equal(helpTopic.kind, "ok");
  assert.equal(helpTopic.mode, "help");
  assert.deepEqual(helpTopic.subArgs, ["exports"]);
  assert.equal(bootstrap.kind, "ok");
  assert.equal(bootstrap.mode, "bootstrap");
  assert.deepEqual(bootstrap.subArgs, []);
  assert.equal(bootstrapFlags.kind, "ok");
  assert.equal(bootstrapFlags.mode, "bootstrap");
  assert.deepEqual(bootstrapFlags.subArgs, ["--yes", "--with-browser", "--profile", "dev"]);
});

test("cli: chinese local management aliases route to canonical modes", () => {
  const doctor = parseCliArgs(["诊断"]);
  const status = parseCliArgs(["状态"]);
  const storage = parseCliArgs(["存储"]);
  const exportsList = parseCliArgs(["导出列表", "2"]);
  const sessions = parseCliArgs(["会话列表", "2"]);
  const checkpoint = parseCliArgs(["检查点", "发布前"]);
  const privacy = parseCliArgs(["隐私"]);
  const context = parseCliArgs(["上下文"]);
  const shortcuts = parseCliArgs(["快捷键"]);
  const statusline = parseCliArgs(["状态线"]);
  const recap = parseCliArgs(["回顾", "2"]);
  const permissions = parseCliArgs(["权限"]);
  const permissionsExplain = parseCliArgs(["权限", "解释", "bash"]);
  const config = parseCliArgs(["配置"]);
  const mcpUpper = parseCliArgs(["MCP"]);
  const mcpCn = parseCliArgs(["外部工具"]);
  const hooksCn = parseCliArgs(["钩子"]);
  const tasksCn = parseCliArgs(["任务", "取消", "tsk_1"]);
  const goalCn = parseCliArgs(["目标", "设置", "完成 ci"]);
  const memoryCn = parseCliArgs(["记忆", "查看", "mem_1"]);
  const memorySearchCn = parseCliArgs(["记忆", "搜索", "权限模式", "2"]);
  const memoryPracticesCn = parseCliArgs(["记忆", "经验", "2"]);
  const memoryGraphCn = parseCliArgs(["记忆", "图谱", "2"]);
  const helpCn = parseCliArgs(["帮助"]);
  const helpTopicCn = parseCliArgs(["帮助", "权限"]);

  assert.equal(doctor.kind, "ok");
  assert.equal(doctor.mode, "doctor");
  assert.equal(status.kind, "ok");
  assert.equal(status.mode, "status");
  assert.equal(storage.kind, "ok");
  assert.equal(storage.mode, "storage");
  assert.equal(exportsList.kind, "ok");
  assert.equal(exportsList.mode, "exports");
  assert.deepEqual(exportsList.subArgs, ["2"]);
  assert.equal(sessions.kind, "ok");
  assert.equal(sessions.mode, "sessions");
  assert.deepEqual(sessions.subArgs, ["2"]);
  assert.equal(checkpoint.kind, "ok");
  assert.equal(checkpoint.mode, "checkpoint");
  assert.deepEqual(checkpoint.subArgs, ["发布前"]);
  assert.equal(privacy.kind, "ok");
  assert.equal(privacy.mode, "privacy");
  assert.equal(context.kind, "ok");
  assert.equal(context.mode, "context");
  assert.equal(shortcuts.kind, "ok");
  assert.equal(shortcuts.mode, "shortcuts");
  assert.equal(statusline.kind, "ok");
  assert.equal(statusline.mode, "statusline");
  assert.equal(recap.kind, "ok");
  assert.equal(recap.mode, "recap");
  assert.deepEqual(recap.subArgs, ["2"]);
  assert.equal(permissions.kind, "ok");
  assert.equal(permissions.mode, "permissions");
  assert.equal(permissionsExplain.kind, "ok");
  assert.equal(permissionsExplain.mode, "permissions");
  assert.deepEqual(permissionsExplain.subArgs, ["解释", "bash"]);
  assert.equal(config.kind, "ok");
  assert.equal(config.mode, "config");
  assert.equal(mcpUpper.kind, "ok");
  assert.equal(mcpUpper.mode, "mcp");
  assert.equal(mcpCn.kind, "ok");
  assert.equal(mcpCn.mode, "mcp");
  assert.equal(hooksCn.kind, "ok");
  assert.equal(hooksCn.mode, "hooks");
  assert.equal(tasksCn.kind, "ok");
  assert.equal(tasksCn.mode, "tasks");
  assert.deepEqual(tasksCn.subArgs, ["取消", "tsk_1"]);
  assert.equal(goalCn.kind, "ok");
  assert.equal(goalCn.mode, "goal");
  assert.deepEqual(goalCn.subArgs, ["设置", "完成 ci"]);
  assert.equal(memoryCn.kind, "ok");
  assert.equal(memoryCn.mode, "memory");
  assert.deepEqual(memoryCn.subArgs, ["查看", "mem_1"]);
  assert.equal(memorySearchCn.kind, "ok");
  assert.equal(memorySearchCn.mode, "memory");
  assert.deepEqual(memorySearchCn.subArgs, ["搜索", "权限模式", "2"]);
  assert.equal(memoryPracticesCn.kind, "ok");
  assert.equal(memoryPracticesCn.mode, "memory");
  assert.deepEqual(memoryPracticesCn.subArgs, ["经验", "2"]);
  assert.equal(memoryGraphCn.kind, "ok");
  assert.equal(memoryGraphCn.mode, "memory");
  assert.deepEqual(memoryGraphCn.subArgs, ["图谱", "2"]);
  assert.equal(helpCn.kind, "ok");
  assert.equal(helpCn.mode, "help");
  assert.equal(helpTopicCn.kind, "ok");
  assert.equal(helpTopicCn.mode, "help");
  assert.deepEqual(helpTopicCn.subArgs, ["权限"]);
});

test("cli: chinese mission management aliases route to canonical modes", () => {
  const mission = parseCliArgs(["使命", "列表"]);
  const agents = parseCliArgs(["代理"]);
  const logs = parseCliArgs(["日志", "msn_123"]);

  assert.equal(mission.kind, "ok");
  assert.equal(mission.mode, "mission");
  assert.deepEqual(mission.subArgs, ["列表"]);
  assert.equal(agents.kind, "ok");
  assert.equal(agents.mode, "agents");
  assert.equal(logs.kind, "ok");
  assert.equal(logs.mode, "logs");
  assert.deepEqual(logs.subArgs, ["msn_123"]);
});

test("cli: --continue defaults to chat and records interactive restore intent", () => {
  const result = parseCliArgs(["--continue"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "chat");
  assert.equal(result.global.continueSession, true);
  assert.equal(result.global.resumeSession, undefined);
});

test("cli: --resume <id> defaults to chat and records restore target", () => {
  const result = parseCliArgs(["--resume", "session-123"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "chat");
  assert.equal(result.global.continueSession, undefined);
  assert.equal(result.global.resumeSession, "session-123");
});

test("cli: positional task remains valid for one-shot execution (compat)", () => {
  const result = parseCliArgs(["修复", "bug"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "run");
  assert.equal(result.task, "修复 bug");
});

test("cli: top-level english typo suggests local command without running task", () => {
  const result = parseCliArgs(["expors"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_UNKNOWN_COMMAND_SUGGESTION");
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /expors/);
  assert.match(result.message, /原因/);
  assert.match(result.message, /下一步/);
  assert.match(result.message, /示例/);
  assert.match(result.message, /本地执行: 是/);
  assert.match(result.message, /模型调用: 否/);
  assert.match(result.message, /qling exports/);
  assert.match(result.message, /qling help exports/);
  assert.match(result.message, /qling run "expors"/);
  assert.match(result.message, /不调用模型/);
});

test("cli: top-level chinese typo suggests local alias without running task", () => {
  const result = parseCliArgs(["导出列"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_UNKNOWN_COMMAND_SUGGESTION");
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /导出列/);
  assert.match(result.message, /原因/);
  assert.match(result.message, /下一步/);
  assert.match(result.message, /本地执行: 是/);
  assert.match(result.message, /模型调用: 否/);
  assert.match(result.message, /qling 导出列表/);
  assert.match(result.message, /qling help 导出列表/);
  assert.match(result.message, /qling run "导出列"/);
});

test("cli: weak single-token command-like input remains positional task", () => {
  const result = parseCliArgs(["zzzzzz"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "run");
  assert.equal(result.task, "zzzzzz");
});

test("cli: conflict returns CLI_INVALID_MODE_COMBINATION with exit code 2", () => {
  const result = parseCliArgs(["repl", "--once", "x"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_INVALID_MODE_COMBINATION");
  assert.equal(result.exitCode, 2);
  // 使用统一 guidance formatter（含中文标签）
  assert.match(result.message || "", /原因|模式冲突|下一步/);
});

test("cli: --continue and --resume cannot be combined", () => {
  const result = parseCliArgs(["--continue", "--resume", "session-123"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_INVALID_MODE_COMBINATION");
  assert.equal(result.exitCode, 2);
  assert.match(result.message || "", /原因|模式冲突/);
});

test("cli: run mode cannot combine with --continue/--resume", () => {
  const continued = parseCliArgs(["run", "fix bug", "--continue"]);
  assert.equal(continued.kind, "error");
  assert.equal(continued.code, "CLI_INVALID_MODE_COMBINATION");
  assert.match(continued.message || "", /原因|模式冲突/);

  const resumed = parseCliArgs(["run", "fix bug", "--resume", "session-123"]);
  assert.equal(resumed.kind, "error");
  assert.equal(resumed.code, "CLI_INVALID_MODE_COMBINATION");
  assert.match(resumed.message || "", /原因|模式冲突/);
});

test("cli: missing --once task returns CLI_MISSING_TASK with exit code 2", () => {
  const result = parseCliArgs(["--once"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_MISSING_TASK");
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /原因/);
  assert.match(result.message, /下一步/);
  assert.match(result.message, /示例/);
  assert.match(result.message, /本地执行: 是/);
  assert.match(result.message, /模型调用: 否/);
});

test("cli: run without task returns CLI_MISSING_TASK", () => {
  const result = parseCliArgs(["run"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_MISSING_TASK");
  assert.match(result.message, /qling run "分析这个仓库"/);
});

test("cli: help text includes subcommands and compatibility hints", () => {
  const help = buildHelpText("qling");
  assert.match(help, /新手路径/);
  assert.match(help, /qling bootstrap/);
  assert.match(help, /qling run "你的任务"/);
  assert.match(help, /qling run "分析这个仓库"/);
  assert.match(help, /qling help/);
  assert.match(help, /qling setup/);
  assert.match(help, /--continue/);
  assert.match(help, /--resume <session>/);
  assert.match(help, /qling agents/);
  assert.match(help, /qling logs <id>/);
  assert.match(help, /qling doctor/);
  assert.match(help, /qling privacy/);
  assert.match(help, /qling status/);
  assert.match(help, /qling storage/);
  assert.match(help, /qling exports \[count\]/);
  assert.match(help, /qling sessions \[count\]/);
  assert.match(help, /qling checkpoint \[name\]/);
  assert.match(help, /qling privacy/);
  assert.match(help, /qling context/);
  assert.match(help, /qling shortcuts/);
  assert.match(help, /qling statusline/);
  assert.match(help, /qling recap/);
  assert.match(help, /qling permissions/);
  assert.match(help, /qling permissions explain/);
  assert.match(help, /qling config/);
  assert.match(help, /qling mcp/);
  assert.match(help, /qling hooks/);
  assert.match(help, /qling tasks list/);
  assert.match(help, /qling tasks cancel <id>/);
  assert.match(help, /qling goal status/);
  assert.match(help, /qling goal set/);
  assert.match(help, /qling goal clear/);
  assert.match(help, /qling memory status/);
  assert.match(help, /qling memory search/);
  assert.match(help, /qling memory practices/);
  assert.match(help, /qling memory graph/);
  assert.match(help, /qling memory show <id>/);
  assert.match(help, /诊断/);
  assert.match(help, /状态/);
  assert.match(help, /存储/);
  assert.match(help, /导出列表/);
  assert.match(help, /会话列表/);
  assert.match(help, /检查点/);
  assert.match(help, /隐私/);
  assert.match(help, /上下文/);
  assert.match(help, /快捷键/);
  assert.match(help, /状态线/);
  assert.match(help, /回顾/);
  assert.match(help, /权限/);
  assert.match(help, /配置/);
  assert.match(help, /外部工具/);
  assert.match(help, /钩子/);
  assert.match(help, /任务/);
  assert.match(help, /目标/);
  assert.match(help, /记忆/);
  assert.match(help, /帮助/);
  assert.match(help, /使命/);
  assert.match(help, /代理/);
  assert.match(help, /日志/);
  assert.match(help, /daemon start/);
  assert.match(help, /daemon status/);
  assert.match(help, /daemon stop/);
  assert.match(help, /mission attach <id>/);
  assert.match(help, /mission stop <id>/);
  assert.match(help, /mission respawn <id>/);
  assert.match(help, /mission show <id>/);
  assert.match(help, /mission pause <id>/);
  assert.match(help, /mission retry <id>/);
  assert.match(help, /mission terminate <id>/);
  assert.match(help, /兼容别名/);
  assert.match(help, /CLI_INVALID_MODE_COMBINATION/);
});

test("cli: help text can focus on a single local topic", () => {
  const exportsHelp = buildHelpText("qling", "exports");
  assert.match(exportsHelp, /聚焦帮助/);
  assert.match(exportsHelp, /Topic\s*: exports/);
  assert.match(exportsHelp, /Usage\s*: qling exports \[count\]/);
  assert.match(exportsHelp, /qling exports 20/);
  assert.match(exportsHelp, /qling 导出列表 20/);
  assert.match(exportsHelp, /只读取本地文件元数据/);

  const permissionsHelp = buildHelpText("qling", "权限");
  assert.match(permissionsHelp, /Topic\s*: permissions/);
  assert.match(permissionsHelp, /qling permissions explain <tool>/);
  assert.match(permissionsHelp, /qling 权限 解释 <tool>/);

  const checkpointHelp = buildHelpText("qling", "checkpoint");
  assert.match(checkpointHelp, /Topic\s*: checkpoint/);
  assert.match(checkpointHelp, /Usage\s*: qling checkpoint \[name\]/);
  assert.match(checkpointHelp, /qling checkpoint before-refactor/);
  assert.match(checkpointHelp, /不调用模型/);
});
