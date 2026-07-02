# 轻灵运行时安全与清理收尾计划

## Summary
本轮目标是修复检查报告中唯一高风险问题：运行时 `.env` 明文密钥，同时补齐轻灵自身的安全提醒与运行时清理能力。已核验当前仓库 `main...origin/main` 干净；`C:\Users\Lenovo\.qling\.env` 含 3 个敏感 key 变量，`C:\Users\Lenovo\projects\qling\.env` 也含 1 个敏感 key 变量；`~/.qling` 下存在 5 个临时股票抓取脚本残留。

## Key Changes
- 运行时安全处置：
  - 删除 `C:\Users\Lenovo\.qling\.env` 和 `C:\Users\Lenovo\projects\qling\.env` 中的明文 key 行，只保留非敏感配置；不创建含密钥备份。
  - 用户需要在 DeepSeek/OpenAI 控制台轮换已暴露 key；轮换后通过 Windows 用户环境变量或 PowerShell profile 配置新 key。
  - 清理 `C:\Users\Lenovo\.qling\tmp_fetch_east*.py` 和 `C:\Users\Lenovo\.qling\tmp_parse_tcl.py`，保留 sessions、memory、guard/audit、input-history 等核心状态。

- 代码硬化：
  - 在 `qling doctor` / `qling privacy` / `qling bootstrap` 中检测 `~/.qling/.env` 或项目 `.env` 是否包含 `API_KEY`/`TOKEN`/`SECRET` 类明文变量。
  - 检测命中时只输出变量名和文件路径，不输出值；给出“迁移到系统环境变量 + 轮换 key”的下一步。
  - 新增只读报告能力，不自动删除用户文件，避免误删配置。

- 清理能力：
  - 新增 `qling storage clean --dry-run`，只列出可清理项：runtime 根目录临时脚本、过期 cache、空 missions/tasks。
  - 新增 `qling storage clean --yes` 执行安全清理；默认不碰 sessions、memory、guard/audit、`.env`。
  - `.env` 清理仍只给提示，不由 clean 自动改写，除非后续单独设计 `qling secrets migrate`。

- 文档落点：
  - 新增 spec 到 `docs/superpowers/specs/20260617-runtime-security-cleanup-spec.md`。
  - 新增 plan 到 `docs/superpowers/plans/20260617-runtime-security-cleanup-plan.md`。
  - 更新 README/doctor 帮助中“不要把 API key 放在可同步/可备份的运行时文件”的说明。

## Test Plan
- 单测：
  - `.env` secret scanner 能识别 `QLING_LLM_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`，输出只包含变量名不包含值。
  - `doctor/privacy/bootstrap` 在检测到明文 key 时显示 warn 和迁移建议。
  - `storage clean --dry-run` 只报告安全清理候选，不删除文件。
  - `storage clean --yes` 只删除临时脚本/cache 候选，不删除 sessions、memory、guard/audit、`.env`。

- 验证命令：
  - `npm run build`
  - `node --test tests\unit\doctor.test.mjs tests\unit\privacy-report.test.mjs tests\unit\local-storage-report.test.mjs tests\smoke\cli-startup.smoke.test.mjs`
  - `npm run ci:check`
  - `rg -n "q[i]ngling|Q[i]ngling|QINGL[i]NG" . -g "!node_modules/**" -g "!dist/**" -g "!.git/**"`
  - `git diff --check`
  - `npm audit --registry=https://registry.npmjs.org --audit-level=high`

## Assumptions
- 不在代码或日志中复述已暴露的 key 值。
- key 轮换必须由用户在对应 Provider 控制台完成，轻灵只能提示和验证本地迁移状态。
- 默认保守清理：不删除会话、记忆、审计日志和任何用户可能需要追溯的数据。
- 本轮不改变模型调用、记忆格式、session 格式、daemon/dashboard 语义。

## Implementation Phases
1. Runtime cleanup (manual via tools + verification)
2. Add secret scanner utility
3. Wire detection into doctor / privacy / bootstrap + recommendations
4. Extend storage command with clean sub-action (--dry-run / --yes)
5. Write / update docs (spec already landed, plan this file, README)
6. Add unit tests per Test Plan
7. Full verification (build, tests, rg, diff, audit)

## Risks & Mitigations
- 误删用户数据 → 极度保守的清理白名单 + --dry-run 默认 + 明确文档。
- 泄露 key 值 → 所有 scanner 实现只返回 varName + file，format 时绝不拼接 value。
- 测试覆盖不足 → 严格执行列出的测试文件 + ci:check。
