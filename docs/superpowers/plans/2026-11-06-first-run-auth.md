# First-run authentication implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 新人只运行 qling 即可选择账号或 Key、配置模型并进入当前会话。

**Architecture:** 独立认证仓库与会话解析器提供每次请求可更新的凭据；LLM 客户端选择官方 Responses 或现有 Chat Completions。CLI 在实例化 AgentLoop 前解析认证并进入可取消的首次配置向导。

**Tech Stack:** TypeScript / Node >=22、现有 axios 与 node:test、OIDC 标准验证库。

**Spec:** `docs/superpowers/specs/2026-11-06-first-run-auth-design.md`（用户已批准）。

## Global Constraints

- 保持 Qling 自有 Agent Loop、工具、权限与恢复机制。
- 只本地实现，不推送、发布、真实登录或付费调用；不读取开发机真实凭据。
- 不删除、整份覆盖用户现有配置或原无关工作树内容。
- API Key、OAuth、Grok CLI session 各自隔离；账号模式不自动切换 API 计费。
- 无 TTY 与 JSON 不弹向导；help/version/管理命令不要求 Key。
- 测试使用临时目录、假 HTTP/CLI；模拟通过不冒充真实账号或会员推理通过。

## Review Focus

- 配置中有别的 provider 的 Key，而当前 provider 缺配置：仍应进入向导/报准确错误。
- 取消 OAuth、写文件失败、重授权失败：旧有效连接不能被替换。
- 拒绝 token 被发往自定义域名、被写日志或被当作 API Key 跨 provider 复用。
- 工具输出、SSE增量参数、断流与订阅限额：保持原工具链，不能凭文字宣称完成。
- 终端非 TTY、旧 onboarding 标记、已有 env 配置：不挂起、不回退。

## Shared interfaces

`src/auth/types.ts`:
`AuthMethod = 'api_key'|'chatgpt_oauth'|'grok_cli_session'|'none'`.
`AuthProfile { id:string; provider:string; method:AuthMethod; endpoint:string; model:string }`.
`AuthCredential { accessToken?:string; refreshToken?:string; apiKey?:string; expiresAt?:number; clientId?:string; idToken?:string }`.

`src/auth/service.ts` exports:
- `loadActiveProfile(stateDir:string): Promise<AuthProfile|null>`
- `saveConnection(stateDir:string, profile:AuthProfile, credential?:AuthCredential):Promise<void>` (atomic activation; do not wipe old profiles)
- `resolveProfileCredential(stateDir:string, profile:AuthProfile, options?:{signal?:AbortSignal}):Promise<string>` (refresh single flight; official-origin restrictions)
- `loginChatGpt(options:{stateDir:string; signal?:AbortSignal; onUrl:(url:string)=>void; openBrowser?:(url:string)=>Promise<void>}):Promise<{profile:AuthProfile;credential:AuthCredential}>`
- `loginGrok(options:{stateDir:string; signal?:AbortSignal; runLogin?:()=>Promise<void>}):Promise<{profile:AuthProfile;credential?:AuthCredential}>`
- `logoutProfile(stateDir:string,provider?:string):Promise<void>` (detach Qling only for grok session)

Boundary: managed account providers use stable IDs `chatgpt` / `grok-account`; xAI API provider ID `xai`. Config adapter loads active profile and creates an explicit managed marker `qling-auth:<profile.id>` as the config's non-secret api_key only for account modes; marker is NEVER sent over HTTP. `LlmClientOptions` gains optional `authStateDir`, passed by AgentLoop from runtime root. Before any managed request, client loads exact active profile, matches provider/id/official endpoint and obtains fresh token via service. API key resolution uses provider-specific env first then vault at startup. Do not use global environment to pass account tokens between components.

### Task 1: Auth profiles, credential storage, OAuth and Grok official login bridge

**Ownership:** create `src/auth/*`; create `tests/unit/auth-*.test.mjs`; add only necessary validated runtime dependency/package-lock. No existing CLI/provider files.

