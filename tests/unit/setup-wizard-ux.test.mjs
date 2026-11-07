import '../helpers/isolated-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runConnectionWizard,
  renderSetupBox,
  renderWelcomeMessage,
} from '../../dist/cli/setup.js';

function createWizardFixture(answers) {
  const output = [];
  const calls = [];
  return {
    output,
    calls,
    options: {
      stateDir: '/unused',
      isTTY: true,
      prompt: {
        ask: async (label, options) => {
          calls.push({ label, options });
          return answers.shift() ?? null;
        },
        write: (s) => output.push(s),
        close() {},
      },
      services: {
        listModels: async () => ({ ok: false, models: [] }),
        openBrowser: async () => {},
        loginChatGpt: async () => ({ profile: { id: 'fake', provider: 'chatgpt', method: 'chatgpt_oauth', endpoint: 'https://api.openai.com/v1', model: 'default' }, credential: { accessToken: 'fake' } }),
        loginGrok: async () => ({ profile: { id: 'grok', provider: 'grok-account', method: 'grok_cli_session', endpoint: 'https://cli-chat-proxy.grok.com/v1', model: 'grok-build' } }),
        saveConnection: async (...args) => calls.push({ saved: args }),
        markComplete: async () => calls.push({ marked: true }),
      },
    },
  };
}

test('renderSetupBox formats title and content with consistent Qling rounded borders', () => {
  const box = renderSetupBox('轻灵测试标题', ['选项 1: 测试项 A', '选项 2: 测试项 B']);
  assert.match(box, /╭─ 轻灵测试标题/);
  assert.match(box, /│ 选项 1: 测试项 A/);
  assert.match(box, /│ 选项 2: 测试项 B/);
  assert.match(box, /╰─+╯/);
});

test('renderWelcomeMessage includes styled banner and backwards compatible labels', () => {
  const msg = renderWelcomeMessage();
  assert.match(msg, /轻灵 Qling · 快速连接与模型配置向导/);
  assert.match(msg, /ChatGPT.*Grok.*API/s);
});

test('setup wizard lists relevant models for API key providers and allows number selection', async () => {
  // Answers:
  // 1. '3' -> API Key
  // 2. '1' -> Provider index 1 (DeepSeek)
  // 3. ''  -> Default Endpoint
  // 4. 'secret-key' -> API key
  // 5. '2' -> Model index 2 (deepseek-v4-pro)
  // 6. 'y' -> Confirm
  const f = createWizardFixture(['3', '1', '', 'secret-key', '2', 'y']);
  const result = await runConnectionWizard(f.options);

  assert.equal(result.status, 'saved');
  if (result.status === 'saved') {
    assert.equal(result.profile.provider, 'deepseek');
    assert.equal(result.profile.model, 'deepseek-v4-pro');
  }

  const allOutput = f.output.join('\n');
  // Check that candidate models were actively listed
  assert.match(allOutput, /可选模型列表 \[deepseek\]/);
  assert.match(allOutput, /deepseek-flash/);
  assert.match(allOutput, /deepseek-v4-pro/);
  assert.match(allOutput, /deepseek-v4-flash/);
  // Check that styled summary card was rendered
  assert.match(allOutput, /连接配置摘要/);
});

test('setup wizard supports provider shorthand alias like ds', async () => {
  // Answers:
  // 1. '3'  -> API Key
  // 2. 'ds' -> Shorthand for DeepSeek
  // 3. ''   -> Default Endpoint
  // 4. 'secret-key' -> API key
  // 5. ''   -> Default model (deepseek-flash)
  // 6. 'y'  -> Confirm
  const f = createWizardFixture(['3', 'ds', '', 'secret-key', '', 'y']);
  const result = await runConnectionWizard(f.options);

  assert.equal(result.status, 'saved');
  if (result.status === 'saved') {
    assert.equal(result.profile.provider, 'deepseek');
    assert.equal(result.profile.model, 'deepseek-flash');
  }
});

test('setup wizard supports custom model name input', async () => {
  // Answers:
  // 1. '3' -> API Key
  // 2. '1' -> Provider index 1
  // 3. ''  -> Default Endpoint
  // 4. 'secret-key' -> API key
  // 5. 'my-fine-tuned-model' -> Custom model
  // 6. 'y' -> Confirm
  const f = createWizardFixture(['3', '1', '', 'secret-key', 'my-fine-tuned-model', 'y']);
  const result = await runConnectionWizard(f.options);

  assert.equal(result.status, 'saved');
  if (result.status === 'saved') {
    assert.equal(result.profile.model, 'my-fine-tuned-model');
  }
});
