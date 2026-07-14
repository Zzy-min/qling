# Packaging

| Path | Purpose |
|------|---------|
| `scoop/qling.json` | Canonical Scoop manifest (npm tarball + SHA256) |
| `scoop-bucket/` | Local/self-hosted Scoop bucket (`scoop bucket add`) |
| `winget/Zzy-min.qling.yaml` | winget singleton (portable zip URL + SHA256) |
| `docker/` | Optional Dockerfile + compose for workspace isolation |

## Recommended path today

1. `npm install -g @qlingzzy/qling --registry https://registry.npmjs.org/`
2. Or `git clone` + `npm run bootstrap` + `npm link`
3. Or Scoop local bucket: `scoop bucket add qling path\to\packaging\scoop-bucket`

See [docs/install.md](../docs/install.md).

## Status

| Artifact | Status |
|----------|--------|
| npm `@qlingzzy/qling` | Published (see package.json version) |
| Scoop hash | Filled for current version |
| Scoop self-bucket | `packaging/scoop-bucket` usable locally |
| Scoop official catalog | Not submitted |
| winget portable zip | Built via `npm run build:portable-win`; attach to GitHub Release |
| winget-pkgs PR | Not submitted |

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
