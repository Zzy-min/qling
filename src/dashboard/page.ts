export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <title>轻灵 · 任务工作台</title>
  <link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark" aria-hidden="true">QL</span>
        <div><p class="eyebrow">LOCAL AGENT CONTROL</p><h1>轻灵任务工作台</h1></div>
      </div>
      <div class="runtime-strip" aria-live="polite">
        <span class="signal" id="runtime-signal"></span>
        <span id="runtime-label">正在连接本地运行时</span>
        <span class="divider"></span>
        <span id="source-label">LOCAL</span>
        <button class="icon-button" id="refresh-button" type="button">刷新</button>
      </div>
    </header>

    <section class="summary-band" aria-label="任务摘要">
      <div class="summary-lead"><span>当前态势</span><strong id="summary-total">—</strong></div>
      <div class="summary-item"><span>运行</span><strong id="summary-running">—</strong></div>
      <div class="summary-item"><span>等待</span><strong id="summary-queued">—</strong></div>
      <div class="summary-item"><span>阻塞</span><strong id="summary-blocked">—</strong></div>
      <div class="summary-item"><span>失败</span><strong id="summary-failed">—</strong></div>
      <time id="updated-at">尚未同步</time>
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
          <p>查看执行来源、进度、日志和当前可用操作。</p>
        </div>
        <div class="detail-content" id="detail-content" hidden></div>
      </aside>
    </main>

    <section class="activity-panel" aria-labelledby="activity-heading">
      <div class="section-heading"><div><p class="eyebrow">RECENT SIGNALS</p><h2 id="activity-heading">最近活动</h2></div><span id="activity-boundary">最多 20 条</span></div>
      <ol id="activity-list" class="activity-list"><li class="muted">等待本地指标…</li></ol>
    </section>

    <footer class="boundary-bar">
      <span>仅监听 127.0.0.1</span><span>任务正文不外传</span><span id="permission-label">权限 —</span>
    </footer>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;

