# `qingling` 稳定体验：本地 `/doctor` 诊断实施计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/doctor.test.mjs`：
  - `buildDoctorReport` 能输出 pass/warn/fail 汇总。
  - 缺失 state/cache 目录时返回 warn。
  - daemon probe 失败时返回 warn 而不是 fail。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/doctor` 输出诊断报告。
  - `/诊断` 中文别名可用。

## Step 2: 本地诊断模块

- 新增 `src/doctor.ts`：
  - 读取本地 runtime、workspace、git、state/cache、session、permission。
  - daemon 只探测 `127.0.0.1`/`localhost`。
  - 提供 formatter，供 slash command 与未来 CLI 复用。

## Step 3: Slash command 接入

- 新增 `src/commands/doctor.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/doctor.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
