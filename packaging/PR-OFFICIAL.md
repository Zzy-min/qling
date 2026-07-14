# 官方目录提交指南

## Scoop Extras

目标仓库：https://github.com/ScoopInstaller/Extras

### 本仓库已备好的 manifest

- 规范源：`packaging/scoop/qling.json`
- 本地 bucket：`packaging/scoop-bucket/qling.json`（内容同步）

### 提交步骤

```powershell
# 1) 构建便携包并同步 hash
npm run build:portable-win
npm run sync:winget-sha   # 同时更新 scoop hash（zip）

# 2) 上传 zip 到 GitHub Release（覆盖）
gh release upload v$(node -p "require('./package.json').version") dist-portable/qling-win-x64.zip --clobber

# 3) Fork + PR
gh repo fork ScoopInstaller/Extras --clone --fork-name scoop-extras-qling
cd ../scoop-extras-qling
git checkout -b add-qling
copy ..\qling\packaging\scoop\qling.json bucket\qling.json
git add bucket/qling.json
git commit -m "qling: add portable package"
git push -u origin HEAD
gh pr create --repo ScoopInstaller/Extras --title "qling: add portable AI agent CLI" --body "Adds Qling (local-first AI Agent CLI). Portable zip embeds Node runtime."
```

## winget-pkgs

目标仓库：https://github.com/microsoft/winget-pkgs

### 本仓库已备好多文件清单

```
packaging/winget/manifests/Zzy-min/qling/<version>/
  Zzy-min.qling.yaml
  Zzy-min.qling.locale.en-US.yaml
  Zzy-min.qling.installer.yaml
```

### 提交步骤

```powershell
npm run build:portable-win
npm run sync:winget-sha
gh release upload v1.2.0 dist-portable/qling-win-x64.zip --clobber

gh repo fork microsoft/winget-pkgs --clone --fork-name winget-pkgs-qling
# copy manifests tree under manifests/z/Zzy-min/qling/<version>/
# open PR against microsoft/winget-pkgs
```

本地校验（可选 winget 客户端）：

```powershell
winget validate packaging/winget/manifests/Zzy-min/qling/1.2.0
winget install --manifest packaging/winget/manifests/Zzy-min/qling/1.2.0
```
