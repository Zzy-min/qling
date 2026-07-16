// ============================================================
// console-guard — 启动/TUI 安静模式：只留顶栏 + 输入框
// Dashboard 等服务仍照常启动，仅抑制横幅日志
// ============================================================

let tuiActive = false;
/** chat/repl 启动阶段：Agent 初始化日志静默 */
let bootQuiet = false;
let installed = false;

const original = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  log: console.log.bind(console),
};

/** 测试用：卸载 hook 并恢复 console */
export function resetConsoleGuardForTests(): void {
  tuiActive = false;
  bootQuiet = false;
  if (installed) {
    console.error = original.error;
    console.warn = original.warn;
    console.log = original.log;
    installed = false;
  }
}

/**
 * 启动/TUI 期间可静默的信息类日志。
 * 真正失败（init failed / 启动跳过）仍会显示。
 */
const QUIET_PATTERNS: RegExp[] = [
  /\[ProjectionWorker\]\s+replayed/i,
  /\[Memory\].*Embedding/i,
  /\[Memory\].*语义索引/i,
  /\[Memory\].*WAL enabled/i,
  /\[Memory\].*降级/i,
  /\[Metrics\]\s+enabled/i,
  /认知引擎模块已启动/i,
  /正在同步动态插件/i,
  /已发现 \d+ 个工具定义/i,
  /Dashboard 运行在/i,
  /\[MCP\]\s+Connected/i,
  /\[MCP\]\s+Init failed/i,
  /\[AutoDream\]/i,
  /📦 上下文压缩/i,
  /📦 压缩完成/i,
  /📦 已发现/i,
  /Warning:/i,
  // Agent 运行期运维日志：打到 stderr 会撕裂 TUI 进度行/输入框
  /📊\s*\[Obs\]/i,
  /\[Obs\]\s+turn=/i,
  /🔧\s*执行\s*\d+\s*个工具/i,
  /✨\s*\[认知\]/i,
  /💭\s*\[内省/i,
  /🚨\s*\[内省/i,
  /⚠️\s*\[SpecBoost\]/i,
  /检测到\s*\d+\s*处/i,
];

/** 安静模式下仍允许透出的致命/需用户处理信息 */
const FORCE_SHOW_PATTERNS: RegExp[] = [
  /Dashboard 启动跳过/i,
  /WAL init failed/i,
  /Metrics\/Dashboard\] init failed/i,
  /Error:\s*\[/i,
  /FATAL/i,
  /process\.exit/i,
];

function textOf(args: unknown[]): string {
  return args.map((a) => String(a ?? "")).join(" ");
}

function shouldQuiet(args: unknown[]): boolean {
  if (!tuiActive && !bootQuiet) return false;
  if (process.env.QLING_BOOT_VERBOSE === "1") return false;
  const text = textOf(args);
  if (FORCE_SHOW_PATTERNS.some((re) => re.test(text))) return false;
  if (QUIET_PATTERNS.some((re) => re.test(text))) return true;
  // TUI 活跃：吞掉其余带运维前缀的 console 噪声（避免 \r 进度行被 stderr 打穿）
  if (tuiActive) {
    if (/^["']?\{.*"type"\s*:\s*"observability"/i.test(text.trim())) return true;
    if (/^\s*[📊🔧📦✨💭⚠️🚨✅❌]/.test(text)) return true;
    if (/\[[A-Za-z][A-Za-z0-9_-]*\]/.test(text) && !/Error:\s*\[/i.test(text)) {
      // e.g. [Memory] [MCP] operational — real errors still pass FORCE_SHOW
      if (!/failed|error|exception|FATAL/i.test(text)) return true;
    }
  }
  // boot 阶段：默认吞掉其余 info 横幅；TUI 阶段仅吞名单内
  if (bootQuiet && !tuiActive) {
    // 仍显示明显错误关键词
    if (/失败|failed|error|exception|EADDRINUSE/i.test(text) && !/Init failed/i.test(text)) {
      // MCP Init failed already in quiet list; allow other errors
      if (/跳过|warn|⚠️/i.test(text)) return false;
    }
    // 启动阶段偏严格：非强制显示则静默
    return !FORCE_SHOW_PATTERNS.some((re) => re.test(text));
  }
  return false;
}

function installOnce(): void {
  if (installed) return;
  installed = true;
  original.error = console.error.bind(console);
  original.warn = console.warn.bind(console);
  original.log = console.log.bind(console);

  console.error = (...args: unknown[]) => {
    if (shouldQuiet(args)) return;
    original.error(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (shouldQuiet(args)) return;
    original.warn(...args);
  };
}

/** chat/repl：在 new AgentLoop 之前调用 */
export function enterBootQuietMode(): void {
  if (process.env.QLING_BOOT_VERBOSE === "1") return;
  installOnce();
  bootQuiet = true;
}

export function leaveBootQuietMode(): void {
  bootQuiet = false;
}

/** TUI start 时调用 */
export function enterTuiQuietMode(): void {
  installOnce();
  tuiActive = true;
  // TUI 期间保持 boot quiet，避免退出 boot 后异步日志又冒出来
  bootQuiet = true;
}

/** TUI stop 时调用 */
export function leaveTuiQuietMode(): void {
  tuiActive = false;
  bootQuiet = false;
}

export function isTuiQuietMode(): boolean {
  return tuiActive;
}

export function isBootQuietMode(): boolean {
  return bootQuiet;
}

export function backgroundLog(message: string): void {
  if (tuiActive || bootQuiet) return;
  original.error(message);
}

export function forceConsoleError(...args: unknown[]): void {
  original.error(...args);
}
