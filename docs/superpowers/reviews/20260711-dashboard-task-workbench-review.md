# 轻灵本地任务工作台实施评审

## Scope

- 将旧单文件 Dashboard 重构为统一任务工作台。
- 聚合 Mission、session loop task 与当前 Workflow。
- 增加任务详情、安全控制、快照缓存、有界指标读取与响应式客户端。

## Correctness And Boundaries

- 首屏只请求 `GET /api/dashboard/snapshot`；任务详情和日志按需加载。
- 快照最多返回 50 个任务、20 条活动；任务汇总最多扫描 5000 个本地 loop task。
- Mission 每次快照从共享状态目录刷新，外部 daemon 写入可在缓存窗口后观察到。
- daemon 离线时仅允许安全的本地 pause/resume/cancel；retry 失败关闭，不创建无执行器任务。
- 浏览器生成节点统一使用 `textContent`/DOM API，不渲染用户提供的原始 HTML。
- 服务仅监听 `127.0.0.1`，使用同源检查、CSP、nosniff、DENY frame 和 JSON API 404。

## Verification

- Dashboard 目标测试覆盖快照、ETag/304、统一排序、详情、控制、兼容接口与响应式抽屉。
- 10 MiB metrics 夹具的倒序扫描不超过 1 MiB。
- 1000 个 loop task 夹具的快照少于 500ms、负载少于 200 KiB，并只返回前 50 条。
- Playwright 已验证 `1440x900` 和 `390x844`：首屏无残留加载文案，任务主轴、筛选、详情面板和长中文正常。

完整仓库门禁结果以本轮最终验证输出为准。
