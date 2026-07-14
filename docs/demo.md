# Demo notes

Official screen recording / GIF is planned but **not** checked into the repo yet (keeps the git history small and avoids stale assets).

## 60-second terminal demo (text)

```text
$ git clone https://github.com/Zzy-min/qling.git && cd qling
$ npm run bootstrap && npm link
$ qling doctor
$ qling setup          # configure provider; keys stay in OS env
$ qling run "列出当前目录的 TypeScript 文件数"
$ qling                # streaming TUI
  > /plan on
  > 分析本仓库的 agent-loop 分层
  > /skill list
  > /expand
```

## Suggested GIF scenes (for contributors)

1. Cold start: `bootstrap` → `doctor` green/warn only  
2. One-shot `qling run` with tool timeline  
3. TUI: Shift+Tab mode cycle + slash completion  
4. Recovery: intentional failing test → `/recover` / verify stages  

When recording, prefer **Windows Terminal** or modern terminal with CJK fonts; export under 5 MB; link from README rather than embedding binary history.

## Related

- [docs/install.md](install.md)
- [README.en.md](../README.en.md)
- Release: https://github.com/Zzy-min/qling/releases
