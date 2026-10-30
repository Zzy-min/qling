import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInnerIterationLoop } from '../../dist/agent/main-loop.js';
import { ContextCompactor } from '../../dist/context-compactor.js';
import { ExecutionEventBus } from '../../dist/execution/event-bus.js';
import { RecoveryController } from '../../dist/execution/recovery-controller.js';

async function fixture(options, action) {
  const state = await mkdtemp(join(tmpdir(), 'qling-window-'));
  const bus = new ExecutionEventBus();
  const recovery = new RecoveryController();
  bus.startRun({ runId: 'window-run', sessionId: 'window-session' });
  recovery.startRun({ runId: 'window-run', sessionId: 'window-session', originalTask: 'analyze project' });
  let chats = 0, tools = 0;
  const events = [];
  const host = {
    messages: [{ role: 'user', content: 'analyze project' }],
    turnCount: 0, sessionId: 'window-session', activeRunId: 'window-run',
    maxIterations: 20, iterationPolicy: 'continuous', toolRepeatLimit: 100, parseRetries: 0,
    verificationCommand: null,
    counters: { sessionTokens: 0, sessionPromptTokens: 0, sessionCompletionTokens: 0, tokenUsageSource: 'unknown' },
    compactionCount: 0, toolCallTotal: 0, toolFailureTotal: 0, retryCountTotal: 0, loggingFormat: 'json',
    compactor: new ContextCompactor(10_000_000, 'test'),
    pipeline: { execute: async call => { tools++; return { tool_call_id: call.id, output: 'file content', is_error: false }; } },
    tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
    knowledgeAdapter: { onToolCall() {}, onToolResult() {}, onAssistantMessage() {}, async onTurnEnd() {} },
    memoryStore: { link() {}, addConversationTurn() {}, addPractice() {} },
    workspaceDir: state, fileStateDir: state, workflowRuntime: {},
    executionEventBus: bus, recoveryController: recovery, verifier: {},
    buildSystemPrompt: async () => 'system',
    chat: async () => {
      chats++;
      if (chats === 22) return { content: 'complete', tool_calls: [] };
      return { content: '', tool_calls: [0, 1].map(n => ({ id: `call-${chats}-${n}`, type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: `file-${chats}-${n}.txt` }) } })) };
    },
    emit: (type, ...args) => events.push({ type, args }),
    runVerificationCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
    getRecoveryState: () => recovery.getRecoveryState(),
    reflectiveThink: async () => ({ decision: 'proceed', reason: '' }), checkAutoDream: async () => {},
    ...options,
  };
  try { await action(host, { recovery, events, counts: () => ({ chats, tools }) }); }
  finally { await rm(state, { recursive: true, force: true }); }
}

test('a 20-turn window continues the same task and counts tool calls separately', async () => {
  let savedTurns = [];
  await fixture({}, async (host, { counts, events }) => {
    host.checkpointSession = async () => { savedTurns.push(host.turnCount); };
    const result = await runInnerIterationLoop(host);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.text, 'complete');
    assert.deepEqual(counts(), { chats: 22, tools: 42 });
    assert.equal(host.turnCount, 22);
    assert.equal(host.toolCallTotal, 42);
    assert.equal(events.filter(e => e.type === 'iteration_window').length, 1);
    assert.ok(savedTurns.includes(20));
  });
});

test('explicit model-turn budget pauses without another model call or losing tool results', async () => {
  await fixture({ maxModelTurns: 21 }, async (host, { recovery, counts }) => {
    const result = await runInnerIterationLoop(host);
    assert.equal(result.status, 'paused');
    assert.equal(recovery.getRecoveryState().status, 'paused');
    assert.deepEqual(counts(), { chats: 21, tools: 42 });
    assert.equal(host.messages.filter(m => m.role === 'tool').length, 42);
  });
});

test('fixed iteration policy retains bounded SDK and evaluation behavior', async () => {
  await fixture({ iterationPolicy: 'fixed' }, async (host, { counts }) => {
    const result = await runInnerIterationLoop(host);
    assert.equal(result.status, 'exhausted');
    assert.deepEqual(counts(), { chats: 20, tools: 40 });
  });
});

test('automatic provider reentry cannot reset the explicit model-turn budget', async () => {
  await fixture({ maxModelTurns: 2, iterationBudget: { modelTurns: 0 } }, async host => {
    const originalChat = host.chat;
    let requests = 0;
    host.chat = async () => {
      requests++;
      if (requests === 2) throw new Error('temporary transport failure');
      return originalChat();
    };
    await assert.rejects(runInnerIterationLoop(host), /temporary transport failure/);
    const outcome = await runInnerIterationLoop(host);
    assert.equal(outcome.status, 'paused');
    assert.equal(requests, 3);
    assert.equal(host.iterationBudget.modelTurns, 2);
  });
});

test('budget checkpoint saves paused recovery state, not running state', async () => {
  await fixture({ maxModelTurns: 1 }, async (host, { recovery }) => {
    const saved = [];
    host.checkpointSession = async () => saved.push(recovery.getRecoveryState().status);
    assert.equal((await runInnerIterationLoop(host)).status, 'paused');
    assert.equal(saved.at(-1), 'paused');
  });
});

test('user cancellation during a budget checkpoint takes precedence over pause', async () => {
  await fixture({ maxModelTurns: 1 }, async (host, { recovery }) => {
    let canceled = false;
    host.isCanceled = () => canceled;
    host.checkpointSession = async () => { canceled = true; };
    await assert.rejects(runInnerIterationLoop(host), /canceled/i);
    assert.equal(recovery.getRecoveryState().status, 'canceled');
  });
});
