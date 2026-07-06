import { zhCN, type ZhCNText } from "./zh-cn.js";

export type Locale = "zh-CN";
export type LocalizedText = ZhCNText;

export function getLocalizedText(_locale: Locale = "zh-CN"): LocalizedText {
  return zhCN;
}
