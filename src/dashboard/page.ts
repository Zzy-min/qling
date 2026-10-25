/**
 * Dashboard shell kept as a typed export for SDK/tests.
 * The production server serves the Vite-built index from dist/dashboard-web.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='8' fill='%234ade80'/%3E%3C/svg%3E">
  <title>轻灵 · 任务工作台 / Mission Control</title>
  <link rel="stylesheet" href="/assets/dashboard.css">
</head>
<body>
  <div id="root" aria-label="轻灵任务工作台"></div>
  <noscript>轻灵任务工作台需要启用 JavaScript。MISSION CONTROL · 最近会话</noscript>
  <script type="module" src="/assets/dashboard.js"></script>
</body>
</html>`;

/** @deprecated CSS is emitted by Vite; retained for source compatibility. */
export const DASHBOARD_CSS = "";
