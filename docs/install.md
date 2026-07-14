# 轻灵 Qling 安装指南

面向本机开发者与 Windows 用户。更完整的产品说明见 [README.md](../README.md) / [README.en.md](../README.en.md)。

## 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | ≥ 18（推荐 20/22 LTS） |
| npm | ≥ 9 |
| Git | 可选，用于 diff/commit 与 isolation |
| Playwright Chromium | 可选，仅 `browser_fetch` |

## 方式 A：源码安装（当前推荐）

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm run bootstrap
```

带浏览器抓取：

```bash
npm run bootstrap -- --with-browser
```

全局命令：

```bash
npm link
qling --help
```

`bootstrap` 会：检查 Node/npm → 安装依赖 → 构建 → 创建 `~/.qling/` → 给出 `doctor`/`setup` 下一步。默认**不**安装浏览器、**不**自动开 dashboard。

## 方式 B：npm 全局安装

包名因 npm 相似度策略使用作用域 **`@qlingzzy/qling`**（安装后命令仍是 `qling`）：

```bash
npm install -g @qlingzzy/qling
qling --version
qling bootstrap
qling setup
```

从 GitHub 直接装：

```bash
npm install -g github:Zzy-min/qling
```

> 注意：`better-sqlite3` 为原生模块，需本机可编译环境；Windows 建议安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 或使用已预编译的 Node 版本。

## 方式 C：Windows PowerShell 快速路径

```powershell
# 1) 克隆与启动
git clone https://github.com/Zzy-min/qling.git
cd qling
npm run bootstrap

# 2) 全局 link
npm link

# 3) 配置（密钥写用户环境变量，不写 .env）
qling setup
[Environment]::SetEnvironmentVariable('QLING_LLM_API_KEY', '<your-key>', 'User')

# 4) 新开终端验证
qling doctor
qling
```

## 方式 D：Scoop 草案（未上架）

清单草稿：`packaging/scoop/qling.json`（版本与 `package.json` 对齐，当前 **1.1.0**）。

本地校验（不安装到官方 bucket）：

```powershell
npm run validate:packaging
# 检查 version / url 是否钉死到当前版本
Get-Content packaging/scoop/qling.json | ConvertFrom-Json | Select-Object version, url, hash
```

本地试用（需自建 bucket，并先把 `hash` 换成真实 tarball SHA256）：

```powershell
# 示例：私有 bucket 放好 manifest 后
scoop install qling
```

当前草案 URL 指向 npm tarball；`hash` 仍为占位。正式上架前请：

1. `npm pack` 或发布后下载 tarball  
2. 计算 SHA256 写入 `hash`  
3. 提交到自建/社区 Scoop bucket  

在 hash 未填前，**推荐**继续用 `npm install -g @qlingzzy/qling` 或源码 bootstrap。

## 方式 E：winget 草案（未上架）

清单草稿：`packaging/winget/Zzy-min.qling.yaml`（`PackageVersion` 与当前版本对齐）。

本地校验：

```powershell
npm run validate:packaging
Select-String -Path packaging/winget/Zzy-min.qling.yaml -Pattern 'PackageVersion|InstallerUrl|InstallerSha256'
```

正式提交需：

1. 稳定版本的安装包 URL（msi/zip 或 portable；当前示例为 GitHub Release zip）  
2. 真实 `InstallerSha256`（草案里为全零占位）  
3. 通过 [winget-pkgs](https://github.com/microsoft/winget-pkgs) 审核  

当前文件仅为**结构样例**，不可直接 `winget install`。发布 zip 前可先用 npm 全局安装路径。

## 配置与安全

| 项 | 建议 |
|----|------|
| API key | 系统用户环境变量 `QLING_LLM_API_KEY` |
| Provider 配置 | `qling setup` 写入 `~/.qling/.env`（无密钥） |
| 禁止 | 把密钥提交到 git / 同步网盘 |

本地模型（Ollama）：

```bash
# 安装并启动 Ollama 后
qling   # 进入 TUI
/model use ollama
```

## 验证安装

```bash
qling --help
qling doctor
qling run "列出当前目录"
```

期望：`doctor` 无 fail（warn 可接受）；`run` 在已配置密钥或 Ollama 时可完成一轮工具调用。

## 卸载

```bash
# npm link 安装
npm unlink -g qling

# npm 全局
npm uninstall -g qling

# 可选：删除本机状态（会丢失会话/记忆）
# Windows: Remove-Item -Recurse $env:USERPROFILE\.qling
# Unix:    rm -rf ~/.qling
```

## 安全相关环境变量（Phase 1.5）

| 变量 | 默认 | 含义 |
|------|------|------|
| `QLING_WRITE_SANDBOX` | `workspace` | write/patch 仅工作区；`roots` 兼容旧行为；`off` 关闭 |
| `QLING_ALLOW_SENSITIVE_WRITE` | 空 | 设为 `1` 才允许写 `.env` / 密钥文件 |
| `QLING_GUARD_NETWORK_MODE` | `strict` | `strict` 前缀白名单；`open` 允许 http/https；`deny` 全拒 |

可选容器运行见 [docker.md](docker.md) 与 `packaging/docker/`。

## 相关命令

| 命令 | 作用 |
|------|------|
| `qling bootstrap` | 本机初始化检查 |
| `qling setup` | Provider / Model 向导 |
| `qling doctor` | 诊断 |
| `qling privacy` | 数据边界 |
| `qling` | 进入流式 TUI |
