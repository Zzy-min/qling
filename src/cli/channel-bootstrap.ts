import { ConsoleChannel } from "../channels/console-channel.js";
import { SlackChannel } from "../channels/slack-channel.js";
import { TelegramChannel } from "../channels/telegram-channel.js";
import type { Channel } from "../channels/types.js";

export type CliModeForChannel = "help" | "run" | "chat" | "repl";

export interface ChannelConfigView {
  default: string;
  telegram: {
    token: string;
    poll_interval_ms: number;
    allowed_chat_ids: string[];
  };
  slack: {
    bot_token: string;
    app_token: string;
    channel_ids: string[];
    poll_interval_ms: number;
  };
}

export type CliChannelBootstrapErrorCode =
  | "CLI_CHANNEL_MISSING_CREDENTIALS"
  | "CLI_INVALID_CHANNEL_DEFAULT"
  | "CLI_CHANNEL_INIT_FAILED";

export class CliChannelBootstrapError extends Error {
  code: CliChannelBootstrapErrorCode;

  constructor(code: CliChannelBootstrapErrorCode, message: string) {
    super(message);
    this.name = "CliChannelBootstrapError";
    this.code = code;
  }
}

export function resolveRunModeChannel(
  mode: CliModeForChannel,
  channels: ChannelConfigView,
  options: { headless?: boolean } = {}
): Channel | null {
  if (mode !== "run") {
    return null;
  }

  const channelDefault = String(channels.default ?? "").trim().toLowerCase();
  switch (channelDefault) {
    case "console":
      return new ConsoleChannel({ headless: options.headless });
    case "telegram": {
      const token = String(channels.telegram.token ?? "").trim();
      if (!token) {
        throw new CliChannelBootstrapError(
          "CLI_CHANNEL_MISSING_CREDENTIALS",
          "channels.telegram.token is required when channels.default=telegram"
        );
      }
      return new TelegramChannel({
        token,
        pollIntervalMs: channels.telegram.poll_interval_ms,
        allowedChatIds: channels.telegram.allowed_chat_ids,
      });
    }
    case "slack": {
      const botToken = String(channels.slack.bot_token ?? "").trim();
      if (!botToken) {
        throw new CliChannelBootstrapError(
          "CLI_CHANNEL_MISSING_CREDENTIALS",
          "channels.slack.bot_token is required when channels.default=slack"
        );
      }
      return new SlackChannel({
        botToken,
        appToken: channels.slack.app_token,
        channelIds: channels.slack.channel_ids,
        pollIntervalMs: channels.slack.poll_interval_ms,
      });
    }
    default:
      throw new CliChannelBootstrapError(
        "CLI_INVALID_CHANNEL_DEFAULT",
        `unsupported channels.default: ${channels.default}`
      );
  }
}
