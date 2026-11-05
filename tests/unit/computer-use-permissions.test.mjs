import test from 'node:test';
import assert from 'node:assert/strict';
import { HookManager } from '../../dist/pipeline/hooks.js';
import { guardConfigFromEnv } from '../../dist/config.js';
import { getPermissionGrantStore } from '../../dist/guard/permission-grants.js';
import { computerUseTool } from '../../dist/computer-use/schema.js';
import { buildToolRegistry, createToolDispatcher } from '../../dist/tools/index.js';

const ctx = args => ({ toolName: 'computer_use', arguments: args, inputSchema: computerUseTool.parameters, isReadOnly: false, isDestructive: true, isConcurrencySafe: false, dangerousPatterns: [] });
function manager(mode = 'allow') {
  const config = guardConfigFromEnv({});
  config.permissions.default = mode;
  config.audit.jsonl_path = '';
  return new HookManager([computerUseTool], config);
}
test('Computer Use is absent by default and exposed only by explicit feature flag', () => {
  const previous = process.env.QLING_FEATURES_COMPUTER_USE;
  try {
    delete process.env.QLING_FEATURES_COMPUTER_USE;
    assert.equal(buildToolRegistry().some(t => t.name === 'computer_use'), false);
    process.env.QLING_FEATURES_COMPUTER_USE = 'true';
    assert.equal(buildToolRegistry().some(t => t.name === 'computer_use'), true);
  } finally { if (previous === undefined) delete process.env.QLING_FEATURES_COMPUTER_USE; else process.env.QLING_FEATURES_COMPUTER_USE = previous; }
});
test('all desktop input requires approval even in auto mode with a remembered grant', async () => {
  const grants = getPermissionGrantStore();
  grants.remember('computer_use');
  try {
    assert.equal(grants.hasAllow('computer_use', { action: 'click' }), false);
    const hm = manager('allow');
    for (const args of [{ action: 'click', element: 1 }, { action: 'type', text: 'hello', element: 1 }, { action: 'key', keys: 'enter' }]) {
      assert.equal((await hm.runPreHook(ctx(args))).decision, 'ask');
    }
  } finally { grants.forget('computer_use'); }
});
test('Plan allows explicit observation but cannot execute desktop input', async () => {
  const hm = manager('allow');
  hm.setPlanMode(true);
  assert.equal((await hm.runPreHook(ctx({ action: 'capture', pid: 123, window_id: 42 }))).decision, 'allow');
  assert.equal((await hm.runPreHook(ctx({ action: 'click', element: 1 }))).decision, 'deny');
});
test('dangerous key aliases and foreground are denied before asking', async () => {
  const hm = manager('allow');
  assert.equal((await hm.runPreHook(ctx({ action: 'key', keys: 'alt+f4' }))).decision, 'deny');
  assert.equal((await hm.runPreHook(ctx({ action: 'click', element: 1, delivery_mode: 'foreground' }))).decision, 'deny');
});
test('observation skips default ask but explicit deny still wins', async () => {
  assert.equal((await manager('ask').runPreHook(ctx({ action: 'list_windows' }))).decision, 'allow');
  assert.equal((await manager('deny').runPreHook(ctx({ action: 'list_windows' }))).decision, 'deny');
});
test('dispatcher routes an Agent-owned controller, preserves call id, and closes it', async () => {
  let closed = false;
  const dispatch = createToolDispatcher({ computerUse: { execute: async () => ({ tool_call_id: '', output: 'controlled-result' }), close: async () => { closed = true; } } });
  const result = await dispatch({ id: 'desktop-call', name: 'computer_use', arguments: { action: 'capture' } });
  assert.equal(result.output, 'controlled-result');
  assert.equal(result.tool_call_id, 'desktop-call');
  await dispatch.close();
  assert.equal(closed, true);
});
