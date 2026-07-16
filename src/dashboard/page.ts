export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>轻灵 · 任务工作台 / Mission Control</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true">QL</span>
        <div>
          <p class="eyebrow">MISSION CONTROL · 127.0.0.1 ONLY</p>
          <h1>轻灵任务工作台</h1>
        </div>
      </div>
      <div class="runtime-strip" aria-live="polite">
        <span class="signal" id="runtime-signal"></span>
        <span id="runtime-label">正在连接本地运行时</span>
        <span class="divider"></span>
        <span id="source-label">LOCAL</span>
        <span class="divider"></span>
        <span id="budget-label">Tokens —</span>
        <button class="icon-button" id="refresh-button" type="button">刷新</button>
      </div>
    </header>

    <section class="trust-band" aria-label="本地边界">
      <span>仅监听 127.0.0.1</span>
      <span>任务正文不外传</span>
      <span>控制面可暂停 / 恢复 / 取消长任务</span>
      <span id="permission-label-top">权限 —</span>
    </section>

    <section class="summary-band" aria-label="任务摘要">
      <div class="summary-lead"><span>当前态势</span><strong id="summary-total">—</strong></div>
      <div class="summary-item"><span>运行</span><strong id="summary-running">—</strong></div>
      <div class="summary-item"><span>等待</span><strong id="summary-queued">—</strong></div>
      <div class="summary-item"><span>阻塞</span><strong id="summary-blocked">—</strong></div>
      <div class="summary-item"><span>失败</span><strong id="summary-failed">—</strong></div>
      <time id="updated-at">尚未同步</time>
    </section>

    <section class="session-band" aria-labelledby="session-heading">
      <div class="section-heading">
        <div><p class="eyebrow">SESSIONS</p><h2 id="session-heading">最近会话</h2></div>
        <span id="session-hint">只读 · 深链 qling --resume &lt;id&gt; · TUI 舰队 /dashboard</span>
      </div>
      <div class="session-rail" id="session-list" aria-live="polite">
        <span class="muted">等待会话…</span>
      </div>
    </section>

    <main class="workbench">
      <section class="task-rail" aria-labelledby="task-heading">
        <div class="section-heading">
          <div><p class="eyebrow">TASK RAIL</p><h2 id="task-heading">任务轨道</h2></div>
          <span id="visible-count">0 项</span>
        </div>
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <input id="task-search" type="search" placeholder="搜索任务、会话或状态" autocomplete="off">
        </label>
        <div class="filter-row" id="kind-filters" aria-label="任务类型筛选">
          <button class="filter active" data-filter-kind="all" type="button">全部</button>
          <button class="filter" data-filter-kind="mission" type="button">使命</button>
          <button class="filter" data-filter-kind="loop" type="button">循环</button>
          <button class="filter" data-filter-kind="workflow" type="button">工作流</button>
        </div>
        <div class="filter-row" id="status-filters" aria-label="任务状态筛选">
          <button class="filter active" data-filter-status="all" type="button">活跃优先</button>
          <button class="filter" data-filter-status="active" type="button">仅活跃</button>
          <button class="filter" data-filter-status="failed" type="button">仅失败</button>
        </div>
        <div class="task-list skeleton-stack" id="task-list" aria-live="polite" aria-busy="true">
          <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
        </div>
      </section>

      <aside class="detail-pane" id="detail-pane" aria-label="任务详情">
        <div class="detail-empty" id="detail-empty">
          <span class="crosshair" aria-hidden="true">＋</span>
          <h2 id="detail-heading">选择一项任务</h2>
          <p>查看执行来源、进度、日志和暂停/恢复操作。空列表时可用 TUI：<code>/mission</code> · <code>/loop</code>。</p>
        </div>
        <div class="detail-content" id="detail-content" hidden></div>
      </aside>
    </main>

    <section class="activity-panel" aria-labelledby="activity-heading">
      <div class="section-heading"><div><p class="eyebrow">RECENT SIGNALS</p><h2 id="activity-heading">最近活动</h2></div><span id="activity-boundary">最多 20 条</span></div>
      <ol id="activity-list" class="activity-list"><li class="muted">等待本地指标…</li></ol>
    </section>

    <footer class="boundary-bar">
      <span>本地优先 · Mission Control</span>
      <span id="permission-label">权限 —</span>
      <span id="agent-live-label">会话 —</span>
    </footer>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;

