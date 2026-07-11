# 轻灵本地任务工作台性能与信息架构升级 Spec

**日期**: 2026-07-11
**状态**: Accepted

## 1. 问题

当前 Dashboard 将 HTML、CSS 和浏览器脚本内嵌在服务端文件中，浏览器脚本含非法 TypeScript 注解，导致页面解析失败并停留在“加载中”。首屏并发请求六个接口，指标查询读取完整 JSONL，Mission 字段映射错误且没有统一展示 loop task/workflow，任务状态与控制来源不清晰。

## 2. 目标行为

- 首屏通过 `GET /api/dashboard/snapshot` 一次获得状态、统一任务、权限、daemon 来源和最近活动。
- 统一任务覆盖 `mission | loop | workflow`，活跃状态优先，其余按更新时间倒序。
- 首屏最多 50 个任务、20 条指标、200 KiB；详情和日志按需加载。
- 指标最近查询包含内存 buffer，最多扫描 1 MiB 磁盘数据，并按最新时间倒序。
- 客户端前台每 3 秒刷新，后台暂停；请求不重叠，失败指数退避，支持 ETag/304。
- Mission 支持按状态返回 pause/resume/cancel/retry；retry 仅 daemon 健康时可用。Loop 仅 cancel，workflow 只读。
- Daemon 离线时 pause/resume/cancel 可更新本地状态，并在响应中明确 `source=local`；不得伪装 daemon 执行。
- Dashboard 默认只监听 `127.0.0.1`，仅同源访问，使用 CSP 和安全响应头。

## 3. 视觉与交互

- 目标用户是使用轻灵执行本地开发任务的中文终端用户；核心工作是快速判断“正在做什么、卡在哪里、下一步能做什么”。
- 视觉采用工业化、克制的深色任务工作台；青绿色只用于主强调，状态色只表达执行结果。
- 页面由顶部运行带、任务摘要、任务轨道、详情侧栏、最近活动和本地边界组成，禁止重复卡片墙。
- 桌面端任务列表与详情并排；窄屏详情成为底部面板。任务支持搜索、类型和状态筛选。
- 用户内容使用 DOM `textContent` 渲染；按钮有 loading/disabled/focus 状态，反馈使用 toast，不使用 `alert()`。

## 4. 接口

- `DashboardTask`: id/kind/title/description/status/rawStatus/source/timestamps/progress/error/actions。
- `DashboardSnapshot`: generatedAt/revision/runtime/summary/tasks/activity/boundary。
- `DashboardTaskDetail`: task/detail/events。
- `DashboardControlResult`: ok/source/task/message。
- 新增 `GET /api/dashboard/snapshot`、`GET /api/tasks/:kind/:id`、`POST /api/tasks/:kind/:id/:action`。
- 保留现有 status/missions/metrics/sessions/permissions/doctor 接口。

## 5. 非目标

- 不引入前端框架、CDN、远程字体、SSE、任务创建表单或局域网监听。
- 不重写 daemon 协议；不为 workflow 增加控制语义。
- 不自动发布 npm 或创建 release/tag。

## 6. 验收

- 浏览器客户端可被 TypeScript 编译，首屏不残留“加载中”。
- 1000 个任务和 10 MiB 指标夹具下，快照响应低于 500ms、磁盘扫描不超过 1 MiB、响应低于 200 KiB。
- Playwright 在 1440x900 和 390x844 验证任务筛选、详情、控制反馈、焦点和响应式布局。
- `npm run ci:check`、依赖审计和 `git diff --check` 通过。
