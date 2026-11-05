# 1.4.1 发布记录

2026-11-05，最终分发版本为 **1.4.1**。1.4.0 已发布 npm，后续 Linux CI 暴露规则文件大小写去重缺陷，因此以 1.4.1 修正；不覆盖已发布的 npm 版本或 Git tag。

## 分发状态

| 渠道 | 状态与证据 |
|---|---|
| GitHub | [v1.4.1](https://github.com/Zzy-min/qling/releases/tag/v1.4.1)，Windows ZIP、npm TGZ、SHA256SUMS 和构建元数据已发布 |
| npm | [`@qlingzzy/qling@1.4.1`](https://www.npmjs.com/package/@qlingzzy/qling/v/1.4.1)，`latest=1.4.1` |
| Scoop | [公共 bucket 提交 bbcd0f6](https://github.com/Zzy-min/scoop-qling/commit/bbcd0f6)，版本、URL、SHA-256 已同步 |
| WinGet | [官方 PR #471445](https://github.com/microsoft/winget-pkgs/pull/471445) 已提交，须待维护者及验证流程接受后才进入官方源；本机 `winget validate` 成功 |

Windows ZIP SHA-256：`db2fd9e43f2d1595aa8e83cc7c3468b302fde701c3883d1e6b5d9dc0c9060654`。内嵌 Node v22.23.3。

## 验证

- 本地 TypeScript / Dashboard 构建通过；Dashboard 19/19。
- 本地完整单元测试：1704 项，1702 通过、0 失败、2 跳过；跳过包括不区分大小写卷上的专用大小写用例。
- 本地完整冒烟：78 项，76 通过、0 失败、2 跳过。
- Linux 全门禁、Windows 单元测试：[CI 42032972814](https://github.com/Zzy-min/qling/actions/runs/42032972814) 均成功，包含实际 Linux 大小写文件回归测试。
- [Windows 构建 42032559271](https://github.com/Zzy-min/qling/actions/runs/42032559271) 成功；内嵌 Node、生产依赖及原生启动器通过版本和 doctor 检查。
- 发布端 ZIP digest 与构建元数据、本地 Scoop/WinGet 清单一致。
- MCP、调度与事件日志升级修复经独立代码复审；实际浏览器已验证桌面、平板、手机详情开关和无横向溢出。

## 保留边界

- 升级后停止旧版本 Qling 进程；混合版本并发不在验证范围内。
- 取消不证明远程副作用已停止；不确定任务须显式 reconcile。
- 插件载荷签名、事务替换、完整 SQLite 故障注入矩阵仍未完成。
- 真实模型对照、长期实际运行和性能尚未实测；确定性评测不等于这些能力的证明。
- 原本地归档、历史评测 JSON 保留且未纳入源码发布。
