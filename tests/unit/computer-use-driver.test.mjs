import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { MCPClient } from '../../dist/mcp/client.js';
const { CuaMcpDriver } = await import('../../dist/computer-use/driver.js').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
const stub = resolve('tests/fixtures/computer-use-driver.mjs');

test('raw MCP API preserves image and structured content rather than flattening it', async () => {
  const client = new MCPClient({ name: 'cua-test', command: process.execPath, args: [stub], enabled: true });
  try {
    assert.equal(typeof client.callToolRaw, 'function', 'raw MCP result API is missing');
    assert.equal((await client.connect()).status, 'connected');
    const result = await client.callToolRaw('get_window_state', {});
    assert.equal(result.content[0].data, 'AQID');
    assert.equal(result.structuredContent.ok, true);
  } finally { await client.disconnect(); }
});

test('raw MCP preserves multibyte labels split across stdio chunks', async () => {
  const client = new MCPClient({ name: 'utf8-test', command: process.execPath, args: [stub, '', 'utf8'], enabled: true });
  try {
    assert.equal((await client.connect()).status, 'connected');
    assert.equal((await client.callToolRaw('get_window_state', {})).structuredContent.label, '确定');
  } finally { await client.disconnect(); }
});

async function fixture(mode, run) {
  assert.equal(typeof CuaMcpDriver, 'function', 'CuaMcpDriver is missing');
  const dir = await mkdtemp(join(tmpdir(), 'qling-cua-mcp-'));
  const log = join(dir, 'calls.txt');
  const driver = new CuaMcpDriver({ command: process.execPath, args: [stub, log, mode], callTimeoutMs: 300 });
  try { await driver.connect(); await run(driver, log); }
  finally { await driver.close(); await rm(dir, { recursive: true, force: true }); }
}
test('Cua child receives an isolated environment and standard permission mode', async () => {
  const previous = process.env.QLING_LLM_API_KEY;
  process.env.QLING_LLM_API_KEY = 'synthetic-not-a-real-secret';
  try {
    await fixture('normal', async driver => {
      const result = await driver.call('get_window_state', { pid: 123, window_id: 42, max_elements: 100 });
      assert.equal(result.structuredContent.secretPresent, false);
      assert.equal(result.structuredContent.permissionMode, 'standard');
    });
  } finally { if (previous === undefined) delete process.env.QLING_LLM_API_KEY; else process.env.QLING_LLM_API_KEY = previous; }
});
test('missing live background capability refuses input before dispatch', async () => {
  await fixture('missing-schema', async (driver, log) => {
    const result = await driver.call('click', { pid: 123, window_id: 42, element_index: 1, delivery_mode: 'background' });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'CAPABILITY_UNSUPPORTED');
    await assert.rejects(readFile(log), { code: 'ENOENT' });
  });
});
test('transport loss never reconnects and replays an input call', async () => {
  await fixture('drop', async (driver, log) => {
    await assert.rejects(driver.call('click', { pid: 123, window_id: 42, element_index: 1, delivery_mode: 'background' }));
    assert.equal(await readFile(log, 'utf8'), 'click\n');
  });
});
test('abort interrupts a pending input without replay', async () => {
  await fixture('hang', async (driver, log) => {
    const abort = new AbortController();
    const pending = driver.call('click', { pid: 123, window_id: 42, element_index: 1, delivery_mode: 'background' }, abort.signal);
    setTimeout(() => abort.abort(), 30);
    await assert.rejects(pending);
    assert.equal(await readFile(log, 'utf8'), 'click\n');
  });
});

test('close invalidates an in-progress connection before a driver can survive shutdown', async () => {
  assert.equal(typeof CuaMcpDriver, 'function');
  const driver = new CuaMcpDriver({ command: process.execPath, args: [stub] });
  try {
    const connection = driver.connect();
    const rejected = assert.rejects(connection);
    await driver.close();
    await rejected;
    const result = await driver.call('list_windows', {});
    assert.equal(result.isError, true);
  } finally { await driver.close(); }
});
