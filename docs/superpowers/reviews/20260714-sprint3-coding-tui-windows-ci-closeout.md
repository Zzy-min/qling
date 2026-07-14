# Sprint 3 收口：编码精度 / TUI / Windows CI

**日期**: 2026-07-14  
**状态**: 完成  

## 落地

| 项 | 变更 |
|----|------|
| patch | `writeFileAtomic` 原子写 |
| repo map | `maxSymbols`/`maxChars` 预算截断 |
| search | 默认 limit 40 + 行截断 |
| TUI | 折叠 footer 中英；CJK width 回归；Shift+Tab 提示 |
| CI | ubuntu `ci:check` + windows unit |

## 证据

```text
npm run ci:check → exit 0 (unit 850 pass)
```
