// ============================================================
// 轻灵 - 技能元数据类型
// ============================================================

export interface SkillMeta {
  name: string;
  description: string;
  tags: string[];
  /** 触发关键词/场景，仅进入索引，不进正文 */
  triggers: string[];
  path: string;
}
