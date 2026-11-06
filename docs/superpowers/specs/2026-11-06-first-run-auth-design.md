# Qling 首次启动与账号登录设计

状态：用户已于 2026-11-06 批准按本方案直接实施；实现与验证正在进行。

## 目标与已确认需求

用户要求：新人第一次直接运行 `qling` 即可配置模型；同时支持 ChatGPT/Grok 账号与 API Key，优先展示账号登录。目标是完成配置后在同一进程进入 Qling 对话，不必手工修改环境变量或重新启动。

本设计保持 Qling 自有 Agent Loop、工具、权限与恢复机制，不把主任务委托给另一个 Coding Agent。

## 当前问题与证据

- `src/index.ts` 交互启动调用 `checkOnboarding`，该函数只输出操作说明，没有运行配置向导。
- `src/onboarding/tutorial.ts` 展示卡片后即写 `.onboarded`，不代表凭据配置完成；只检查任意 provider key 也不能判断当前 provider 是否可用。
- `src/cli/setup.ts` 读取 API Key 后仅输出另行设置环境变量的说明；保存配置使用覆盖整个全局 `.env` 的方式，没有账号会话或安全凭据存储。
- `src/commands/claude-style.ts` 的 `/login`、`/logout` 当前为不可用占位命令。
- `src/providers/llm-client.ts` 当前只有 Chat Completions 请求；ChatGPT 官方计划授权需要独立 Responses 适配，不能仅替换 Bearer 值。

## 新人可见流程

仅当交互式 `qling` / `qling chat` / `qling repl` 缺少当前连接所需的配置或有效凭据时进入向导。

1. 欢迎页：选择“ChatGPT 账号”“Grok 账号”“API Key”“本地模型”；账号入口优先。
2. ChatGPT：打开官方授权网页；用户自行登录并同意授权。Grok：解释将复用官方 Grok Build 登录，检测 CLI，打开官方登录流程。
3. API Key：选择提供商，隐藏输入 Key；常用 endpoint 自动填充，自定义 endpoint 可编辑并校验；不要求用户手动设置环境变量。
4. 选择模型：能读取账户模型列表时使用账户返回的模型；读取失败允许手动选择并标注“尚未验证”，不虚构账户权限。
5. 展示连接摘要、凭据保存方式和数据将发送至哪个提供商；保存后重新解析配置，进入当前 Qling 对话。
6. 可返回、取消或稍后配置。取消不写完成标记，不损坏旧配置，不隐式切换到付费 API。

已配置用户直接启动原有会话。旧 `.onboarded` 只代表看过说明；有效连接仍需独立判断。

无 TTY、`qling run --json`、脚本管道不弹交互向导，返回结构化缺配置错误及 `qling setup` 指引。`--help`、`--version`、doctor 等管理命令保持无需凭据。

## ChatGPT 账号接入

采用官方 Sign in with ChatGPT 的本地开源应用流程：初次动态注册、持久 host ID、Qling 自身应用名、PKCE S256、state/nonce 和仅监听 `127.0.0.1` 的回调。保存用户获得的 client ID，后续登录复用；不冒用 Codex 的 client ID，不读取已有 Codex 私有凭据。

按 OIDC 要求验证 ID Token 签名、issuer、audience、nonce、有效期，以及推理所需的已授予 scopes。实现使用经确认的标准验证库，避免手写 JWT 签名校验；新增依赖在实施阶段核对版本后采用。

推理调用官方 `https://api.openai.com/v1/responses`，`store=false`、`stream=true`，携带完整所需历史。System 消息转换为 instructions/developer；工具声明按计划授权支持的 namespace/additional_tools 格式适配；保留工具调用 ID 与结果配对。

必须消费到 `response.completed` 才算调用成功。中断、incomplete、failed、工具参数增量、用量、模型列表、取消、401 刷新和订阅额度错误分别处理。不发送该接口明确不支持的 temperature/max_output_tokens 等字段，不自动回退到 API Key 产生另一套账单。

订阅、工作区及官方预览限制可能影响可用模型；登录成功不等于模型推理已验证。只有用户主动测试或实际首轮成功后才显示“推理已验证”。

## Grok 账号接入

第一版复用官方 Grok Build 的账号登录入口，由 `grok login` 完成授权；Qling 按官方开源文档说明消费其会话及 CLI chat proxy，保留 Qling 自有工具执行。用户选中此模式时明确说明 Qling 将使用该官方登录会话，避免后台静默扫描凭据。

不采用网页密码、Cookie 导入或网页模拟聊天。官方 CLI 未安装时给出官方安装入口，用户可改用 xAI API Key，不在后台自动安装。现有已登录会话仅在用户明确选择 Grok 账号模式后复用。

凭据适配层只读取协议必需字段，不输出 token、整个 auth.json 或个人账户信息；处理官方存储结构差异、到期与刷新。若当前官方版本不提供安全可验证的刷新契约，要求重新官方登录，不通过执行一条收费推理来“刷新”。刷新失败保留当前未完成任务，提示重新授权。

请求限定到官方代理来源，设置官方要求的认证及模型路由头；OAuth 凭据不得发送到自定义 API endpoint。模型支持由实际账户/服务返回决定，不把所有 Grok 会员一律当作拥有全部模型。

此实现不复制第三方客户端身份；独立 Qling 原生 xAI OAuth 注册可作为后续扩展，需官方对第三方接入契约明确后再替换官方 CLI 登录桥接。

## API Key 与凭据保存

继续支持原有提供商，补齐独立的 OpenAI 与 xAI/Grok API Key 配置。Ollama 等无 Key 服务不展示无意义的 Key 输入。