export const DASHBOARD_CSS = `
:root {
  --ink: #dce8e2; --muted: #81928b; --dim: #53635d;
  --ground: #0b100e; --surface: #111815; --raised: #17201c;
  --line: #28372f; --line-strong: #3b5046; --accent: #63d5a2;
  --running: #63d5a2; --queued: #d6b865; --blocked: #df9665;
  --failed: #e27676; --paused: #8ca7d8; --radius: 3px;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; color: var(--ink); background: var(--ground); font-family: "Aptos", "Microsoft YaHei UI", sans-serif; }
body::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .25; background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 48px 48px; mask-image: linear-gradient(to bottom, black, transparent 72%); }
button, input { font: inherit; }
button { color: inherit; }
.shell { position: relative; width: min(1540px, 100%); margin: 0 auto; padding: clamp(18px, 3vw, 42px); }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line-strong); }
.brand-block { display: flex; align-items: center; gap: 14px; }
.brand-mark { display: grid; place-items: center; width: 44px; aspect-ratio: 1; border: 1px solid var(--accent); color: var(--accent); font: 700 13px/1 "Cascadia Code", monospace; letter-spacing: .12em; transform: rotate(-3deg); }
.eyebrow { margin: 0 0 4px; color: var(--accent); font: 600 10px/1.2 "Cascadia Code", monospace; letter-spacing: .2em; }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: clamp(22px, 3vw, 34px); font-weight: 650; letter-spacing: -.04em; }
h2 { margin-bottom: 0; font-size: 18px; font-weight: 620; }
.runtime-strip { display: flex; align-items: center; gap: 10px; color: var(--muted); font: 12px "Cascadia Code", monospace; }
.signal { width: 8px; height: 8px; border-radius: 50%; background: var(--queued); box-shadow: 0 0 0 4px color-mix(in srgb, var(--queued) 14%, transparent); }
.signal.ready { background: var(--running); box-shadow: 0 0 0 4px color-mix(in srgb, var(--running) 14%, transparent); }
.divider { width: 1px; height: 18px; background: var(--line-strong); }
.icon-button, .filter, .action-button { border: 1px solid var(--line-strong); border-radius: var(--radius); background: transparent; cursor: pointer; transition: border-color .18s ease, background .18s ease, transform .18s ease; }
.icon-button { padding: 7px 11px; }
.icon-button:hover, .filter:hover, .action-button:hover { border-color: var(--accent); }
.icon-button:active, .action-button:active { transform: translateY(1px); }
button:focus-visible, input:focus-visible, .task-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.summary-band { display: grid; grid-template-columns: minmax(180px, 1.3fr) repeat(4, minmax(90px, .55fr)) minmax(170px, 1fr); border-bottom: 1px solid var(--line); }
.summary-band > * { min-height: 88px; padding: 20px 18px; border-right: 1px solid var(--line); display: flex; flex-direction: column; justify-content: center; }
.summary-band > *:last-child { border-right: 0; }
.summary-band span, .summary-band time { color: var(--muted); font: 11px "Cascadia Code", monospace; }
.summary-band strong { margin-top: 5px; font: 650 26px "Cascadia Code", monospace; }
.summary-lead { background: var(--accent); color: #092016; }
.summary-lead span { color: #244d3b; }
.summary-band time { align-items: flex-end; text-align: right; }
.workbench { display: grid; grid-template-columns: minmax(360px, .9fr) minmax(500px, 1.35fr); min-height: 560px; border-bottom: 1px solid var(--line-strong); }
.task-rail { padding: 28px 26px 28px 0; border-right: 1px solid var(--line-strong); }
.detail-pane { position: relative; padding: 32px 0 32px 34px; min-width: 0; }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.section-heading > span { color: var(--muted); font: 11px "Cascadia Code", monospace; }
.search-box { height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 1px solid var(--line-strong); background: var(--surface); }
.search-box span { color: var(--accent); font-size: 20px; }
.search-box input { width: 100%; border: 0; outline: 0; color: var(--ink); background: transparent; }
.search-box input::placeholder { color: var(--dim); }
.filter-row { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
.filter { padding: 6px 10px; color: var(--muted); font-size: 11px; }
.filter.active { color: #092016; border-color: var(--accent); background: var(--accent); }
.task-list { display: grid; gap: 1px; margin-top: 18px; background: var(--line); border: 1px solid var(--line); max-height: 620px; overflow: auto; }
.task-row { position: relative; display: grid; grid-template-columns: 7px 1fr auto; gap: 13px; width: 100%; padding: 16px 14px 15px 0; border: 0; text-align: left; background: var(--surface); cursor: pointer; }
.task-row:hover, .task-row.selected { background: var(--raised); }
.task-row.selected::after { content: ""; position: absolute; inset: 0; border: 1px solid var(--accent); pointer-events: none; }
.status-line { width: 3px; height: 100%; justify-self: center; background: var(--dim); }
.status-line.running { background: var(--running); } .status-line.queued { background: var(--queued); } .status-line.blocked { background: var(--blocked); } .status-line.failed { background: var(--failed); } .status-line.paused { background: var(--paused); }
.task-copy { min-width: 0; }
.task-meta { display: flex; gap: 8px; margin-bottom: 7px; color: var(--muted); font: 10px "Cascadia Code", monospace; text-transform: uppercase; letter-spacing: .08em; }
.task-title { display: block; margin-bottom: 6px; overflow: hidden; color: var(--ink); font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
.task-description { display: block; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.task-time { color: var(--dim); font: 10px "Cascadia Code", monospace; white-space: nowrap; }
.detail-empty { min-height: 420px; display: grid; place-content: center; justify-items: center; text-align: center; color: var(--muted); }
.detail-empty p { max-width: 300px; margin-top: 10px; line-height: 1.6; }
.crosshair { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 20px; border: 1px dashed var(--line-strong); color: var(--accent); font: 28px "Cascadia Code", monospace; }
.detail-content { position: relative; animation: reveal .28s cubic-bezier(.22,1,.36,1); }
.detail-close { position: absolute; top: 0; right: 0; }
@keyframes reveal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.detail-kicker { color: var(--accent); font: 11px "Cascadia Code", monospace; text-transform: uppercase; letter-spacing: .12em; }
.detail-title { max-width: 760px; margin: 10px 0 14px; font-size: clamp(25px, 3vw, 40px); line-height: 1.05; letter-spacing: -.04em; }
.detail-description { max-width: 760px; color: var(--muted); line-height: 1.7; }
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); margin: 28px 0; border-block: 1px solid var(--line); }
.detail-stat { padding: 16px 12px 16px 0; }
.detail-stat span { display: block; color: var(--dim); font: 10px "Cascadia Code", monospace; text-transform: uppercase; }
.detail-stat strong { display: block; margin-top: 7px; font: 600 14px "Cascadia Code", monospace; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
.action-button { padding: 9px 14px; }
.action-button.primary { color: #092016; border-color: var(--accent); background: var(--accent); }
.action-button.danger { color: var(--failed); border-color: color-mix(in srgb, var(--failed) 65%, var(--line)); }
.event-log { display: grid; gap: 0; padding: 0; list-style: none; border-top: 1px solid var(--line); }
.event-log li { display: grid; grid-template-columns: 90px 1fr; gap: 14px; padding: 11px 0; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.event-log time { color: var(--dim); font: 10px "Cascadia Code", monospace; }
.activity-panel { padding: 28px 0; }
.activity-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 28px; padding: 0; list-style: none; }
.activity-list li { display: grid; grid-template-columns: 88px 110px 1fr; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.activity-list time, .activity-type { color: var(--dim); font: 10px "Cascadia Code", monospace; }
.boundary-bar { display: flex; flex-wrap: wrap; gap: 8px 24px; padding-top: 18px; border-top: 1px solid var(--line-strong); color: var(--dim); font: 10px "Cascadia Code", monospace; text-transform: uppercase; letter-spacing: .08em; }
.boundary-bar span::before { content: "□"; margin-right: 7px; color: var(--accent); }
.skeleton-stack { background: transparent; border: 0; }
.skeleton { height: 78px; margin-bottom: 1px; background: linear-gradient(90deg, var(--surface), var(--raised), var(--surface)); background-size: 200% 100%; animation: scan 1.4s linear infinite; }
@keyframes scan { to { background-position: -200% 0; } }
.muted, .empty-copy { color: var(--muted); }
.empty-copy { padding: 34px 20px; text-align: center; background: var(--surface); }
.error-copy { color: var(--failed); }
.toast { position: fixed; right: 24px; bottom: 24px; z-index: 10; max-width: min(420px, calc(100vw - 32px)); padding: 13px 16px; border: 1px solid var(--line-strong); background: var(--raised); box-shadow: 0 16px 50px #0008; font-size: 13px; }
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
