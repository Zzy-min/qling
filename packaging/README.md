# Packaging drafts

These files are **drafts** for future distribution. They are **not** published to Scoop / winget official catalogs yet.

| Path | Purpose |
|------|---------|
| `scoop/qling.json` | Scoop manifest sketch (needs real tarball hash) |
| `winget/Zzy-min.qling.yaml` | winget singleton sketch (needs release zip + SHA256) |
| `docker/` | Optional Dockerfile + compose for workspace isolation |

Current draft version: **1.1.0** (aligned with package.json).

## Recommended path today

1. `git clone` + `npm run bootstrap` + `npm link`
2. Or `npm install -g github:Zzy-min/qling`
3. After npm publish: `npm install -g @qlingzzy/qling` (CLI remains `qling`)

See [docs/install.md](../docs/install.md).

## Local validation (before publishing)

Scoop:

```powershell
# Schema-ish check: required keys present
Get-Content packaging/scoop/qling.json | ConvertFrom-Json | Select-Object version, url, hash
# After real hash is filled and a private bucket exists:
# scoop install .\packaging\scoop\qling.json
```

winget:

```powershell
# YAML structure review only until InstallerSha256 is real
Get-Content packaging/winget/Zzy-min.qling.yaml
# Official submit path: fork microsoft/winget-pkgs → PR
```

npm (after `npm login`):

```bash
npm publish --access public
npm view @qlingzzy/qling version
```
