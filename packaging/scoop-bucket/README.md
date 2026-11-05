# Qling Scoop bucket

<!-- release-1.4.0-status -->
当前源码版本 / Source version: **1.4.0** (2026-11-05)。GitHub、npm、Scoop 独立发布；WinGet 1.4.0 须经官方 PR 审核后进入源。下文标注旧核验日期的渠道表保留历史状态，最新状态以各渠道页面为准。


## 公共安装（推荐）

```powershell
scoop bucket add qling https://github.com/Zzy-min/scoop-qling
scoop install qling
qling --version
```

公共仓库：https://github.com/Zzy-min/scoop-qling  
官方 Extras PR：https://github.com/ScoopInstaller/Extras/pull/18307

## 本地开发挂载

```powershell
scoop bucket add qling "$PWD\packaging\scoop-bucket"
scoop install qling/qling
```

## 清单

| 文件 | 说明 |
|------|------|
| `qling.json` | 与 `../scoop/qling.json` 同步 |

资产为 GitHub Release **portable zip**（内嵌 Node 运行时）。

## 发版后

1. `npm run build:portable-win && npm run sync:winget-sha`
2. 上传 zip 到 Release
3. 同步 `Zzy-min/scoop-qling` 的 `qling.json`
