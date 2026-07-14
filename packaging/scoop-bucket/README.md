# Qling Scoop bucket（自建 / 本地）

本目录是 **可直接 `scoop bucket add` 的自建 bucket**，不是官方 `main`/`extras`。

## 一键本地挂载

在仓库根目录：

```powershell
# 添加 bucket（路径按本机仓库位置调整）
scoop bucket add qling "$PWD\packaging\scoop-bucket"

# 安装
scoop install qling/qling

# 升级（发新版后先更新 bucket 内 manifest）
scoop update qling
```

卸载：

```powershell
scoop uninstall qling
scoop bucket rm qling
```

## 清单

| 文件 | 说明 |
|------|------|
| `qling.json` | 与 `../scoop/qling.json` 同步的可安装 manifest |

发版后请：

1. 对齐 `version` / `url` / `hash`（npm tarball SHA256）
2. 在本机验证：`scoop install qling/qling`
3. 可选：将本 bucket 推到独立 GitHub 仓库供他人 `scoop bucket add`

## 诚实边界

- npm 包含 `better-sqlite3` 原生模块；若 tarball 解压后缺少可用二进制，`post_install` 会引导：

  `npm install -g @qlingzzy/qling@<ver> --registry https://registry.npmjs.org/`

- 官方 Scoop 目录尚未提交 PR。
