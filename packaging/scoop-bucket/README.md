# Qling Scoop bucket

<!-- release-1.4.1-status -->
当前版本 / Current version: **1.4.1**。GitHub、npm、公共 Scoop 已同步；[WinGet 更新](https://github.com/microsoft/winget-pkgs/pull/471445)以官方 PR 审核状态为准。


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
