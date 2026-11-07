import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import axios from 'axios';
import { runConnectionWizard, shouldRunFirstRunSetup, createTerminalPrompt } from '../../dist/cli/setup.js';
import { loadQlingConfig, applyConfigToProcessEnv } from '../../dist/config.js';
import { createAuthService } from '../../dist/auth/service.js';
import { resolveSavedLlmSession } from '../../dist/cli/auth.js';
import { AgentLoop } from '../../dist/agent-loop.js';
import { LlmHttpClient } from '../../dist/providers/llm-client.js';
import { callModelWithRetry, resolveModelRetryPolicy } from '../../dist/providers/model-retry.js';
import { modelCommand } from '../../dist/commands/claude-style.js';
import { EmbeddingClient } from '../../dist/memory/embedding.js';
import { extractDreamMemoriesLLM } from '../../dist/memory/memory-llm-dream.js';
import { consolidateMemoriesLLM } from '../../dist/memory/consolidation.js';
import { resolveVisionLlmConfig } from '../../dist/tools/vision-analyze.js';
const temporary = () => mkdtemp(join(tmpdir(), 'qling-final-fix-'));
const cipher = { encrypt: async (s) => s, decrypt: async (s) => s };
const account = { id: 'account', provider: 'chatgpt', method: 'chatgpt_oauth', endpoint: 'https://api.openai.com/v1', model: 'account-model' };
function wizard(answers) {
    const writes = [], saved = [];
    return {
        writes, saved,
        options: {
            stateDir: '/unused', isTTY: true,
            prompt: { ask: async () => answers.shift() ?? null, write: s => writes.push(s), close() {} },
            services: {
                saveConnection: async (...args) => saved.push(args),
                markComplete: async () => {},
                listModels: async () => ({ ok: false, models: [] })
            }
        }
    };
}
const call = { model: 'model', systemPrompt: 'system', messages: [{ role: 'user', content: 'test' }], tools: [] };
function preserveEnv(t) {
    const old = { ...process.env };
    t.after(() => {
        for (const k of Object.keys(process.env))
            if (!(k in old))
                delete process.env[k];
        Object.assign(process.env, old);
    });
}
test('explicit key-free profile survives config to AgentLoop to Axios wire', async (t) => {
    preserveEnv(t);
    process.env.QLING_MEMORY_WAL_ENABLED = 'false';
    const dir = await temporary();
    const s = createAuthService({ cipher });
    await s.saveConnection(dir, { id: 'local', provider: 'ollama', method: 'none', endpoint: 'http://127.0.0.1:11434/v1', model: 'local-model' });
    const loaded = await loadQlingConfig({ fileStateDir: dir }, { QLING_LLM_PROVIDER: 'openai', QLING_LLM_API_KEY: 'OLD-PAID' });
    process.env.QLING_LLM_API_KEY = 'OLD-PAID';
    applyConfigToProcessEnv(loaded.config);
    const agent = new AgentLoop({ provider: loaded.config.llm.provider, endpoint: loaded.config.llm.endpoint, model: loaded.config.llm.model, apiKey: loaded.config.llm.api_key, llmSources: loaded.llmSources, runtime: { fileStateDir: dir } });
    t.after(() => agent.shutdown());
    agent.llmClient.client.defaults.adapter = async (config) => {
        assert.equal(config.headers.get('Authorization'), undefined);
        return { status: 200, headers: {}, data: { choices: [{ message: { content: 'ok' } }] }, config };
    };
    await agent.llmClient.chatCompletions(call);
});
test('vault replacement uses B immediately after derived env publication and on reload', async (t) => {
    preserveEnv(t);
    delete process.env.QLING_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const dir = await temporary();
    const s = createAuthService();
    const p = { id: 'api', provider: 'openai', method: 'api_key', endpoint: 'https://api.openai.com/v1', model: 'm' };
    await s.saveConnection(dir, p, { apiKey: 'VAULT-A' });
    const first = await loadQlingConfig({ fileStateDir: dir });
    applyConfigToProcessEnv(first.config);
    await s.saveConnection(dir, p, { apiKey: 'VAULT-B' });
    const next = await resolveSavedLlmSession(dir);
    assert.equal(next.apiKey, 'VAULT-B');
    const client = new LlmHttpClient({ ...next, timeoutMs: 1000 });
    client.client.defaults.adapter = async (config) => {
        assert.equal(config.headers.get('Authorization'), 'Bearer VAULT-B');
        return { status: 200, headers: {}, config, data: { choices: [{ message: { content: 'ok' } }] } };
    };
    await client.chatCompletions(call);
    assert.equal((await loadQlingConfig({ fileStateDir: dir }, {})).config.llm.api_key, 'VAULT-B');
    assert.equal((await loadQlingConfig({ fileStateDir: dir }, { OPENAI_API_KEY: 'USER-OVERRIDE' })).config.llm.api_key, 'USER-OVERRIDE');
});
test('wizard no/NO and invalid confirmation never commit', async () => {
    for (const answer of ['no', 'NO', 'typo']) {
        const f = wizard(['4', '', '', 'model', answer, null]);
        assert.equal((await runConnectionWizard(f.options)).status, 'cancelled');
        assert.equal(f.saved.length, 0);
    }
});
test('wizard stops after SIGINT catalog failure without asking or saving', async () => {
    const f = wizard(['1', 'model', 'y']);
    f.options.services.loginChatGpt = async () => ({ profile: account, credential: { accessToken: 'pending' } });
    f.options.services.listModels = async () => {
        process.emit('SIGINT');
        return { ok: false, models: [] };
    };
    assert.equal((await runConnectionWizard(f.options)).status, 'cancelled');
    assert.equal(f.saved.length, 0);
});
test('API menu key-free preset enforces same loopback policy as local menu', async () => {
    const { listProviderPresets } = await import('../../dist/providers/presets.js');
    const index = listProviderPresets().findIndex(p => p.provider === 'ollama');
    assert.ok(index >= 0);
    const f = wizard(['3', String(index + 1), 'https://external.example/v1', 'model', 'y', null]);
    assert.equal((await runConnectionWizard(f.options)).status, 'cancelled');
    assert.equal(f.saved.length, 0);
});
test('custom loopback no-key connection is ready in interactive and headless startup', async () => {
    const config = { llm: { provider: 'custom', endpoint: 'http://127.0.0.1:1234/v1', api_key: '', model: 'm' }, runtime: { file_state_dir: '/unused' } };
    assert.equal(await shouldRunFirstRunSetup(config, { isTTY: true }), false);
    const { prepareStartupConnection } = await import('../../dist/cli/first-run.js');
    assert.equal((await prepareStartupConnection({ mode: 'run', isTTY: false, json: true, loaded: { config, warnings: [] }, cli: {}, load: async () => {
            throw Error('unexpected');
        } })).status, 'ready');
});
test('terminal prompt releases initial non-flowing stream and preserves reusable stdin', async () => {
    const stream = new PassThrough();
    stream.isTTY = true;
    stream.isRaw = false;
    stream.setRawMode = v => stream.isRaw = v;
    const prompt = createTerminalPrompt(stream, { write() {
        } });
    const answer = prompt.ask('');
    stream.write('yes\r');
    assert.equal(await answer, 'yes');
    prompt.close();
    assert.equal(stream.isPaused(), true);
    assert.equal(stream.destroyed, false);
    const second = createTerminalPrompt(stream, { write() {
        } });
    const again = second.ask('');
    stream.write('next\r');
    assert.equal(await again, 'next');
    second.close();
});
test('same verified subject reauthorization retires prior snapshot, distinct subjects survive', async () => {
    const dir = await temporary();
    const s = createAuthService({ cipher });
    const c = { accessToken: 'A1', subject: 'A', issuer: 'https://auth.openai.com' };
    await s.saveConnection(dir, account, c);
    await s.saveConnection(dir, { ...account, id: 'distinct' }, { ...c, subject: 'B', accessToken: 'B' });
    await s.saveConnection(dir, { ...account, id: 'reauthorized' }, { ...c, accessToken: 'A2' });
    assert.equal((await s.loadActiveProfile(dir)).id, 'account');
    assert.equal((await readdir(join(dir, 'auth'))).filter(n => n.startsWith('credential-')).length, 2);
    await s.logoutProfile(dir);
    const state = JSON.parse(await readFile(join(dir, 'auth', 'connections.json'), 'utf8'));
    assert.ok(state.entries.distinct);
    assert.equal((await readdir(join(dir, 'auth'))).filter(n => n.startsWith('credential-')).length, 1);
});
test('Grok wizard summary names official external store without DPAPI claim', async () => {
    const f = wizard(['2', '', 'y']);
    f.options.services.loginGrok = async () => ({ profile: { id: 'grok', provider: 'grok-account', method: 'grok_cli_session', endpoint: 'https://cli-chat-proxy.grok.com/v1', model: 'grok-build' } });
    assert.equal((await runConnectionWizard(f.options)).status, 'saved');
    assert.match(f.writes.join('\n'), /官方.*存储|官方.*凭据/);
    assert.doesNotMatch(f.writes.join('\n'), /DPAPI|0600/);
});
test('raw auxiliary clients never send managed marker', async (t) => {
    const original = axios.defaults.adapter;
    let requests = 0;
    axios.defaults.adapter = async (config) => {
        requests++;
        return { status: 200, headers: {}, data: { data: [{ embedding: [1] }], choices: [{ message: { content: '[]' } }] }, config };
    };
    t.after(() => axios.defaults.adapter = original);
    const marker = 'qling-auth:account';
    const embedding = new EmbeddingClient({ apiKey: marker, endpoint: account.endpoint, model: 'embed' });
    await assert.rejects(embedding.getEmbedding('text'), /unsupported|independent|credential|account/i);
    await extractDreamMemoriesLLM(['用户喜欢 TypeScript'], 24, { enabled: true, apiKey: marker, endpoint: account.endpoint, model: 'm', maxTokens: 100 });
    await consolidateMemoriesLLM(['fact'], [], { apiKey: marker, endpoint: account.endpoint, model: 'm' });
    assert.equal(requests, 0);
    const vision = resolveVisionLlmConfig({ QLING_LLM_SESSION_PROVIDER: 'chatgpt', QLING_LLM_SESSION_ENDPOINT: account.endpoint, QLING_LLM_SESSION_MODEL: 'm', QLING_LLM_SESSION_API_KEY: marker, QLING_VISION_PROVIDER: 'chatgpt' });
    assert.equal(vision.apiKey, '');
});
test('HTTP quota error body is retained and stops retry/fallback', async (t) => {
    const client = new LlmHttpClient({ provider: 'chatgpt', endpoint: account.endpoint, apiKey: 'qling-auth:account', authStateDir: '/unused', timeoutMs: 1000 });
    let attempts = 0;
    client.client = { post: async () => {
            attempts++;
            const error = Error('HTTP 429');
            error.code = 'ERR_BAD_REQUEST';
            error.response = { status: 429, headers: {}, data: Readable.from([JSON.stringify({ error: { code: 'insufficient_quota', message: 'subscription exhausted' } })]) };
            throw error;
        } };
    const policy = resolveModelRetryPolicy({ QLING_LLM_MAX_RETRIES: '2' });
    await assert.rejects(callModelWithRetry({ models: ['m', 'fallback'], policy, sleep: async () => {
        }, call: () => client.chatCompletions(call) }), e => {
        assert.equal(e.code, 'insufficient_quota');
        assert.equal(e.retriable, false);
        return true;
    });
    assert.equal(attempts, 1);
});
test('live goal controller uses API then current account transport and stops after logout', async (t) => {
    preserveEnv(t);
    for (const key of Object.keys(process.env))
        if (key.startsWith('QLING_GOAL_EVALUATOR_'))
            delete process.env[key];
    process.env.QLING_MEMORY_WAL_ENABLED = 'false';
    const { SessionGoalController } = await import('../../dist/session/goal-controller.js');
    const { SessionGoalManager } = await import('../../dist/session/session-goal-manager.js');
    const dir = await temporary();
    const service = createAuthService();
    await service.saveConnection(dir, { ...account }, { accessToken: 'ACCOUNT-ONLY', subject: 'test-subject', issuer: 'https://auth.openai.com', scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 });
    const agent = new AgentLoop({ provider: 'openai', endpoint: 'https://old-paid.example/v1', model: 'api-model', apiKey: 'PAID-A', runtime: { fileStateDir: dir } });
    t.after(() => agent.shutdown());
    const requests = [];
    const adapter = async (config) => {
        requests.push({ url: config.baseURL + config.url, authorization: config.headers.get('Authorization'), payload: JSON.parse(config.data) });
        if (config.url === '/responses') {
            return { status: 200, headers: { 'content-type': 'text/event-stream' }, config, data: Readable.from([
                    'data: {"type":"response.output_text.delta","delta":"{\\"done\\":false,\\"reason\\":\\"need account evidence\\"}"}\n\n',
                    'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'
                ].map(s => Buffer.from(s))) };
        }
        return { status: 200, headers: {}, config, data: { choices: [{ message: { content: '{"done":false,"reason":"need api evidence"}' } }] } };
    };
    agent.llmClient.client.defaults.adapter = adapter;
    const manager = new SessionGoalManager({ stateDir: dir, sessionId: 'goal-switch' });
    const controller = new SessionGoalController({ manager, evaluator: agent.createGoalEvaluator(), evidenceGoals: false });
    await controller.init();
    await controller.setGoal('verify behavior', { turnCount: 0, tokens: 0 });
    assert.equal((await controller.afterTurn({ transcript: 'first', stats: { turnCount: 1, tokens: 1 } })).status, 'continue');
    agent.applyLlmSession({ provider: 'chatgpt', endpoint: account.endpoint, model: account.model, apiKey: 'qling-auth:account' });
    agent.llmClient.client.defaults.adapter = adapter;
    const second = await controller.afterTurn({ transcript: 'second', stats: { turnCount: 2, tokens: 2 } });
    assert.equal(second.status, 'continue', JSON.stringify(second));
    assert.deepEqual(requests.map(r => r.url), ['https://old-paid.example/v1/chat/completions', 'https://api.openai.com/v1/responses']);
    assert.deepEqual(requests.map(r => r.authorization), ['Bearer PAID-A', 'Bearer ACCOUNT-ONLY']);
    assert.equal(requests[1].payload.model, 'account-model');
    assert.equal(requests[1].payload.temperature, undefined);
    assert.equal(requests[1].payload.max_tokens, undefined);
    await service.logoutProfile(dir);
    agent.applyLlmSession({ apiKey: '' });
    const result = await controller.afterTurn({ transcript: 'third', stats: { turnCount: 3, tokens: 3 } });
    assert.equal(result.status, 'evaluator_error');
    assert.match(result.reason, /login|退出/);
    assert.equal(requests.length, 2);
});
test('slash remote models carries selected account and runtime root to authenticated catalog', async (t) => {
    const dir = await temporary();
    const service = createAuthService();
    await service.saveConnection(dir, { ...account }, { accessToken: 'CATALOG-TOKEN', scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 });
    const oldFetch = globalThis.fetch;
    t.after(() => globalThis.fetch = oldFetch);
    let requests = 0;
    globalThis.fetch = async (url, options) => {
        requests++;
        assert.equal(url, 'https://api.openai.com/v1/models');
        assert.equal(options.headers.Authorization, 'Bearer CATALOG-TOKEN');
        return new Response(JSON.stringify({ models: [{ slug: 'account-private-model', visibility: 'list' }] }));
    };
    const lines = [], errors = [];
    await modelCommand.execute(['list', '--remote'], {
        agentLoop: { getModel: () => account.model, getProvider: () => account.provider, getEndpoint: () => account.endpoint, getApiKey: () => 'qling-auth:account', getRuntimeRootDir: () => dir },
        writeLine: s => lines.push(s), writeError: s => errors.push(s)
    });
    assert.equal(requests, 1);
    assert.match(lines.join('\n'), /account-private-model/);
    assert.deepEqual(errors, []);
});
test('embedding request-time connection drops retired API credentials and preserves independent service', async (t) => {
    const oldAdapter = axios.defaults.adapter;
    const calls = [];
    axios.defaults.adapter = async (config) => {
        calls.push({ endpoint: config.baseURL, key: config.headers.get('Authorization') });
        return { status: 200, headers: {}, config, data: { data: [{ embedding: [1, 2] }] } };
    };
    t.after(() => axios.defaults.adapter = oldAdapter);
    let connection = { apiKey: 'API-A', endpoint: 'https://api-a.example/v1' };
    const client = new EmbeddingClient({ apiKey: 'API-A', endpoint: connection.endpoint, model: 'embed', getConnection: () => connection });
    assert.deepEqual(await client.getEmbedding('first'), [1, 2]);
    connection = null;
    await assert.rejects(client.getEmbedding('after account switch'), /independent/);
    await assert.rejects(client.getEmbeddings(['after account switch']), /independent/);
    connection = { apiKey: 'EMBED-SERVICE', endpoint: 'https://embed.example/v1' };
    await client.getEmbedding('independent');
    assert.deepEqual(calls, [{ endpoint: 'https://api-a.example/v1', key: 'Bearer API-A' }, { endpoint: 'https://embed.example/v1', key: 'Bearer EMBED-SERVICE' }]);
});
test('account summary and dream helpers stay offline while independent raw service still works', async (t) => {
    const original = axios.defaults.adapter;
    const calls = [];
    axios.defaults.adapter = async (config) => {
        calls.push(config);
        return { status: 200, headers: {}, config, data: { choices: [{ message: { content: '["independent memory"]' } }] } };
    };
    t.after(() => axios.defaults.adapter = original);
    const { AgentLoop } = await import('../../dist/agent-loop.js');
    const linked = [];
    const fake = { memoryStore: { getCognitiveIndex: () => ({}), linkSessionToEntities: (...args) => linked.push(args) }, sessionId: 'session', messages: [{ role: 'user', content: 'summary task' }], memoryDreamLLMEnabled: true, turnCount: 2, config: { provider: 'chatgpt', apiKey: 'qling-auth:account', endpoint: account.endpoint, model: account.model } };
    await AgentLoop.prototype.linkSessionGraph.call(fake);
    assert.equal(calls.length, 0);
    assert.equal(linked.length, 1);
    const memories = await extractDreamMemoriesLLM(['independent'], 24, { enabled: true, apiKey: 'DREAM-SERVICE', endpoint: 'https://dream.example/v1', model: 'm', maxTokens: 100 });
    assert.deepEqual(memories, ['independent memory']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get('Authorization'), 'Bearer DREAM-SERVICE');
    const config = resolveVisionLlmConfig({ QLING_LLM_SESSION_PROVIDER: 'chatgpt', QLING_LLM_SESSION_ENDPOINT: account.endpoint, QLING_LLM_SESSION_MODEL: 'm', QLING_LLM_SESSION_API_KEY: 'qling-auth:account', QLING_VISION_PROVIDER: 'openai', QLING_VISION_ENDPOINT: 'https://vision.example/v1', QLING_VISION_API_KEY: 'VISION-SERVICE' });
    assert.equal(config.apiKey, 'VISION-SERVICE');
    assert.equal(config.endpoint, 'https://vision.example/v1/chat/completions');
});
test('API wizard replaces selected logical connection while separately saved API profiles survive', async () => {
    const { listProviderPresets } = await import('../../dist/providers/presets.js');
    const preset = listProviderPresets()[0];
    const dir = await temporary();
    const service = createAuthService({ cipher });
    const selected = { id: 'selected', provider: preset.provider, endpoint: preset.endpoint, model: preset.model, method: 'api_key' };
    await service.saveConnection(dir, selected, { apiKey: 'KEY-A' });
    const f = wizard(['3', '1', '', 'KEY-B', '', 'y']);
    f.options.stateDir = dir;
    f.options.services.loadActiveProfile = service.loadActiveProfile;
    f.options.services.saveConnection = service.saveConnection;
    assert.equal((await runConnectionWizard(f.options)).profile.id, 'selected');
    assert.equal(await service.resolveProfileCredential(dir, selected), 'KEY-B');
    assert.equal((await readdir(join(dir, 'auth'))).filter(n => n.startsWith('credential-')).length, 1);
    await service.saveConnection(dir, { ...selected, id: 'deliberately-distinct' }, { apiKey: 'KEY-C' });
    assert.equal((await readdir(join(dir, 'auth'))).filter(n => n.startsWith('credential-')).length, 2);
});
test('dedicated goal service requires its own key and never inherits active billing credential', async (t) => {
    preserveEnv(t);
    const { GoalEvaluator } = await import('../../dist/session/goal-evaluator.js');
    for (const key of Object.keys(process.env))
        if (key.startsWith('QLING_GOAL_EVALUATOR_'))
            delete process.env[key];
    process.env.QLING_LLM_SESSION_PROVIDER = 'openai';
    process.env.QLING_LLM_SESSION_ENDPOINT = 'https://old-paid.example/v1';
    process.env.QLING_LLM_SESSION_MODEL = 'm';
    process.env.QLING_LLM_SESSION_API_KEY = 'OLD-PAID';
    let requests = 0;
    const missing = new GoalEvaluator({ provider: 'openai', endpoint: 'https://goal.example/v1', fetchImpl: async () => {
            requests++;
            throw Error('unexpected');
        } });
    assert.equal((await missing.evaluate({ condition: 'x', transcript: 'private' })).error, 'no_key');
    assert.equal(requests, 0);
    const dedicated = new GoalEvaluator({ provider: 'openai', endpoint: 'https://goal.example/v1', apiKey: 'GOAL-OWN-KEY', fetchImpl: async (url, options) => {
            requests++;
            assert.equal(url, 'https://goal.example/v1/chat/completions');
            assert.equal(options.headers.Authorization, 'Bearer GOAL-OWN-KEY');
            return new Response(JSON.stringify({ choices: [{ message: { content: '{"done":true,"reason":"own service"}' } }] }));
        } });
    assert.equal((await dedicated.evaluate({ condition: 'x', transcript: 'private' })).done, true);
    assert.equal(requests, 1);
});
test('stream HTTP error body disposal stops at 4 KiB instead of draining unbounded data', async () => {
    const client = new LlmHttpClient({ provider: 'chatgpt', endpoint: account.endpoint, apiKey: 'qling-auth:account', authStateDir: '/unused', timeoutMs: 1000 });
    let reads = 0, destroyed = false;
    const body = { destroy() {
            destroyed = true;
        }, [Symbol.asyncIterator]() {
            return { next: async () => {
                    reads++;
                    return { done: false, value: Buffer.alloc(8192, 120) };
                } };
        } };
    client.client = { post: async () => {
            const e = Error('HTTP 500');
            e.response = { status: 500, headers: {}, data: body };
            throw e;
        } };
    await assert.rejects(client.chatCompletions(call), e => {
        assert.ok(e.message.length < 5000);
        return true;
    });
    assert.equal(reads, 1);
    assert.equal(destroyed, true);
});
test('unsupported account vision exits before any request including local-provider selection', async () => {
    const { runVisionAnalyze } = await import('../../dist/tools/vision-analyze.js');
    let requests = 0;
    const active = { QLING_LLM_SESSION_PROVIDER: 'chatgpt', QLING_LLM_SESSION_ENDPOINT: account.endpoint, QLING_LLM_SESSION_MODEL: 'm', QLING_LLM_SESSION_API_KEY: 'qling-auth:account' };
    for (const provider of ['chatgpt', 'deepseek', 'local']) {
        const result = await runVisionAnalyze({ prompt: 'analyze', image_url: 'https://image.example/test.png' }, { env: { ...active, QLING_VISION_PROVIDER: provider, DEEPSEEK_API_KEY: 'UNRELATED-PAID' }, postImpl: async () => {
                requests++;
                throw Error('unexpected request');
            } });
        assert.equal(result.is_error, true);
    }
    assert.equal(requests, 0);
});
test('derived provider publication preserves original generic-key ownership across reload', async (t) => {
    preserveEnv(t);
    delete process.env.QLING_LLM_STARTUP_PROVIDER;
    delete process.env.XAI_API_KEY;
    process.env.QLING_LLM_PROVIDER = 'openai';
    process.env.QLING_LLM_API_KEY = 'OPENAI-ONLY';
    const dir = await temporary();
    const service = createAuthService();
    await service.saveConnection(dir, { id: 'xai', provider: 'xai', method: 'api_key', endpoint: 'https://api.x.ai/v1', model: 'grok-test' }, { apiKey: 'XAI-VAULT' });
    const first = await loadQlingConfig({ fileStateDir: dir });
    assert.equal(first.config.llm.api_key, 'XAI-VAULT');
    applyConfigToProcessEnv(first.config);
    assert.equal((await resolveSavedLlmSession(dir)).apiKey, 'XAI-VAULT');
    assert.equal(process.env.QLING_LLM_STARTUP_PROVIDER, 'openai');
});
