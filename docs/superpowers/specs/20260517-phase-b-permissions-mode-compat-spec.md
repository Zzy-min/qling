# `qling` 阶段 B：`permissions.mode` 兼容映射规格（2026-05-17）

## 背景

- 重做计划要求新增 `permissions.mode` 配置项。
- 当前实现实际生效项是 `guard.permissions.default`，与目标契约不一致。

## 目标

建立兼容映射，保证两套入口语义一致：

- 文件配置：`permissions.mode` -> `guard.permissions.default`
- 环境变量：`QLING_PERMISSIONS_MODE` -> `QLING_GUARD_PERMISSIONS_DEFAULT`

## 范围

- 仅做兼容映射与导出同步，不改现有权限矩阵规则语义。
- 允许 `allow|deny|ask`，其余值忽略并回退默认值。

## 验收

- 配置文件包含 `permissions.mode` 时，加载后 `guard.permissions.default` 正确。
- 仅设置 `QLING_PERMISSIONS_MODE` 时，`guard.permissions.default` 正确。
- `applyConfigToProcessEnv` 同步导出两个环境变量。
