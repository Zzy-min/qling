export const zhCN = {
  product: {
    name: "轻灵",
    cliName: "qling",
    tagline: "本地优先的中文 AI Agent CLI 工作台",
  },
  labels: {
    reason: "原因",
    next: "下一步",
    example: "示例",
    localExecution: "本地执行",
    modelCall: "模型调用",
    boundary: "边界",
    yes: "是",
    no: "否",
  },
  boundaries: {
    localNoModel: "本地处理，不调用模型、不联网、不自动执行建议命令。",
    localValidation: "参数校验在本地完成，不调用模型。",
    slashCorrection: "本地纠错提示，不调用模型、不自动执行建议命令。",
    setupSecret: "setup 只保存非敏感配置；API key 请放在系统环境变量或安全 secret store。",
  },
  setup: {
    title: "轻灵 Qling - 快速配置",
    quickPath: "默认路径只配置 Provider / Model / Endpoint；API key 推荐写入系统环境变量。",
    keyPrompt: "请输入 API Key（可留空，推荐稍后写入系统环境变量）",
    keyNotSaved: "API Key 未写入 .env。请按下方示例配置系统环境变量。",
    windowsEnvExample: "[Environment]::SetEnvironmentVariable('QLING_LLM_API_KEY', '<your-key>', 'User')",
  },
} as const;

export type ZhCNText = typeof zhCN;
