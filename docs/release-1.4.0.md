# 1.4.0 发布验证记录

日期：2026-11-05。版本：`@qlingzzy/qling@1.4.0`。

## 本地验证

- TypeScript 和 Dashboard 生产构建通过。
- Dashboard：19/19 通过。
- 冒烟：78 项中 76 通过、2 跳过；全套首次运行的浏览器项因运行环境缺失失败，补齐后单独复测通过。测试同步为当前可访问性角色；桌面、平板、手机布局及开关详情通过，无浏览器控制台错误、无远程请求。
- 全量单元测试：1703 项，1702 通过、0 失败、1 跳过。
- 入口一致性：70 commands、77 help entries；依赖分层：0 条反向边。
- 本地 eval-smoke、tasks、anchored-edit、harness、context、memory、long-run、multi-agent 均完成。它们使用确定性 fixture、模拟时间或组件断言，不代表真实模型成功率或真实 24 小时稳定性。
- Windows 便携包：内嵌 Node v22.23.3，官方 SHASUMS 校验通过；启动器 `--version` 与 `doctor` 通过。
- Scoop / WinGet 清单与版本、Release URL、真实 ZIP SHA-256 一致。
- 发布前独立审查发现旧事件 checksum 兼容问题，已修复并通过旧表升级、两次重新打开的回归测试及复审。

## 升级及能力边界

- 调度器新增跨进程协调；升级后应重启旧版本 Qling 进程，混合版本并行运行不在验证范围内。
- 对不确定的运行中任务保留证据并阻塞，须通过显式 reconcile 处理；取消不证明远程副作用已经停止。
- 插件签名仍只覆盖清单，不覆盖完整目录载荷；插件替换的事务化尚未完成。
- 尚未补齐 SQLite busy、checkpoint/insert 失败、ACK 丢失的完整故障注入矩阵。
- 尚未实测真实模型双系统成功率、性能与长期稳定性。
- 仓库尚无 ESLint Hooks 静态检查；现有 TypeScript、组件测试和浏览器冒烟不能替代该检查。

GitHub Release、npm、公共 Scoop bucket 与 WinGet 官方收录为独立状态；以实际发布链接及官方 PR 状态为准。
