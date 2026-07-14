# Packaging drafts

These files are **drafts** for future distribution. They are **not** published to Scoop / winget official catalogs yet.

| Path | Purpose |
|------|---------|
| `scoop/qling.json` | Scoop manifest sketch (needs real tarball hash) |
| `winget/Zzy-min.qling.yaml` | winget singleton sketch (needs release zip + SHA256) |
| `docker/` | Optional Dockerfile + compose for workspace isolation |

Current draft version: **1.1.1** (aligned with package.json).

## Recommended path today

1. `npm install -g @qlingzzy/qling --registry https://registry.npmjs.org/`
2. Or `git clone` + `npm run bootstrap` + `npm link`
3. Or `npm install -g github:Zzy-min/qling`

See [docs/install.md](../docs/install.md).

## Status (1.1.1)

| Artifact | Status |
|----------|--------|
| npm `@qlingzzy/qling@1.1.1` | Published on registry.npmjs.org |
| Scoop `hash` | Filled (SHA256 of npm tarball) |
| Scoop official bucket | Not submitted |
| winget `InstallerSha256` | Still placeholder (needs zip/msi) |

## Local validation

```bash
npm run validate:packaging
```

Scoop:

```powershell
Get-Content packaging/scoop/qling.json | ConvertFrom-Json | Select-Object version, url, hash
# Private bucket only until community PR lands:
# scoop install qling
```

winget:

```powershell
Get-Content packaging/winget/Zzy-min.qling.yaml
# Submit via fork of microsoft/winget-pkgs after real installer assets exist
```

npm publish (maintainer; force official registry if default is a mirror):

```bash
npm whoami --registry https://registry.npmjs.org/
npm publish --access public --registry https://registry.npmjs.org/
npm view @qlingzzy/qling version --registry https://registry.npmjs.org/
```

Refresh Scoop hash after a new npm version:

```powershell
$v = "1.1.1"
$url = "https://registry.npmjs.org/@qlingzzy/qling/-/qling-$v.tgz"
$out = "$env:TEMP\qling-$v.tgz"
Invoke-WebRequest $url -OutFile $out
(Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
```
