# 轻灵本地任务工作台实施计划

**Spec**: `docs/superpowers/specs/20260711-dashboard-task-workbench-spec.md`

## Task 1: RED 基线

- 新增 MetricsCollector 最近查询测试：buffer、倒序、limit、1 MiB 扫描上限。
- 新增 Dashboard view-model 测试：三类任务、状态映射、活跃优先、动作矩阵、字段截断。
- 新增 Dashboard API 集成测试：单快照、ETag/304、详情、控制、404、安全响应头和 loopback bind。
- 新增浏览器客户端测试，证明当前内嵌脚本解析失败且新客户端必须可编译。

## Task 2: 数据与 API

- 实现 `queryRecent()`，以最新 buffer + 文件尾块返回有界结果。
- 实现统一 Dashboard 类型和纯 view-model formatter。
- MissionManager 增加安全刷新入口，读取 daemon 共用状态目录的最新快照。
- 增加聚合 snapshot、详情和控制路由；旧接口保持兼容。
- 快照缓存 750ms，稳定 payload hash 作为 ETag；未知 API 返回 JSON 404。

## Task 3: 安全控制

- 后台健康状态异步缓存，不阻塞首屏。
- Mission 控制优先 daemon；离线时 pause/resume/cancel 本地降级，retry 返回 503。
- Loop task 只允许 cancel；workflow 控制返回 405。
- 监听地址固定 `127.0.0.1`，移除 wildcard CORS，添加 CSP、nosniff、frame deny 和 no-referrer。

## Task 4: 前端工作台

- 将浏览器代码拆为可 TypeScript 检查的 `src/dashboard/client.ts`，服务端提供编译后的 module。
- 将 HTML/CSS 拆出 dashboard 页面模块，使用离线字体栈和 CSS variables。
- 实现任务摘要、搜索/筛选、任务轨道、详情侧栏/移动底部面板、活动流、toast 和 skeleton。
- 首次单请求；3 秒可见态刷新，隐藏暂停，AbortController 防重叠，错误退避。

## Task 5: 验证

- 运行 Dashboard/metrics 目标单测和集成测试。
- 运行真实 Playwright 流程并检查 1440x900、390x844 截图。
- 运行 build、`npm run ci:check`、`npm audit --audit-level=high`、旧名称扫描和 `git diff --check`。
- 在 `docs/superpowers/reviews/` 记录性能、视觉与剩余边界。
