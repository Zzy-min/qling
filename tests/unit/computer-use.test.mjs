import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { ComputerUseController } = await import('../../dist/computer-use/controller.js').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const parsed = result => JSON.parse(result.output);

test('empty native accessibility capture reports unavailable element input, not a usable tree', async () => {
  await fixture(async ({controller,driver}) => {
    driver.call = async () => ({structuredContent:{snapshot_id:'native',elements:[],degraded:true,degraded_reason:'ax_tree_empty',elements_complete:false}});
    const c=parsed(await controller.execute({action:'capture',pid:123,window_id:42}));
    assert.equal(c.data.input_available,false);
    assert.equal(c.data.element_input_available,false);
    assert.equal(c.data.degraded,true);
    assert.equal(c.data.degraded_reason,'ax_tree_empty');
    assert.equal(c.data.elements_complete,false);
  });
});

test('native screenshot dimensions enable bounded background pixel clicks with a fresh snapshot', async () => {
  await fixture(async ({controller,driver,calls}) => {
    const original=driver.call;
    driver.call=async (name,args) => name==='get_window_state' ? {structuredContent:{snapshot_id:'native',elements:[],degraded:true,screenshot_width:1,screenshot_height:1},content:[{type:'image',data:png,mimeType:'image/png'}]} : original(name,args);
    const c=parsed(await controller.execute({action:'capture',pid:123,window_id:42}));
    assert.equal(c.data.element_input_available,false);
    assert.equal(c.data.coordinate_input_available,true);
    assert.equal(c.data.screenshot_width,1);
    assert.equal(c.data.screenshot_height,1);
    assert.equal(parsed(await controller.execute({action:'click',x:1,y:0,snapshot_id:c.snapshot_id})).code,'ELEMENT_REQUIRED');
    assert.equal(parsed(await controller.execute({action:'click',x:0,y:0,snapshot_id:c.snapshot_id})).ok,true);
    assert.equal(calls.at(-1).args.delivery_mode,'background');
    assert.equal(parsed(await controller.execute({action:'click',x:0,y:0,snapshot_id:c.snapshot_id})).code,'CAPTURE_REQUIRED');
  });
});

test('dimensions without a matching screenshot cannot authorize pixel input', async () => {
  await fixture(async ({controller,driver}) => {
    for (const content of [[],[{type:'image',data:png,mimeType:'image/png'}]]) {
      driver.call=async()=>({structuredContent:{snapshot_id:'native',elements:[],screenshot_width:640,screenshot_height:1064},content});
      const c=parsed(await controller.execute({action:'capture',pid:123,window_id:42}));
      assert.equal(c.data.coordinate_input_available,false);
      assert.equal(c.data.input_available,false);
      assert.equal(parsed(await controller.execute({action:'click',x:10,y:10,snapshot_id:c.snapshot_id})).code,'ELEMENT_REQUIRED');
    }
  });
});

async function fixture(run, options = {}) {
  assert.equal(typeof ComputerUseController, 'function', 'ComputerUseController is not implemented');
  const dir = await mkdtemp(join(tmpdir(), 'qling-computer-'));
  const calls = [];
  let owner = 'session-a:run-a';
  const driver = {
    connect: async () => {},
    call: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_window_state') return { structuredContent: { pid: args.pid, window_id: args.window_id, elements: [{ index: 1, role: 'button', label: '确定' }], snapshot_id: 'native-snapshot' }, content: [{ type: 'image', data: png, mimeType: 'image/png' }] };
      return { structuredContent: { ok: true, verdict: 'confirmed' } };
    },
    close: async () => {},
  };
  const controller = new ComputerUseController({ enabled: true, driver, stateDir: dir, identity: () => owner, ...options });
  try { await run({ controller, driver, calls, setOwner: value => { owner = value; } }); }
  finally { await controller.close(); await rm(dir, { recursive: true, force: true }); }
}

test('computer use is disabled without spawning a driver', async () => {
  await fixture(async ({ controller, driver }) => {
    driver.connect = async () => assert.fail('disabled feature started a driver');
    assert.equal(parsed(await controller.execute({ action: 'list_windows' })).code, 'COMPUTER_USE_DISABLED');
  }, { enabled: false });
});

test('numeric string window handles are normalized for the native integer schema', async () => {
  await fixture(async ({ controller, calls }) => {
    await controller.execute({ action: 'capture', pid: 123, window_id: '42' });
    assert.equal(calls[0].args.window_id, 42);
  });
});

test('double-click uses the native schema without the single-click-only button field', async () => {
  await fixture(async ({ controller, calls }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    const result = parsed(await controller.execute({ action: 'double_click', element: 1, snapshot_id: capture.snapshot_id }));
    assert.equal(result.ok, true);
    assert.equal(calls.at(-1).name, 'double_click');
    assert.equal(Object.hasOwn(calls.at(-1).args, 'button'), false);
  });
});

test('extra modifiers cannot bypass hard-blocked key chords', async () => {
  await fixture(async ({ controller }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    assert.equal(parsed(await controller.execute({ action: 'key', keys: 'shift+alt+f4', snapshot_id: capture.snapshot_id })).code, 'KEY_BLOCKED');
  });
});

test('input requires an exact captured target and a one-use snapshot', async () => {
  await fixture(async ({ controller, calls }) => {
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1 })).code, 'CAPTURE_REQUIRED');
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    assert.equal(capture.ok, true);
    assert.equal(capture.data.elements[0].label, '确定');
    const result = parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id }));
    assert.equal(result.verdict, 'confirmed');
    assert.deepEqual(calls.at(-1), { name: 'click', args: { pid: 123, window_id: 42, element_index: 1, button: 'left', delivery_mode: 'background', snapshot_id: 'native-snapshot' } });
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id })).code, 'CAPTURE_REQUIRED');
  });
});

