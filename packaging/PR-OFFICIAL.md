# Qling 分发与官方目录提交指南

## 当前状态

核验时间：**2026-07-29**。后续状态以各链接页面为准。

| 渠道 | 已核验状态 |
|---|---|
| GitHub Release | [`v1.3.1`](https://github.com/Zzy-min/qling/releases/tag/v1.3.1)，便携 ZIP 已上传 |
| 便携 ZIP | `qling-win-x64.zip`，SHA256 `28cd2b71c935f49a2193b76486272559d48c111e8df052159f9b3dc8687f4d91` |
| **WinGet** | **[PR #402294](https://github.com/microsoft/winget-pkgs/pull/402294) 已合并**；官方包 ID `Zzy-min.qling` `1.3.1` 位于 [winget-pkgs tree](https://github.com/microsoft/winget-pkgs/tree/master/manifests/z/Zzy-min/qling/1.3.1) |
| npm | **`@qlingzzy/qling@1.3.1` 已发布** |
| 公共 Scoop bucket | [`Zzy-min/scoop-qling`](https://github.com/Zzy-min/scoop-qling) **已同步 `1.3.1`** |
| Scoop Extras | [PR #18307](https://github.com/ScoopInstaller/Extras/pull/18307) 已关闭、未合并；维护者建议自建 bucket |

Windows 用户推荐安装：

```powershell
winget source update
winget install --id Zzy-min.qling -e
```

## 本仓库的规范源

| 目标 | 文件 |
|---|---|
| Scoop | `packaging/scoop/qling.json` |
| Scoop bucket 镜像 | `packaging/scoop-bucket/qling.json` |
| WinGet singleton 校验面 | `packaging/winget/Zzy-min.qling.yaml` |
| WinGet 多文件清单 | `packaging/winget/manifests/Zzy-min/qling/1.3.1/` |

当前四个本地声明面均使用 `1.3.1`、同一 Release URL 和同一 SHA256。公共 `scoop-qling` 是另一个 Git 仓库，只有提交并推送后才算完成同步。

## 发布顺序

1. 更新 `package.json` / lockfile / CHANGELOG 与文档。
2. 运行完整 CI 和恢复、打包门禁。
3. 构建 Windows 便携 ZIP并执行真实 `--version`、`doctor`、符号链接启动检查。
4. 创建不可变 GitHub Release，上传 ZIP。
5. 从公开资产重新核验大小与 SHA256。
6. 更新本仓库 Scoop/WinGet 清单。
7. 更新并推送公共 Scoop bucket（若仍落后）。
8. **新版本** 再向 `microsoft/winget-pkgs` 提交更新 PR；合并前不得写成「官方源已是新版本」。
9. 合并后更新本文件与 `docs/install.md` / README 分发状态表。

## 构建与本地门禁

```powershell
npm run ci:check
npm run eval:recovery
npm run build:portable-win
npm run validate:packaging
git diff --check
```

构建结果：

```text
dist-portable/qling-win-x64.zip
dist-portable/portable-meta.json
```

## Scoop

同步本仓库两份 manifest：

```powershell
npm run sync:scoop-bucket
npm run validate:packaging
```

更新外部公共 bucket 时，还必须在 `Zzy-min/scoop-qling` 仓库提交并推送新的 `qling.json`。只修改本仓库 `packaging/scoop-bucket/qling.json` 不会改变用户实际安装到的版本。

官方 Extras PR #18307 的失败点是收录门槛，不应描述为 manifest 已进入官方目录。项目满足社区准入条件后再重开申请。

## WinGet

当前多文件清单：

```text
packaging/winget/manifests/Zzy-min/qling/1.3.1/
  Zzy-min.qling.yaml
  Zzy-min.qling.locale.en-US.yaml
  Zzy-min.qling.installer.yaml
```

本地校验：

```powershell
winget validate --manifest packaging\winget\manifests\Zzy-min\qling\1.3.1
```

可选本地试装：

```powershell
winget install --manifest packaging\winget\manifests\Zzy-min\qling\1.3.1
qling --version
qling doctor
```

PR 更新后至少确认：

- PR 标题、正文、三个 changed files 都指向同一版本。
- `InstallerUrl` 能公开下载。
- `InstallerSha256` 与公开资产 digest 一致。
- `NestedInstallerFiles.RelativeFilePath` 指向 `qling-win-x64\qling.exe`。
- 通过 WinGet Links 符号链接启动时能找到内嵌 runtime。
- 缺少 API key 时友好退出，无 JavaScript 堆栈。
- CLA、自动验证、人工审核分别报告，不能混为一个“通过”。

## npm

身份、查看和发布必须显式使用官方 registry，避免本机镜像导致错误结论：

```bash
npm whoami --registry https://registry.npmjs.org/
npm view @qlingzzy/qling version --registry https://registry.npmjs.org/
npm publish --access public --registry https://registry.npmjs.org/
```

发布成功后重新执行 `npm view`；本地 `package.json` 的版本不等于 npm 已发布版本。
