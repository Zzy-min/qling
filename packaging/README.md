# Packaging drafts

These files are **drafts** for future distribution. They are **not** published to Scoop / winget official catalogs yet.

| Path | Purpose |
|------|---------|
| `scoop/qling.json` | Scoop manifest sketch (needs real tarball hash) |
| `winget/Zzy-min.qling.yaml` | winget singleton sketch (needs release zip + SHA256) |
| `docker/` | Optional Dockerfile + compose for workspace isolation |

## Recommended path today

1. `git clone` + `npm run bootstrap` + `npm link`  
2. Or `npm install -g github:Zzy-min/qling`  
3. After npm publish: `npm install -g @qlingzzy/qling` (CLI remains `qling`)

See [docs/install.md](../docs/install.md).