test('wrong snapshot and wrong target never reach the input driver', async () => {
  await fixture(async ({ controller, calls }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: 'stale' })).code, 'STALE_SNAPSHOT');
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id, pid: 999 })).code, 'TARGET_MISMATCH');
    assert.equal(calls.length, 1);
  });
});

test('session or run switching invalidates the old capture', async () => {
  await fixture(async ({ controller, setOwner }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    setOwner('session-b:run-a');
    assert.equal(parsed(await controller.execute({ action: 'type', text: 'hello', element: 1, snapshot_id: capture.snapshot_id })).code, 'CAPTURE_REQUIRED');
  });
});

test('transport loss after input is unknown_outcome and is never replayed', async () => {
  await fixture(async ({ controller, driver, calls }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    driver.call = async (name, args) => { calls.push({ name, args }); throw new Error('private raw failure'); };
    const result = await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id });
    assert.equal(parsed(result).verdict, 'unknown_outcome');
    assert.equal(calls.filter(c => c.name === 'click').length, 1);
    assert.doesNotMatch(result.output, /private raw failure/);
  });
});

test('foreground and blocked key aliases are refused before input', async () => {
  await fixture(async ({ controller, calls }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id, delivery_mode: 'foreground' })).code, 'FOREGROUND_DISABLED');
    for (const keys of ['alt+f4', 'option+f4', 'win+l', 'meta+l', 'cmd+shift+backspace', 'ctrl+alt+delete']) {
      assert.equal(parsed(await controller.execute({ action: 'key', keys, snapshot_id: capture.snapshot_id })).code, 'KEY_BLOCKED');
    }
    assert.equal(calls.length, 1);
  });
});

test('screenshots stay in local artifacts with bounded duplicate suppression', async () => {
  await fixture(async ({ controller }) => {
    const captures = [];
    for (let n = 0; n < 4; n++) captures.push(parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' })));
    assert.deepEqual(captures.map(c => Boolean(c.data.screenshot_omitted)), [false, true, true, false]);
    assert.equal((await readFile(captures[0].data.screenshot.path)).toString('base64'), png);
    assert.ok(captures.every(c => !JSON.stringify(c).includes(png)));
  });
});

test('a rejected new capture cannot leave the previous target active', async () => {
  await fixture(async ({ controller, driver }) => {
    const old = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    driver.call = async () => ({ isError: true, content: [{ type: 'text', text: 'private error' }] });
    assert.equal(parsed(await controller.execute({ action: 'capture', pid: 234, window_id: '55' })).ok, false);
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: old.snapshot_id })).code, 'CAPTURE_REQUIRED');
  });
});

test('closing while input waits for a connection prevents that input from being sent', async () => {
  await fixture(async ({ controller, driver, calls }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    driver.connect = () => new Promise(resolve => { release = resolve; started(); });
    const pending = controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id });
    await began;
    await controller.close();
    release();
    assert.equal(parsed(await pending).ok, false);
    assert.equal(calls.filter(call => call.name === 'click').length, 0);
  });
});

test('driver reconnection invalidates native snapshot ownership', async () => {
  await fixture(async ({ controller, driver, calls }) => {
    driver.generation = 1;
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    driver.connect = async () => { driver.generation++; };
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id })).code, 'CAPTURE_REQUIRED');
    assert.equal(calls.filter(call => call.name === 'click').length, 0);
  });
});

test('capture without a native snapshot cannot authorize element input', async () => {
  await fixture(async ({ controller, driver, calls }) => {
    const original = driver.call;
    driver.call = async (...args) => { const result = await original(...args); delete result.structuredContent.snapshot_id; return result; };
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    assert.equal(capture.ok, true);
    assert.equal(parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id })).code, 'NATIVE_SNAPSHOT_REQUIRED');
    assert.equal(calls.filter(call => call.name === 'click').length, 0);
  });
});

test('a second controller cannot reuse or overwrite another Agent capture', async () => {
  await fixture(async first => {
    const a = parsed(await first.controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    await fixture(async second => {
      assert.equal(parsed(await second.controller.execute({ action: 'click', element: 1, snapshot_id: a.snapshot_id })).code, 'CAPTURE_REQUIRED');
      await second.controller.execute({ action: 'capture', pid: 234, window_id: '55' });
      assert.equal(parsed(await second.controller.execute({ action: 'click', element: 1, snapshot_id: a.snapshot_id })).code, 'STALE_SNAPSHOT');
      assert.equal(parsed(await first.controller.execute({ action: 'click', element: 1, snapshot_id: a.snapshot_id })).ok, true);
    });
  });
});

test('background unavailable is visible and never escalates focus or retries input', async () => {
  await fixture(async ({ controller, driver, calls }) => {
    const capture = parsed(await controller.execute({ action: 'capture', pid: 123, window_id: '42' }));
    driver.call = async (name, args) => { calls.push({ name, args }); return { isError: true, structuredContent: { code: 'background_unavailable' } }; };
    const result = parsed(await controller.execute({ action: 'click', element: 1, snapshot_id: capture.snapshot_id }));
    assert.equal(result.verdict, 'background_unavailable');
    assert.equal(result.ok, false);
    assert.equal(result.next, 'capture');
    assert.equal(calls.filter(call => call.name === 'click').length, 1);
    assert.equal(calls.at(-1).args.delivery_mode, 'background');
  });
});