- [ ] Read spec and write failing node:test tests for isolated profile storage, cancel/write-failure preservation, no secret in connection metadata, cross-provider isolation, OAuth invalid state/nonce/issuer/audience/JWT signature and insufficient scopes, refresh single-flight, Grok official store parsing, logout detaches only.
- [ ] Run tests and record expected red result before implementing.
- [ ] Implement Shared interfaces; crypto storage DPAPI on Windows and owner-only files elsewhere with injectable cipher for tests. Follow official SIWC dynamic registration, host ID, loopback PKCE, granted scopes, JWKS JWT verification; provider tests use injectable URLs/HTTP dependencies isolated from production fixed origins.
- [ ] Grok login runs official CLI with inherited stdio, explicit cancellation, no shell string interpolation. Parse supported official credential shapes with useful unsupported/expired errors; consume only officially documented proxy session. Never auto-install or invoke paid inference. Refresh only with a positively recognized official session metadata/client ID and trusted discovery; otherwise needs_login.
- [ ] Run typecheck and owned tests; record results/report. Do not commit another task's work.

### Task 2: Managed provider inference and configuration resolution

**Ownership:** `src/providers/*`, minimal `src/agent-loop.ts` HTTP-option wiring, `src/config.ts` config auth application, `scripts/dep-layers.mjs` auth foundation classification; tests provider/auth-resolution/responses. Consume Task1 interfaces.

- [ ] Write and run failing tests: Responses full history, namespaced tools, function call IDs/results, completed/incomplete/failed, chunk boundaries, canceled stream and use accounting; managed tokens must not be sent to foreign endpoints; xai env key scoped; account marker never reaches HTTP; config uses actual current connection rather than any provider's key.
- [ ] Add separate Responses implementation mapped to `LlmChatResponse`, called when provider is chatgpt; retain original API behavior for ordinary providers. Grok account uses original completions with official routing/auth headers and streaming support. Avoid circular imports; auth types/service remain foundation.
- [ ] Apply active profile through async config resolution without overriding explicit conflicting CLI provider; reject conflicting endpoint for managed mode. API Key profiles obtain env/vault key. Profiles without usable credentials remain unconfigured, not a fake success.
- [ ] Add xai and managed account presets/model-list protocol support with no fabricated entitlement or automatic paid probe.
- [ ] Verify current provider suite + new tests + typecheck + strict layers. Report exact tested scope.

### Task 3: First-run setup, auth commands and guided continuity

**Ownership:** `src/cli/setup.ts`, new CLI auth helpers, `src/index.ts`, `src/cli/startup-contract.ts`, `src/onboarding/tutorial.ts`, login/logout slash commands and index registration, help/i18n/config report docs; owned startup/wizard tests. Do not rewrite Task1/2 internals except coordinate required minimal fixes.

- [ ] Write/run failing tests for TTY first-run interception, existing credentials bypass, old onboarded-but-unconfigured, cancellation, non-TTY/JSON no prompt, no-key local models, prompt does not echo secrets, no whole .env replacement, model selection and same-process continuation.
- [ ] Implement shared cancellable wizard with account-first choices and injectable prompt/session services. Hide sensitive input; optional persistence failure can use current-session only with honest message; basic config profile does not erase old advanced switches. Wizard dynamic provider list must match presets.
- [ ] Route login/logout/auth status before AgentLoop construction. Remove unavailable placeholders, wire slash handlers and safe account status. Grok logout detaches Qling only. Same-process setup re-resolves config and enables first conversation; .onboarded only after save, canceled no write.
- [ ] Keep JSON/help/version/script compatibility; update user-facing help and docs for actual storage and official CLI dependency.
- [ ] Run targeted tests + build + full unit/smoke + strict layers; independent TS/security review and fix material findings.

## Execution ledger

The task workspace ledger records red/green tests, implementation status, integration rulings and remaining real-account verification. Do not label mocked authorization as real authorization. Keep changes local for user review.
