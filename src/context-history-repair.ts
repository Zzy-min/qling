// 兼容旧路径。实现在 pipeline/（core-services）。
// 本文件落在 other，只向下 re-export，core-services 不得再 import 这里。
export {
  repairHistory,
  type HistoryRepairReport,
  type HistoryRepairResult,
} from "./pipeline/context-history-repair.js";
