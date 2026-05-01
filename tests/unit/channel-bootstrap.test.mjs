import test from "node:test";
import assert from "node:assert/strict";

import {
  CliChannelBootstrapError,
  resolveRunModeChannel,
} from "../../dist/cli/channel-bootstrap.js";

function makeChannels(patch = {}) {
  return {
    default: "console",
    telegram: {
      token: "",
      poll_interval_ms: 3000,
      allowed_chat_ids: [],
    },
    slack: {
      bot_token: "",
      app_token: "",
      channel_ids: [],
      poll_interval_ms: 3000,
    },
    ...patch,
  };
}

test("channel bootstrap matrix: run mode mounts configured channel", () => {
  const consoleChannel = resolveRunModeChannel("run", makeChannels({ default: "console" }));
  const telegramChannel = resolveRunModeChannel(
    "run",
    makeChannels({
      default: "telegram",
      telegram: {
        token: "t",
        poll_interval_ms: 1000,
        allowed_chat_ids: ["1"],
      },
    })
  );
  const slackChannel = resolveRunModeChannel(
    "run",
    makeChannels({
      default: "slack",
      slack: {
        bot_token: "xoxb-token",
        app_token: "",
        channel_ids: ["C001"],
        poll_interval_ms: 2000,
      },
    })
  );

  assert.equal(consoleChannel?.name, "console");
  assert.equal(telegramChannel?.name, "telegram");
  assert.equal(slackChannel?.name, "slack");
});

test("channel bootstrap matrix: non-run modes do not mount channels", () => {
  const channels = makeChannels({ default: "telegram" });
  assert.equal(resolveRunModeChannel("chat", channels), null);
  assert.equal(resolveRunModeChannel("repl", channels), null);
  assert.equal(resolveRunModeChannel("help", channels), null);
});

test("channel bootstrap: missing telegram token throws coded error", () => {
  assert.throws(
    () => resolveRunModeChannel("run", makeChannels({ default: "telegram" })),
    (err) => {
      assert.ok(err instanceof CliChannelBootstrapError);
      assert.equal(err.code, "CLI_CHANNEL_MISSING_CREDENTIALS");
      return true;
    }
  );
});

test("channel bootstrap: missing slack bot token throws coded error", () => {
  assert.throws(
    () => resolveRunModeChannel("run", makeChannels({ default: "slack" })),
    (err) => {
      assert.ok(err instanceof CliChannelBootstrapError);
      assert.equal(err.code, "CLI_CHANNEL_MISSING_CREDENTIALS");
      return true;
    }
  );
});

test("channel bootstrap: invalid default throws coded error", () => {
  assert.throws(
    () => resolveRunModeChannel("run", makeChannels({ default: "unknown-channel" })),
    (err) => {
      assert.ok(err instanceof CliChannelBootstrapError);
      assert.equal(err.code, "CLI_INVALID_CHANNEL_DEFAULT");
      return true;
    }
  );
});

