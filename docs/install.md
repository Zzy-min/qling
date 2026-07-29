# 轻灵 Qling 安装指南

面向本机开发者与 Windows 用户。产品定位见 [README.md](../README.md)，英文说明见 [README.en.md](../README.en.md)。

## 先选择渠道

以下状态核验于 **2026-07-29**；此后应以链接页面显示的版本为准。

| 渠道 | 已核验版本/状态 | 建议 |
|---|---|---|
| [GitHub Release](https://github.com/Zzy-min/qling/releases/latest) | `v1.3.1`，已发布 Windows 便携 ZIP | 无需系统 Node 的最短路径之一 |
| **[WinGet](https://github.com/microsoft/winget-pkgs/tree/master/manifests/z/Zzy-min/qling)** | **`Zzy-min.qling` `1.3.1` 已进官方源**（[PR #402294](https://github.com/microsoft/winget-pkgs/pull/402294) 已合并） | Windows 推荐：`winget install --id Zzy-min.qling -e` |
| 源码 | `main` / `1.3.1` | 开发、贡献或需要完整测试工具链 |
| [npm](https://www.npmjs.com/package/@qlingzzy/qling) | **`1.3.1` 已发布** | 跨平台全局安装 |
| [公共 Scoop bucket](https://github.com/Zzy-min/scoop-qling) | **`1.3.1`** | Windows：`scoop bucket add qling https://github.com/Zzy-min/scoop-qling && scoop install qling` |
| [Scoop Extras PR #18307](https://github.com/ScoopInstaller/Extras/pull/18307) | 已关闭、未合并 | 尚未进入官方 Extras |

GitHub Release、WinGet、npm 与 Scoop 是独立发布面，不应假定它们版本相同。

## 环境要求

源码或 npm 安装需要：

| 依赖 | 版本 |
|---|---|
| Node.js | ≥ 18（推荐 20/22 LTS） |
| npm | ≥ 9 |
| Git | 源码安装、diff/commit 与隔离工作流需要 |
| Playwright Chromium | 可选，仅浏览器工具需要 |

Windows 便携 ZIP 内嵌 Node.js，不要求系统预装 Node。

## 方式 A：Windows 便携包（当前 Release）

1. 从 [v1.3.1 Release](https://github.com/Zzy-min/qling/releases/tag/v1.3.1) 下载 `qling-win-x64.zip`。
2. 解压后运行：

```powershell
.\qling-win-x64\qling.exe --version
.\qling-win-x64\qling.exe doctor
.\qling-win-x64\qling.exe setup
.\qling-win-x64\qling.exe
```

已发布资产：

```text
URL: https://github.com/Zzy-min/qling/releases/download/v1.3.1/qling-win-x64.zip
SHA256: 28cd2b71c935f49a2193b76486272559d48c111e8df052159f9b3dc8687f4d91
```

便携启动器已覆盖 WinGet 风格符号链接路径；缺少 API key 时会返回 `QLING_API_KEY_MISSING` 配置提示，而不是输出 JavaScript 堆栈。

## 方式 B：源码安装

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm run bootstrap
npm link
qling --version
```

需要浏览器抓取能力时：

```bash
npm run bootstrap -- --with-browser
```

`bootstrap` 会检查 Node/npm、安装依赖、构建项目、创建 `~/.qling/`，并给出 `doctor` / `setup` 下一步。默认不安装浏览器，也不自动开启 Dashboard、语义记忆或动态发现。

## 方式 C：npm 全局安装

作用域包名是 **`@qlingzzy/qling`**，安装后的 CLI 仍为 `qling`：

```bash
npm install -g @qlingzzy/qling --registry https://registry.npmjs.org/
qling --version
qling bootstrap
qling setup
```

确认 registry 当前版本：

```bash
npm view @qlingzzy/qling version --registry https://registry.npmjs.org/
```

从 GitHub 当前源码安装（不经过 npm registry）：

```bash
npm install -g github:Zzy-min/qling
```

`better-sqlite3` 是原生模块。如果 npm 没有适配当前 Node/平台的预编译包，Windows 可能需要 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)。便携 ZIP 不走这条本机编译路径。

## 方式 D：Scoop

### 公共 bucket

```powershell
scoop bucket add qling https://github.com/Zzy-min/scoop-qling
scoop info qling
```

公共 bucket 已同步到 **`1.3.1`**（与 GitHub Release 便携 ZIP 一致）：

```powershell
scoop bucket add qling https://github.com/Zzy-min/scoop-qling
scoop install qling
# 或已添加 bucket 时：
scoop update qling
qling --version
scoop info qling
```

### 从本仓库 manifest 安装（维护 / 离线）

```powershell
git clone https://github.com/Zzy-min/qling.git
cd qling
scoop install .\packaging\scoop\qling.json
qling --version
```

本仓库的 `packaging/scoop/qling.json` 与 `packaging/scoop-bucket/qling.json` 均为 `1.3.1`。同步到公共 bucket 前先在本仓校验：

```powershell
npm run validate:packaging
npm run sync:scoop-bucket
```

官方 Extras PR #18307 因收录门槛关闭，并非 manifest 语法已经进入官方目录。项目满足社区准入条件后再重新申请。

## 方式 E：WinGet（官方源已收录）

[PR #402294](https://github.com/microsoft/winget-pkgs/pull/402294) 已于 **2026-07-29** 合并。官方清单：

- 包 ID：`Zzy-min.qling`
- 版本：`1.3.1`
- 路径：[manifests/z/Zzy-min/qling/1.3.1](https://github.com/microsoft/winget-pkgs/tree/master/manifests/z/Zzy-min/qling/1.3.1)

### 从官方源安装

```powershell
winget source update
winget search Zzy-min.qling
winget show --id Zzy-min.qling
winget install --id Zzy-min.qling -e
qling --version
qling doctor
qling setup
```

升级 / 卸载：

```powershell
winget upgrade --id Zzy-min.qling -e
winget uninstall --id Zzy-min.qling
```

说明：

- 安装器为 GitHub Release 上的 Windows 便携 ZIP（内嵌 Node）。
- 便携启动器支持 WinGet 风格符号链接路径；缺少 API key 时返回 `QLING_API_KEY_MISSING`，不抛原始堆栈。
- 若 `winget search` 找不到包，先 `winget source update`，并确认 `winget source list` 中 `winget` 源可用。

### 本仓库镜像清单（维护 / 离线试装）

```text
packaging/winget/manifests/Zzy-min/qling/1.3.1/
  Zzy-min.qling.yaml
  Zzy-min.qling.locale.en-US.yaml
  Zzy-min.qling.installer.yaml
```

```powershell
winget validate --manifest packaging\winget\manifests\Zzy-min\qling\1.3.1
winget install --manifest packaging\winget\manifests\Zzy-min\qling\1.3.1
```

## 配置与密钥

```bash
qling setup
```

`setup` 保存 Provider、Model、Endpoint 等非敏感配置，不把 API key 写入 `.env`。推荐使用系统用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable('QLING_LLM_API_KEY', '<your-key>', 'User')
```

新开终端后验证：

```bash
qling doctor
qling run "列出当前目录"
```

本地模型：安装并启动 Ollama 后进入 TUI，执行 `/model use ollama`。

## 安装后验收

```bash
qling --version
qling --help
qling doctor
qling privacy
qling run "只读分析当前目录" --json
```

期望：

- `--version` 与所选分发渠道一致。
- `doctor` 没有 `fail`；未配置可选通道/本地模型时允许出现 `warn`。
- 已配置 Provider 或 Ollama 后，`run` 能输出结构化终态。
- 未配置密钥时应看到 `QLING_API_KEY_MISSING` 友好提示，不应出现原始堆栈。

## 卸载

```bash
# npm link
npm unlink -g qling

# npm 全局包
npm uninstall -g @qlingzzy/qling
```

```powershell
# Scoop
scoop uninstall qling

# WinGet（仅在实际安装后）
winget uninstall --id Zzy-min.qling
```

直接解压的便携包可删除解压目录。`~/.qling/` 保存会话、记忆和任务状态，卸载程序不会默认删除它；只有确认不再需要数据时才手动清理。

## 安全相关环境变量

| 变量 | 默认 | 含义 |
|---|---|---|
| `QLING_WRITE_SANDBOX` | `workspace` | `write` / `patch` 默认限制在工作区；`roots` 为兼容模式；`off` 关闭 |
| `QLING_ALLOW_SENSITIVE_WRITE` | 空 | 设为 `1` 才允许写 `.env` 等敏感目标 |
| `QLING_GUARD_NETWORK_MODE` | `strict` | `strict` 前缀白名单；`open` 允许 HTTP(S)；`deny` 全拒 |

可选容器隔离见 [docker.md](docker.md)。

## 维护者发布检查

```bash
npm run ci:check
npm run eval:recovery
npm run validate:packaging
npm run build:portable-win
git diff --check
```

发布顺序应是：构建并验证不可变 ZIP → 创建 GitHub Release → 校验公开资产摘要 → 更新 Scoop/WinGet 清单 → 分别更新各外部渠道。不得用源码版本推断 npm、Scoop 或 WinGet 已同步。
