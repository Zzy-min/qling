import type { AxiosInstance } from 'axios';
import type { Message, ToolDefinition, RawToolCall } from '../types.js';
import { extractProviderUsage } from '../token-usage.js';
import type { LlmChatResponse, LlmStreamCallbacks } from './llm-client.js';
import { resolveStreamIdleMs } from './model-retry.js';

export function responsesPayload(input: { model: string; systemPrompt: string; messages: Message[]; tools: ToolDefinition[] }): Record<string, unknown> {
  const history: Record<string, unknown>[] = [];
  for (const message of input.messages) {
    if (message.role === 'tool') {
      history.push({ type: 'function_call_output', call_id: message.tool_call_id, output: message.content });
      continue;
    }
    if (message.content) history.push({ role: message.role === 'system' ? 'developer' : message.role, content: message.content });
    for (const call of message.tool_calls ?? []) history.push({ type: 'function_call', call_id: call.id, namespace: 'qling', name: call.function.name, arguments: call.function.arguments });
  }
  return {
    model: input.model, instructions: input.systemPrompt, input: history, store: false, stream: true,
    ...(input.tools.length ? { tools: [{ type: 'namespace', name: 'qling', description: 'Qling local tools', tools: input.tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
  };
}

type Item = { type?: string; id?: string; call_id?: string; name?: string; namespace?: string; arguments?: string; content?: Array<{ type?: string; text?: string }> };
/** SSE adapter: only response.completed commits a successful Qling turn. */
export async function streamResponses(client: AxiosInstance, payload: Record<string, unknown>, input: { signal?: AbortSignal } & LlmStreamCallbacks): Promise<LlmChatResponse> {
  const response = await client.post('/responses', payload, { responseType: 'stream', signal: input.signal });
  if (!String(response.headers['content-type']).includes('text/event-stream')) throw Object.assign(Error('Responses requires SSE'), { code: 'invalid_stream' });
  const stream = response.data as AsyncIterable<Uint8Array> & { destroy?: () => void };
  const decoder = new TextDecoder();
  let buffer = '', content = '', completed = false, usage: LlmChatResponse['usage'];
  const calls = new Map<string, Item>(); const indexes = new Map<number, string>();
  const merge = (item: Item, index?: number) => {
    if (item.type !== 'function_call') return;
    const id = item.id ?? (index !== undefined ? indexes.get(index) : undefined);
    if (!id) throw Error('Function call item has no id');
    calls.set(id, { ...calls.get(id), ...item });
    if (index !== undefined) indexes.set(index, id);
  };
  const consume = (frame: string) => {
    const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (['response.failed', 'response.incomplete', 'error', 'response.error'].includes(event.type)) throw Object.assign(Error('Responses did not complete'), { code: event.response?.error?.code ?? event.error?.code ?? event.code ?? event.type, status: event.response?.error?.status ?? event.error?.status ?? event.status });
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      content += event.delta; try { input.onTextDelta?.(event.delta); } catch {/* rendering is best effort */ }
    }
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') merge(event.item, event.output_index);
    if (event.type === 'response.function_call_arguments.delta') {
      const id = event.item_id ?? indexes.get(event.output_index); const call = calls.get(id);
      if (!call) throw Error('Unknown function call delta');
      call.arguments = (call.arguments ?? '') + event.delta;
    }
    if (event.type === 'response.completed') {
      if (event.response?.status && event.response.status !== 'completed') throw Error('Responses did not complete');
      for (const item of event.response?.output ?? []) merge(item);
      if (!content) content = (event.response?.output ?? []).flatMap((i: Item) => i.content ?? []).filter((c: { type?: string }) => c.type === 'output_text').map((c: { text?: string }) => c.text ?? '').join('');
      usage = extractProviderUsage(event.response?.usage); completed = true;
    }
  };
  const iterator = stream[Symbol.asyncIterator]();
  const idleMs = resolveStreamIdleMs();
  try {
    while (true) {
      const next = await nextChunk(iterator, stream, input.signal, idleMs);
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 8 * 1024 * 1024 || content.length > 16 * 1024 * 1024 || [...calls.values()].reduce((n, c) => n + (c.arguments?.length ?? 0), 0) > 8 * 1024 * 1024) throw Error('Responses stream exceeds limit');
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (completed) break;
      }
      if (completed) break;
    }
    if (!completed) {
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer.replace(/\r\n/g, '\n'));
    }
    if (!completed) throw Object.assign(Error('Responses stream interrupted before completed'), { code: 'stream_interrupted' });
    const tool_calls: RawToolCall[] = [];
    for (const call of calls.values()) {
      if (call.namespace && call.namespace !== 'qling') throw Error('Unsupported function namespace');
      if (!call.call_id || !call.name) throw Error('Incomplete function call');
      tool_calls.push({ id: call.call_id, type: 'function', function: { name: call.name, arguments: call.arguments ?? '' } });
    }
    return { content, usage, streamed: true, finishReason: tool_calls.length ? 'tool_calls' : 'stop', ...(tool_calls.length ? { tool_calls } : {}) };
  } catch (error) {
    // An accepted account SSE turn must never be replayed by the outer retry loop.
    throw Object.assign(error instanceof Error ? error : Error('Responses stream failed'), { nonReplayable: true });
  } finally { stream.destroy?.(); }
}
function nextChunk(iterator: AsyncIterator<Uint8Array>, stream: { destroy?: () => void }, signal: AbortSignal | undefined, idleMs: number): Promise<IteratorResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let done = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => { if (done) return; done = true; if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(); };
    const abort = () => finish(() => { stream.destroy?.(); reject(Object.assign(Error('LLM request canceled'), { name: 'AgentRunCanceledError' })); });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (idleMs) timer = setTimeout(() => finish(() => { stream.destroy?.(); reject(Object.assign(Error('Responses stream idle timeout'), { code: 'stream_interrupted' })); }), idleMs);
    iterator.next().then(v => finish(() => resolve(v)), e => finish(() => reject(e)));
  });
}