认证配置按 provider + auth method 隔离，类型至少为 `api_key`、`chatgpt_oauth`、`grok_cli_session`、`none`。非敏感连接配置只存凭据引用；密钥、access/refresh token 不写 `.env`、Git、trace 或日志。

Windows 使用当前用户 DPAPI 加密凭据，秘密只经管道传入辅助进程，不放在命令行参数。macOS/Linux 第一版允许按官方 CLI 常见方式使用用户私有目录与 0600 文件；UI 必须如实注明它是权限保护、并非系统钥匙串加密。无法建立所需权限或加密失败则报错，可选仅当前进程使用，不声称已安全持久化。

凭据文件及非敏感配置采用同目录临时文件与原子替换。先保存新凭据，配置引用成功提交后切换激活；失败时旧连接仍可用。去重、账户切换和刷新使用单飞机制，避免同时消耗 refresh token；不在网络请求锁内阻塞无关提供商。

## 配置优先级与兼容

- 原有 CLI/env 配置在没有新连接档案时继续按原逻辑工作；不迁移、删除真实旧 Key，不整份覆盖现有 `.env`。
- 明确选择账号模式后只使用该模式的会话，不因环境里有 OPENAI_API_KEY/XAI_API_KEY 而悄悄切换计费方式。
- 明确的 CLI provider/model/endpoint 覆盖继续生效；若与账号模式官方 endpoint 冲突，要求换连接，不发送账号 token。
- API Key 模式优先使用该提供商明确设置的环境变量，其次安全存储；通用 Key 维持当前 startup-provider 作用域。
- 切换 provider 时同时切换整份连接身份，不把原 provider Key 带给新 provider。
- 日常提供商切换继续复用 `/model`；本次不重构无关的记忆、调度或 Dashboard。

## 管理与运行命令

- `qling setup`：重新打开同一配置向导，允许增加或切换连接。
- `qling login [chatgpt|grok]` 与 `/login`：启动登录或重新授权；会话内调用须先暂停新一轮推理。
- `qling logout [provider]` 与 `/logout`：清除/解除 Qling 自己的凭据或会话引用。默认不调用 `grok logout` 影响其他应用；若要全局退出须提供独立明确选项及确认。
- `qling auth status`：只显示方式、有效性、到期/需重登及模型验证状态，不输出 token。

这些命令在实例化需要凭据的 AgentLoop 前路由；未配置时仍可登录、退出、诊断。

## 涉及模块与数据流

计划改动：`src/index.ts`、`src/cli/startup-contract.ts`、`src/cli/setup.ts`、`src/onboarding/tutorial.ts`、provider resolve/presets/remote-models/llm-client、slash 登录占位与配置报告、帮助及中英文文案。新增 `src/auth/` 协议适配、凭据仓库、登录回调与 provider session resolver，以及独立 Responses 适配模块。

认证状态：unconfigured → selecting → authorizing → authorized → selecting_model → saved → ready；授权失败/取消回到选择或退出，过期进入 needs_login。推理是否验证是单独字段，不用 authorized/saved 冒充 ready-to-infer。

运行数据流：启动路由 → 当前连接解析 → 缺配置则向导 → 认证适配 → 凭据引用持久化 → 重载配置 → 选择 Chat Completions/Responses 客户端 → Qling 原有 Loop 与工具。

## 验证与验收

定向覆盖：干净用户目录首次启动、现有配置免打扰、旧 onboarding 标记但缺 Key、当前 provider 缺凭据而别的 provider 有 Key、非 TTY/JSON不挂起、取消/超时/重复回调/端口占用、错 state/nonce/签名/issuer/audience、拒绝授权、scope不足、过期/刷新失败及并发刷新、隐藏输入不回显、配置原子写失败、provider隔离、无 Key 本地模型、退出不破坏 Grok 全局登录。

推理协议覆盖：Responses 工具声明与结果、多轮工具调用、增量参数拼接、completed/incomplete/failed/断流、取消、用量与订阅限额；Grok 代理 header/认证来源和仅流式模型。禁止把模拟成功称为真实会员调用成功。

默认测试采用临时用户目录、假的 OAuth/模型 HTTP 服务、模拟官方 CLI，不能读取测试机真实凭据；不自动付费调用真实模型。真实登录和最小推理验收需用户在正式页面操作，可能使用额度时单独明确后执行。

完成标准：新人可从干净目录只运行一次 `qling`，经明确选择和授权/Key输入完成配置并在当前会话发出首条任务；重启无需重复设置；脚本与已有用户行为无回退；敏感信息不出现在终端回显和日志。分别报告“本地模拟通过”“真实授权通过”“真实推理通过”。

## 分阶段与回滚

1. 先实现无凭据启动向导、连接档案/凭据仓库、API Key 与 xAI 预设；同一进程进入会话。
2. 实现 ChatGPT 官方授权与 Responses 适配，验证工具调用不绕过 Qling Harness。
3. 实现 Grok 官方登录桥接与会话刷新/代理适配，再做整体初次使用体验验收。

每阶段定向测试、类型检查、受影响构建和独立代码/安全复审。通过后再运行相关 smoke/full gate。全局发布/npm更新不在本次默认实施范围，沿用单独发布动作。

回滚保留旧 env 读取路径；新认证选择显式关闭即可回到旧连接。回滚不删除用户配置或官方 CLI 凭据。新档案版本化，旧版本无法解释时给明确指引而非误当 API Key。

## 已核实官方参考

- OpenAI 动态注册：https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- OpenAI 推理：https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- OpenAI 当前限制：https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- Grok 官方登录：https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md
- Grok 官方会话 API 示例：https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md

Grok 文档/版本对 token 刷新和寿命描述不同，实施时以当前实际官方 CLI 协议及到期字段为准，不硬编码文档中的天数。
