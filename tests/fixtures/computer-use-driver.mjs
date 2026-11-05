import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const log = process.argv[2];
const mode = process.argv[3];
const props = Object.fromEntries(['pid', 'window_id', 'max_elements', 'element_index', 'snapshot_id', 'button', 'delivery_mode', 'text', 'value', 'keys', 'key', 'direction', 'amount'].map(name => [name, name === 'delivery_mode' ? { type: 'string', enum: ['background'] } : {}]));
createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-cua', version: '1' } };
  else if (msg.method === 'tools/list') result = { tools: ['list_windows', 'get_window_state', 'click', 'type_text', 'hotkey', 'press_key', 'set_value', 'scroll'].map(name => ({ name, inputSchema: { type: 'object', properties: mode === 'missing-schema' && name === 'click' ? {} : props, required: [] } })) };
  else if (msg.method === 'tools/call') {
    if (log) appendFileSync(log, `${msg.params.name}\n`);
    if (mode === 'drop' && msg.params.name === 'click') { process.exit(0); }
    if (mode === 'hang' && msg.params.name === 'click') return;
    result = { structuredContent: { ok: true, label: '确定', secretPresent: Boolean(process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.NODE_OPTIONS), permissionMode: process.env.CUA_DRIVER_PERMISSION_MODE }, content: [{ type: 'image', data: 'AQID', mimeType: 'image/png' }] };
  } else result = {};
  const output = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
  const chinese = output.indexOf(Buffer.from('确'));
  if (mode === 'utf8' && chinese >= 0) {
    process.stdout.write(output.subarray(0, chinese + 1));
    setTimeout(() => process.stdout.write(output.subarray(chinese + 1)), 20);
  } else process.stdout.write(output);
});