export const DASHBOARD_CSS = `
:root {
  --ink: #e2e8f0; --muted: #94a3b8; --dim: #64748b;
  --ground: #050a08;
  --surface: rgba(13, 20, 17, 0.72);
  --raised: rgba(20, 31, 26, 0.85);
  --line: rgba(99, 213, 162, 0.12);
  --line-strong: rgba(99, 213, 162, 0.25);
  --accent: #4ade80;
  --accent-gradient: linear-gradient(135deg, #63d5a2 0%, #4ade80 50%, #22c55e 100%);
  --glow-shadow: 0 0 16px rgba(74, 222, 128, 0.18);
  --running: #4ade80; --queued: #fbbf24; --blocked: #fb923c;
  --failed: #f87171; --paused: #60a5fa; --radius: 6px;
}
.trust-band {
  display: flex; flex-wrap: wrap; gap: .65rem 1.1rem;
  padding: .55rem 1.25rem;
  border-bottom: 1px solid var(--line);
  color: var(--muted); font-size: .82rem; letter-spacing: .02em;
}
.trust-band span::before { content: "· "; color: var(--accent); }
.session-band {
  padding: .75rem 1.25rem .35rem;
  border-bottom: 1px solid var(--line);
}
.session-rail {
  display: flex; gap: .55rem; overflow-x: auto; padding: .45rem 0 .65rem;
  scrollbar-width: thin;
}
.session-chip {
  flex: 0 0 auto; min-width: 9.5rem; max-width: 14rem;
  padding: .55rem .7rem; border-radius: var(--radius);
  border: 1px solid var(--line); background: var(--surface);
  font-family: "JetBrains Mono", ui-monospace, monospace; font-size: .75rem;
}
.session-chip.active { border-color: var(--line-strong); box-shadow: var(--glow-shadow); }
.session-chip .sid { color: var(--ink); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.session-chip .meta { color: var(--dim); margin-top: .2rem; }
.session-chip .deep-link {
  color: var(--accent, var(--primary, #3d7a5a));
  margin-top: .15rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .78em;
  user-select: all;
  word-break: break-all;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--ink);
  background: var(--ground);
  font-family: "Outfit", "Inter", "Microsoft YaHei UI", sans-serif;
}
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: .18;
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, black, transparent 72%);
}
button, input { font: inherit; }
button { color: inherit; }
.shell { position: relative; width: min(1540px, 100%); margin: 0 auto; padding: clamp(18px, 3vw, 42px); }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 20px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.brand-block { display: flex; align-items: center; gap: 14px; }
.brand-mark {
  display: grid;
  place-items: center;
  width: 44px;
  aspect-ratio: 1;
  border: 1px solid var(--accent);
  color: var(--accent);
  font: 700 13px/1 "JetBrains Mono", "Cascadia Code", monospace;
  letter-spacing: .12em;
  transform: rotate(-3deg);
  background: rgba(74, 222, 128, 0.05);
  box-shadow: var(--glow-shadow);
  border-radius: 4px;
}
.eyebrow { margin: 0 0 4px; color: var(--accent); font: 600 10px/1.2 "JetBrains Mono", "Cascadia Code", monospace; letter-spacing: .2em; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: clamp(20px, 2.5vw, 30px); font-weight: 650; letter-spacing: -.03em; }
h2 { margin-bottom: 0; font-size: 17px; font-weight: 620; }
.runtime-strip { display: flex; align-items: center; gap: 10px; color: var(--muted); font: 12px "JetBrains Mono", monospace; }
.signal { width: 8px; height: 8px; border-radius: 50%; background: var(--queued); box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.2); }
.signal.ready {
  background: var(--running);
  box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.2);
  animation: signal-pulse 2s infinite ease-in-out;
}
@keyframes signal-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.2); }
  50% { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0.45); }
}
.divider { width: 1px; height: 18px; background: var(--line-strong); }
.icon-button, .filter, .action-button {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color .2s, background .2s, transform .1s, box-shadow .2s;
}
.icon-button { padding: 7px 11px; }
.icon-button:hover, .filter:hover, .action-button:hover {
  border-color: var(--accent);
  background: rgba(74, 222, 128, 0.08);
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.15);
}
.icon-button:active, .action-button:active { transform: translateY(1px); }
button:focus-visible, input:focus-visible, .task-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.summary-band {
  display: grid;
  grid-template-columns: minmax(180px, 1.3fr) repeat(4, minmax(90px, .55fr)) minmax(170px, 1fr);
  border-bottom: 1px solid var(--line);
  margin-top: 24px;
}
.summary-band > * { min-height: 88px; padding: 20px 18px; border-right: 1px solid var(--line); display: flex; flex-direction: column; justify-content: center; }
.summary-band > *:last-child { border-right: 0; }
.summary-band span, .summary-band time { color: var(--muted); font: 11px "JetBrains Mono", monospace; }
.summary-band strong { margin-top: 5px; font: 650 26px "JetBrains Mono", monospace; }
.summary-lead { background: var(--accent-gradient); color: #05160d; box-shadow: var(--glow-shadow); border-radius: var(--radius) 0 0 var(--radius); }
.summary-lead span { color: #14532d; font-weight: 600; }
.summary-band time { align-items: flex-end; text-align: right; }
.workbench { display: grid; grid-template-columns: minmax(360px, .9fr) minmax(500px, 1.35fr); min-height: 560px; border-bottom: 1px solid var(--line-strong); }
.task-rail { padding: 28px 26px 28px 0; border-right: 1px solid var(--line-strong); }
.detail-pane {
  position: relative;
  padding: 32px 0 32px 34px;
  min-width: 0;
  background: var(--surface);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.section-heading > span { color: var(--muted); font: 11px "JetBrains Mono", monospace; }
.search-box {
  height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.search-box span { color: var(--accent); font-size: 18px; }
.search-box input { width: 100%; border: 0; outline: 0; color: var(--ink); background: transparent; }
.search-box input::placeholder { color: var(--dim); }
.filter-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.filter { padding: 6px 10px; color: var(--muted); font-size: 11px; font-weight: 500; }
.filter.active { color: #05160d; border-color: var(--accent); background: var(--accent); font-weight: 600; box-shadow: var(--glow-shadow); }
.task-list {
  display: grid;
  gap: 8px;
  margin-top: 18px;
  background: transparent;
  border: 0;
  max-height: 620px;
  overflow: auto;
  padding-right: 4px;
}
.task-row {
  position: relative;
  display: grid;
  grid-template-columns: 6px 1fr auto;
  gap: 13px;
  width: 100%;
  padding: 16px 14px 15px 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  text-align: left;
  background: var(--surface);
  cursor: pointer;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), background 0.22s, border-color 0.22s, box-shadow 0.22s;
}
.task-row:hover {
  transform: translateY(-2px);
  background: var(--raised);
  border-color: var(--line-strong);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4), 0 0 1px var(--accent);
}
.task-row.selected {
  background: var(--raised);
  border-color: var(--accent);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5), 0 0 3px var(--accent);
}
.status-line { width: 3px; height: 100%; justify-self: center; background: var(--dim); border-radius: 2px; }
.status-line.running { background: var(--running); box-shadow: 0 0 8px var(--running); }
.status-line.queued { background: var(--queued); }
.status-line.blocked { background: var(--blocked); }
.status-line.failed { background: var(--failed); }
.status-line.paused { background: var(--paused); }
.task-copy { min-width: 0; }
.task-meta { display: flex; gap: 8px; margin-bottom: 7px; color: var(--muted); font: 500 10px "JetBrains Mono", monospace; text-transform: uppercase; letter-spacing: .08em; }
.task-title { display: block; margin-bottom: 6px; overflow: hidden; color: var(--ink); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.task-description { display: block; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.task-time { color: var(--dim); font: 10px "JetBrains Mono", monospace; white-space: nowrap; align-self: center; }
.detail-empty { min-height: 420px; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--muted); }
.detail-empty p { max-width: 300px; margin-top: 10px; line-height: 1.6; }
.crosshair { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 20px; border: 1px dashed var(--line-strong); color: var(--accent); font: 28px "JetBrains Mono", monospace; border-radius: var(--radius); }
.detail-content { position: relative; animation: reveal .28s cubic-bezier(.22,1,.36,1); }
.detail-close { position: absolute; top: 0; right: 0; }
@keyframes reveal { from { opacity: 0; transform: translateY(12px) scale(0.99); } to { opacity: 1; transform: none; } }
.detail-kicker { color: var(--accent); font: 11px "JetBrains Mono", monospace; text-transform: uppercase; letter-spacing: .12em; }
.detail-title { max-width: 760px; margin: 10px 0 14px; font-size: clamp(22px, 2.8vw, 36px); line-height: 1.1; letter-spacing: -.03em; font-weight: 650; }
.detail-description { max-width: 760px; color: var(--muted); line-height: 1.7; font-size: 14px; }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); margin: 28px 0; border-block: 1px solid var(--line); background: rgba(0,0,0,0.1); border-radius: var(--radius); overflow: hidden; }
.detail-stat { padding: 16px 18px; border-right: 1px solid var(--line); }
.detail-stat:last-child { border-right: 0; }
.detail-stat span { display: block; color: var(--dim); font: 10px "JetBrains Mono", monospace; text-transform: uppercase; letter-spacing: 0.05em; }
.detail-stat strong { display: block; margin-top: 7px; font: 600 13px "JetBrains Mono", monospace; color: var(--ink); }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
.action-button { padding: 9px 16px; font-weight: 600; font-size: 13px; }
.action-button.primary { color: #05160d; border-color: var(--accent); background: var(--accent); box-shadow: var(--glow-shadow); }
.action-button.danger { color: var(--failed); border-color: color-mix(in srgb, var(--failed) 50%, transparent); background: rgba(248, 113, 113, 0.05); }
.event-log {
  position: relative;
  padding-left: 22px;
  margin-top: 15px;
  list-style: none;
  border-top: 0 !important;
}
.event-log::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 10px;
  bottom: 10px;
  width: 1px;
  border-left: 1px dashed var(--line-strong);
}
.event-log li {
  position: relative;
  padding: 10px 0 10px 14px;
  border-bottom: 1px solid var(--line) !important;
  display: grid;
  grid-template-columns: 85px 1fr;
  align-items: center;
  color: var(--muted);
  font-size: 13px;
}
.event-log li::before {
  content: "";
  position: absolute;
  left: -17px;
  top: 50%;
  transform: translateY(-50%);
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line-strong);
  border: 1.5px solid var(--ground);
  transition: background 0.2s, box-shadow 0.2s;
}
.event-log li:hover::before {
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent);
}
.event-log time { color: var(--dim); font: 10px "JetBrains Mono", monospace; }
/* Event Badges */
.event-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 6px;
  border-radius: 3px;
  font: 700 9px/1 "Outfit", sans-serif;
  text-transform: uppercase;
  margin-right: 8px;
  letter-spacing: 0.05em;
}
.event-badge.tool {
  background: rgba(96, 165, 250, 0.12);
  color: var(--paused);
  border: 1px solid rgba(96, 165, 250, 0.25);
}
.event-badge.success {
  background: rgba(74, 222, 128, 0.12);
  color: var(--running);
  border: 1px solid rgba(74, 222, 128, 0.25);
}
.event-badge.error {
  background: rgba(248, 113, 113, 0.12);
  color: var(--failed);
  border: 1px solid rgba(248, 113, 113, 0.25);
}
.event-badge.info {
  background: rgba(148, 163, 184, 0.12);
  color: var(--muted);
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.activity-panel { padding: 28px 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); margin-top: 24px; }
.activity-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 28px; padding: 0; list-style: none; }
.activity-list li { display: grid; grid-template-columns: 88px 110px 1fr; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.activity-list time, .activity-type { color: var(--dim); font: 10px "JetBrains Mono", monospace; }
.boundary-bar { display: flex; flex-wrap: wrap; gap: 8px 24px; padding-top: 18px; border-top: 1px solid var(--line-strong); color: var(--dim); font: 10px "JetBrains Mono", monospace; text-transform: uppercase; letter-spacing: .08em; }
.boundary-bar span::before { content: "□"; margin-right: 7px; color: var(--accent); }
.skeleton-stack { background: transparent; border: 0; }
.skeleton {
  height: 78px;
  margin-bottom: 1px;
  background: var(--surface);
  animation: pulse-skeleton 1.5s infinite ease-in-out;
  border-radius: var(--radius);
}
@keyframes pulse-skeleton {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.85; }
}
.muted, .empty-copy { color: var(--muted); }
.empty-copy { padding: 34px 20px; text-align: center; background: var(--surface); border-radius: var(--radius); border: 1px dashed var(--line); }
.error-copy { color: var(--failed); }
.toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 10;
  max-width: min(420px, calc(100vw - 32px));
  padding: 13px 18px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--raised);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 16px 50px rgba(0,0,0,0.6);
  font-size: 13px;
  font-weight: 500;
}
.toast.error { border-color: var(--failed); }
@media (max-width: 880px) {
  .shell { padding: 18px; }
  .topbar { align-items: flex-start; }
  .runtime-strip { flex-wrap: wrap; justify-content: flex-end; }
  .summary-band { grid-template-columns: repeat(3, 1fr); }
  .summary-band > * { min-height: 68px; padding: 13px; }
  .summary-band time { align-items: flex-start; text-align: left; }
  .workbench { display: block; }
  .task-rail { padding-right: 0; border-right: 0; }
  .detail-pane { position: fixed; inset: auto 0 0; z-index: 8; max-height: 78vh; padding: 24px 20px; overflow: auto; border-top: 1px solid var(--accent); background: var(--ground); transform: translateY(105%); transition: transform .28s cubic-bezier(.22,1,.36,1); }
  .detail-pane.open { transform: none; }
  .detail-empty { display: none; }
  .detail-grid { grid-template-columns: repeat(2, 1fr); }
  .activity-list { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .brand-mark { width: 38px; }
  .runtime-strip .divider, #source-label { display: none; }
  .summary-band { grid-template-columns: repeat(2, 1fr); }
  .summary-lead { grid-column: span 2; }
  .summary-band time { grid-column: span 2; }
  .task-rail { padding-top: 22px; }
  .activity-list li { grid-template-columns: 72px 88px 1fr; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation: none !important; transition: none !important; } }
`;
;
