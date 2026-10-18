# RESULT 02：Bash 命令分段判定 + 参数级权限规则

- 实现者：pi 0.99.2（`pi -p`，会话 `qling-agent-study-02`）。协调者没有手写实现代码。
- 改动的区分方法：开始 02 前把工作区存了一份快照（`%TEMP%\qling-agent-study\pre02\`），下表是和快照逐文件对比的结果，所以 01 和更早的改动都不算在内。
- 没有 commit/push，没有读 .env，没有加依赖，package*.json 没动，也没引入 tree-sitter。
- 状态：**停在这里，等待确认**。原因是改动了说明范围外的 `src/config.ts`，而且这处改动会改变现有行为（见偏离点 1）。

## pi 改动的文件（以 pre02 快照为基准）
| 文件 | 改动量 | 内容 |
|---|---|---|
| `src/guard/shell-split.ts` | 新增，337 行 | 提供 `splitShell`、`unwrap`、`commandSubjects`。<br>• 能处理单/双引号、反斜杠，以及 `&& \|\| ; \| &` 和换行。<br>• 遇到 `$(`、反引号、`<(`、heredoc、`eval`、`bash/sh -c` 时标记 `complex=true`。<br>• `unwrap` 会去掉 sudo/env/timeout/nice/nohup/command/time/xargs 前缀和 `VAR=x` 赋值。 |
| `tests/unit/shell-split.test.mjs` | 新增，36 个用例 | 覆盖 brief 点名的 5 条命令、多段 allow/deny、配置缺省按 deny、字面量与正则两种匹配、grant 复用边界、误拒绝回归。 |
| `src/pipeline/hooks.ts` | +48 / −9 | 每段先 unwrap 再匹配危险模式。字符串模式改成字面量 `includes`（修复 `"rm -rf /*"` 被当成正则的问题），RegExp 模式不变。`complex` 且命中危险关键词时升级为 ask。 |
| `src/guard/permissions.ts`（基线里是干净的） | +136 / −3 | 规则新增 `arg_pattern`，`evaluate(toolName, args?)` 可以带参数。bash 多段命令必须每一段都 allow 才放行，任一段 deny 就拒绝。complex 命令不能靠参数级规则放行。<br>构造函数会把缺少或不合法的 `decision` 归一成 deny，但 `defaultDecision` 仍是 allow。 |
| `src/guard/permission-grants.ts`（基线里是干净的） | +27 / −2 | `hasAllow(toolName, args?)`：bash 的 session grant 只在单段、非 complex 时复用。 |
| `src/config.ts`（**说明范围外**） | +24 / −8 | 规则类型加 `arg_pattern?`。`parsePermissionRules` 原来会**丢弃**没有合法 decision 的规则，现在改成**按 deny 保留**，并带上 `arg_pattern`。 |

## 偏离点（需要确认）
1. **改了范围外的 `src/config.ts`，行为有变化**：配置（环境变量 JSON）里缺少 decision 的规则，以前会被丢掉，然后按默认 mode 处理；现在一律当作 deny。
   - pi 的理由：brief 要求"缺省 decision 的配置规则按 deny 解析"，而真正解析配置的地方就在 `config.ts`。
   - 现有合法配置和测试都不受影响。
   - 你可以选：保留 / 只保留 `arg_pattern` 透传、恢复原来的丢弃逻辑。
2. `permissions.ts` 构造函数也会对规则归一化：缺少 decision 的规则视为 deny。brief 的原话是"只改配置解析处"，这里也算一处轻微偏离。现有调用都会显式写 decision，所以测试没受影响。
3. 没有改的地方：`src/permissions-report.ts` 的 `normalizeRules` 遇到缺少 decision 的规则仍然回退成 `ask`。只有在"手工设置环境变量规则、又没加载 config"这种边缘情况下，`/permissions explain` 的显示才会和实际判定不一致。

## 测试结果
- `npm test`：共 1345，通过 1343，失败 1，跳过 1。
  - 唯一的失败是基线就有的 `verify tool applies tail…`。原因同 RESULT 01：npm 12 打印的 `npm notice run` 横幅里带出了 `console.log('one')`，和本次改动无关。
  - `repl slash loop…` 这条偶发的 EPERM 失败本次通过了。
- 新增测试单独跑：36/36 通过。
- pi 还额外跑了 `tsc --noEmit` 和 `dep-layers --strict`，退出码都是 0。
- 和基线比，没有新增失败。

## 基线失败清单
`not ok - verify tool applies tail as an output view and preserves the full artifact`（文件是 `%TEMP%\qling-agent-study\baseline-failures.txt`）。这一项不满足"全绿"要求，已确认按"不比基线多出新的失败"来验收。

## eval 前后对比
| eval | 改动前 | 改动后 |
|---|---|---|
| eval:tasks | 10/10 通过 | 10/10 通过 |
| eval:smoke | 22/22 通过 | 22/22 通过 |

两个 eval 都没有回退。注意：现有 eval 都没覆盖分段判定这项新行为，它的效果只由新增的单元测试证明。

---
## 补充（02b，2026-10-12 17:50 左右）：已确认采用方案 A
- **方案 A 已确认**：`config.ts` 和 `permissions.ts` 的改动全部保留。缺少或非法的 decision 一律按 deny 处理。上文"偏离点 1、2"不再需要决策。
- pi 第 2 轮（同一会话）补齐了第 3 条，让说明显示和实际判定一致：
  - `src/permissions-report.ts`（+4/−2）：`normalizeRules()` 和 `buildLocalPermissionsReport()` 遇到缺省 decision 时，回退值都从 `ask` 改为 `deny`。
  - `tests/unit/permissions-report.test.mjs`：新增 1 条测试 `permissions report treats a missing decision as deny`。
- 现在三条路径对缺省 decision 的处理一致，都是 deny：`config.ts parsePermissionRules`、`PermissionMatrix` 构造时的归一化、`permissions-report.ts`。
- `npm test`：共 1346，通过 1344，失败 1，跳过 1。唯一失败仍是基线已有的 `verify tool applies tail…`，新增测试通过。

### 02 最终改动文件（相对 pre02 快照）
- 新增：`src/guard/shell-split.ts`、`tests/unit/shell-split.test.mjs`
- 修改：`src/pipeline/hooks.ts`、`src/guard/permissions.ts`、`src/guard/permission-grants.ts`、`src/config.ts`、`src/permissions-report.ts`、`tests/unit/permissions-report.test.mjs`

---
## 安全回退修复（02c，2026-10-12 18:30 左右）
**问题**：在 `src/pipeline/hooks.ts` 的 `SpeculativeClassifier.classify` 里，命令属于复杂语法（含 `$(`、反引号、`eval`、`bash -c`）并且命中危险模式时，返回的是 ask。结果下面 4 条命令从改动前的"拒绝"变成了"询问"：
- `bash -c 'rm -rf /'`
- `echo $(date) && rm -rf /`
- ``echo `id`; rm -rf /``
- `eval 'rm -rf /'`

**修复**（由 pi 实现，会话 `qling-agent-study-02`）：
- 只要命中危险模式就判为 dangerous（拒绝）。命中的范围包括：整条命令、任一分段、或任一分段去掉 sudo/env 等包装前缀后的命令。
- 复杂语法现在只会把"安全"升级成"询问"，不会再把"拒绝"降成"询问"。

**本次改动的文件**（与 `%TEMP%\qling-agent-study\pre02c\` 快照对比）：
| 文件 | 改动 | 内容 |
|---|---|---|
| `src/pipeline/hooks.ts` | +12 / −10 | 删掉了"复杂语法 → 询问"的降级分支；导出 `BUILT_IN_DANGEROUS_PATTERNS`，供回归测试使用 |
| `tests/unit/hooks-danger-regression.test.mjs` | 新增 | 两组测试：上面 4 条命令的回归，以及"新判定不比旧判定宽松"（见下） |
| `tests/unit/shell-split.test.mjs` | +12 / −2 | 原来断言 `bash -c "rm -rf /"` 为 ask 的用例改成 dangerous；新增一条：`bash -c "echo hi"` 由安全升为询问 |

**测试结果**：
1. **4 条回归用例**：分类器全部判为 dangerous；通过 `HookManager.runPreHook` 走完整钩子流程，结果全部是 deny。全部通过。另外还有 2 条同类危险命令也判为 dangerous。
2. **"新判定不比旧判定宽松"**：
   - 旧判定在测试里按原来的整条正则逻辑重新实现：对整条命令逐个模式执行 `new RegExp(p).test(cmd)`，字符串模式当正则处理。
   - 样例共 39 条：shell-split 测试里出现的全部命令，加上面 4 条。
   - 断言两点：严格程度按 deny > ask > allow 排序，新判定不低于旧判定；旧判定命中的命令，新判定必须是 dangerous。
   - 结果 39/39 通过。
   - 偏离：旧逻辑遇到非法正则时，测试按"该模式不命中"处理。
3. 单独运行 hooks-danger-regression 和 shell-split 两个测试文件，共 45 个子测试，全部通过。
4. `npm test`：共 1360，通过 1358，失败 1，跳过 1。唯一的失败是基线已有的 `verify tool applies tail…`。
   - pi 自己跑全量时，还遇到过一次 `repl startup continue hydrates latest session loop timer` 失败，原因是 Windows 上重命名文件时偶发 EPERM。单独重跑 repl 测试 26/26 通过；我复跑的全量测试里也没有再出现。
