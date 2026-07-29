# Packaging

| Path | Purpose |
|------|---------|
| `scoop/qling.json` | Canonical Scoop manifest (npm tarball + SHA256) |
| `scoop-bucket/` | Local/self-hosted Scoop bucket (`scoop bucket add`) |
| `winget/Zzy-min.qling.yaml` | winget singleton (portable zip URL + SHA256) |
| `docker/` | Optional Dockerfile + compose for workspace isolation |

## Recommended path today

1. **Windows**: `winget install --id Zzy-min.qling -e` (official source; package `1.3.1`)
2. Or GitHub Release portable ZIP (`qling-win-x64.zip`)
3. Or `npm install -g @qlingzzy/qling --registry https://registry.npmjs.org/`
4. Or `git clone` + `npm run bootstrap` + `npm link`
5. Or Scoop local bucket: `scoop bucket add qling path\to\packaging\scoop-bucket`

See [docs/install.md](../docs/install.md).

## Status

| Artifact | Status |
|----------|--------|
| npm `@qlingzzy/qling` | **`1.3.1` on npmjs.org** |
| Scoop hash | Filled for in-repo `1.3.1` manifests |
| Scoop self-bucket | `packaging/scoop-bucket` usable locally |
| Scoop public bucket `Zzy-min/scoop-qling` | **`1.3.1` synced** |
| Scoop official Extras | Not merged |
| winget portable zip | On GitHub Release `v1.3.1` |
| **winget-pkgs** | **[PR #402294](https://github.com/microsoft/winget-pkgs/pull/402294) merged** — ID `Zzy-min.qling` `1.3.1` |

## Scripts

```bash
npm run validate:packaging
npm run sync:scoop-bucket
npm run build:portable-win
```

## Scoop local install

```powershell
scoop bucket add qling "$PWD\packaging\scoop-bucket"
scoop install qling/qling
```

## winget / portable

```powershell
npm run build:portable-win
# upload dist-portable/qling-win-x64.zip to the GitHub release
# copy sha256 into packaging/winget/Zzy-min.qling.yaml
```

## npm publish (maintainer)

```bash
npm whoami --registry https://registry.npmjs.org/
npm publish --access public --registry https://registry.npmjs.org/
```
