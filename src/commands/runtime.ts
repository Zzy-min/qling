// Re-export slash context from adapters layer (keeps existing import paths).
export {
  type DaemonSessionApi,
  type SlashCommandContext,
  withDefaultWriters,
} from "../slash-context.js";
