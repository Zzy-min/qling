# 轻灵正确调用 openCLI 计划

1. 新增 `skills/opencli/SKILL.md`。
2. `getSkillDirs()` 增加包内 skills + `~/.qling/skills`。
3. `buildRestrictionsSection` 增加网页/社交平台路由短规则。
4. 更新 `skills/qling.md`、`docs/skills.md`、skill 工具 description。
5. 单测：skill 可被扫描；restrictions 含 opencli 路由关键字。
6. `npm test`；commit + push。
