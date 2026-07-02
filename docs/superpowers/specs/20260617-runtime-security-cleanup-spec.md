# Runtime Security & Cleanup Spec (2026-06-17)

## Problem
运行时 `.env` 中存在明文 LLM API key（高风险）。
`~/.qling` 根目录残留用户实验产生的临时脚本。
当前 `doctor` / `privacy` / `bootstrap` / `storage` 不主动发现和提示运行时 secret 风险。
缺少安全、保守的运行时清理能力。

## Goals
1. 运行时不再默认存放可被轻易同步/备份的明文密钥。
2. qling 自身在关键入口（doctor, privacy, bootstrap）主动检测并**只报告变量名+路径**，给出迁移指导。
3. 新增保守的 `storage clean`（--dry-run / --yes），仅清理明确临时项，默认绝不删除 sessions/memory/guard/audit/.env 。
4. 文档强化“密钥最佳实践”。

## Non-Goals
- 不自动删除或改写用户 .env 文件（除用户明确操作）。
- 不改变 LLM 调用、memory/session 格式、daemon 语义。
- 不实现 `secrets migrate`（留待后续）。
- 不扫描消息内容或做主动密钥轮换。

## Detection Scope (只读)
- `~/.qling/.env`
- `<cwd>/.env` / 项目根 `.env`
- 变量名匹配（大小写不敏感前缀）：
  - `*API_KEY*`
  - `*TOKEN*`
  - `*SECRET*`
  - 具体已知：DEEPSEEK_API_KEY, OPENAI_API_KEY, QLING_LLM_API_KEY 等

报告格式示例：
```
[WARN] Plaintext secret detected
  file: C:\Users\Lenovo\.qling\.env
  vars: DEEPSEEK_API_KEY, OPENAI_API_KEY, QLING_LLM_API_KEY
建议：立即轮换 key，并将密钥移至系统用户环境变量或安全的 secret manager。
```

## Cleanup Scope (storage clean)
可清理候选（仅这些）：
- runtime state dir 根的临时脚本（tmp_*.py / tmp_*.ps1 等用户实验残留）
- cache/ 目录下的非核心文件（过期或实验产生）
- missions/、session-tasks/ 下的空目录/文件

**绝不清理**：
- sessions/
- memory/
- guard/audit/
- 任何 .env
- 用户有意义的历史数据

行为：
- `--dry-run`：仅列出将要删除的路径 + 预计数量，不执行。
- `--yes`：实际执行删除（unlink / rmdir 空目录）。
- 默认（无参数）：显示帮助或当前 storage 报告。

## Integration Points
- `buildDoctorReport` / `formatDoctorReport`
- `buildPrivacyReport` / `formatPrivacyReport`（或独立 privacy 增强）
- `buildBootstrapReport` / `formatBootstrapReport` + runBootstrap
- `storageCommand` execute + 新 clean 逻辑（可复用 local-storage-report 的扫描）
- 可能共享的 `scanPlaintextSecrets(files: string[])` 工具函数

## Security & Privacy
- 检测函数**绝不**在任何输出、日志、报告中包含 secret value。
- 所有操作只读或用户显式确认（--yes）。
- 符合项目“安全 > 诚实 > 指令”。

## Test Requirements
见 plan 中的 Test Plan 部分。
- scanner 单元测试：识别已知 key 变量名，不泄露值。
- doctor/privacy/bootstrap 在检测到时产生 warn + 迁移建议。
- storage clean dry-run / yes 行为精确。

## Documentation
- README 最小配置部分增加强烈警告。
- doctor 报告增加 secret 相关说明。
- 本 spec + 对应 plan 落盘到 docs/superpowers/ 。

## Success Criteria
- 运行时两个 .env 中的明文 key 已手工清除（本轮先决）。
- 执行 `qling doctor` / `qling privacy` 时若 ~/.qling/.env 含 secret 则 warn。
- `qling storage clean --dry-run` 能报告 tmp 脚本和空目录。
- `--yes` 执行后仅删除允许项。
- 所有测试通过，`git diff --check` 干净，`npm audit --audit-level=high` 无 high。
- 文档已更新。
