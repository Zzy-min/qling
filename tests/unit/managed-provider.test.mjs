import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
let profile = null, token = 'synthetic-secret', refreshes=0, failRefresh=false;
mock.module('../../dist/auth/service.js', { namedExports: {
 loadActiveProfile: async () => profile,
 resolveProfileCredential: async (_dir,_profile,options) => {if(options?.rejectedAccessToken){refreshes++;if(failRefresh)throw Error('refresh denied');token='refreshed-secret';}return token;},
}});
const { LlmHttpClient, ProviderHttpError } = await import('../../dist/providers/llm-client.js');
const { loadQlingConfig } = await import('../../dist/config.js');
const { getProviderPreset, listProviderPresets } = await import('../../dist/providers/presets.js');
const { resolveProviderApiKey } = await import('../../dist/providers/resolve-llm.js');
const endpoint = 'https://api.openai.com/v1';
function client(provider = 'chatgpt', target = endpoint, key = 'qling-auth:test') {
 profile = {id:'test',provider,endpoint:target,method:provider==='chatgpt'?'chatgpt_oauth':'grok_cli_session',model:'test-model'};
 const c = new LlmHttpClient({provider,endpoint:target,apiKey:key,authStateDir:'synthetic-only',timeoutMs:500});
 return c;
}
const input = {model:'test-model', systemPrompt:'system rules',messages:[{role:'user',content:'read it'}],tools:[{name:'read',description:'read',parameters:{type:'object',properties:{}}}]};
function fixture(c, events, capture = () => {}) {
 c.client.defaults.adapter = async config => {
 capture(config);
 const s = events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
 return {status:200,headers:{'content-type':'text/event-stream'},data:Readable.from([...Buffer.from(s)].map(b=>Buffer.from([b]))),config};
 };
}
test('Responses namespace tools, full history, call IDs, chunked deltas and usage', async () => {
 const c = client(); const requests=[];
 const call={type:'function_call',id:'fc_1',call_id:'call_1',namespace:'qling',name:'read',arguments:'{"path":"x"}'};
 fixture(c,[{type:'response.output_item.added',output_index:0,item:{...call,arguments:''}},{type:'response.function_call_arguments.delta',item_id:'fc_1',delta:'{"path":'},{type:'response.function_call_arguments.delta',item_id:'fc_1',delta:'"x"}'},{type:'response.output_item.done',item:call},{type:'response.completed',response:{output:[call],usage:{input_tokens:10,output_tokens:3}}}], cfg=>requests.push(JSON.parse(cfg.data)));
 const result = await c.chatCompletions(input);
 assert.equal(result.tool_calls[0].id,'call_1'); assert.equal(result.tool_calls[0].function.arguments,call.arguments);
 assert.equal(result.usage.promptTokens,10);
 await c.chatCompletions({...input,messages:[...input.messages,{role:'assistant',content:'',tool_calls:result.tool_calls},{role:'tool',tool_call_id:'call_1',content:'file contents'}],overrides:{temperature:1,max_tokens:12}});
 const p = requests[1]; assert.equal(p.store,false); assert.equal(p.stream,true);assert.equal(p.instructions,'system rules');
 assert.equal(p.tools[0].type,'namespace'); assert.equal(p.tools[0].name,'qling');
 assert.deepEqual(p.input.slice(1),[{type:'function_call',call_id:'call_1',namespace:'qling',name:'read',arguments:call.arguments},{type:'function_call_output',call_id:'call_1',output:'file contents'}]);
 assert.equal(p.temperature,undefined); assert.equal(p.max_tokens,undefined);
});
for (const type of ['response.failed','response.incomplete','error','interrupted']) test(`Responses rejects ${type} even after text`, async()=>{
 const c=client();fixture(c,[{type:'response.output_text.delta',delta:'partial'},...(type==='interrupted'?[]:[{type}])]);
 await assert.rejects(c.chatCompletions(input), e=>e instanceof ProviderHttpError);
});
test('managed endpoint and reserved marker fail before HTTP',async()=>{
 for (const [provider,target,key] of [['chatgpt','https://evil.invalid','qling-auth:test'],['openai',endpoint,'qling-auth:test'],['chatgpt',endpoint,'ordinary-key']]) {
 const c=client(provider,target,key);let sent=false; fixture(c,[],()=>sent=true);
 await assert.rejects(c.chatCompletions(input),e=>e instanceof ProviderHttpError && e.code==="needs_login" && e.retriable===false);assert.equal(sent,false);
 }
});
test('Grok account forces streaming and official auth headers',async()=>{
 const c=client('grok-account','https://cli-chat-proxy.grok.com/v1');let seen;
 fixture(c,[{choices:[{delta:{content:'ok'},finish_reason:'stop'}]}],x=>seen=x);
 const r=await c.chatCompletions(input);assert.equal(r.content,'ok');assert.equal(JSON.parse(seen.data).stream,true);
 assert.equal(seen.headers.Authorization,'Bearer synthetic-secret');assert.equal(seen.headers['X-XAI-Token-Auth'],'xai-grok-cli');assert.equal(seen.headers['x-grok-model-override'],'test-model');
});
test('active profile replaces stale env but explicit provider remains isolated',async()=>{
 profile={id:'test',provider:'chatgpt',method:'chatgpt_oauth',endpoint,model:'account-model'};
 const env={QLING_FILE_STATE_DIR:'synthetic-only',QLING_LLM_PROVIDER:'deepseek',DEEPSEEK_API_KEY:'old'};
 let r=await loadQlingConfig({},env);assert.equal(r.config.llm.provider,'chatgpt');assert.equal(r.config.llm.api_key,'qling-auth:test');
 r=await loadQlingConfig({provider:'xai'},env);assert.equal(r.config.llm.provider,'xai');assert.equal(r.config.llm.api_key,'');
 await assert.rejects(loadQlingConfig({endpoint:'https://evil.invalid'},env));
});
test('xAI API key is scoped and account presets excluded from numbered key menu',()=>{
 assert.equal(getProviderPreset('xai').endpoint,'https://api.x.ai/v1');assert.ok(getProviderPreset('chatgpt'));assert.ok(getProviderPreset('grok-account'));
 assert.ok(!listProviderPresets().some(p=>p.id==='chatgpt'||p.id==='grok-account'));
 assert.equal(resolveProviderApiKey('xai',{XAI_API_KEY:'x'}).apiKey,'x');assert.equal(resolveProviderApiKey('openai',{XAI_API_KEY:'x'}).apiKey,'');
});

test('managed models resolve account credentials and never forward markers or redirects',async()=>{
 const {listRemoteModels}=await import('../../dist/providers/remote-models.js');
 profile={id:'test',provider:'chatgpt',method:'chatgpt_oauth',endpoint,model:'account-model'};
 let calls=0;
 const fetchImpl=async(url,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer synthetic-secret');assert.equal(options.redirect,'error');return {ok:true,json:async()=>({data:[{id:'available'}]})};};
 assert.equal((await listRemoteModels({endpoint,provider:'chatgpt',apiKey:'qling-auth:test',authStateDir:'synthetic-only',fetchImpl})).ok,true);
 assert.equal((await listRemoteModels({endpoint:'https://evil.invalid',provider:'chatgpt',apiKey:'qling-auth:test',authStateDir:'synthetic-only',fetchImpl})).ok,false);
 assert.equal(calls,1);
});
test('Responses cancellation destroys a stalled stream',async()=>{
 const c=client();const abort=new AbortController();let destroyed=false;
 c.client.defaults.adapter=async config=>({status:200,headers:{'content-type':'text/event-stream'},config,data:{[Symbol.asyncIterator](){return {next:()=>new Promise(()=>{})};},destroy(){destroyed=true;}}});
 const running=c.chatCompletions({...input,signal:abort.signal});setTimeout(()=>abort.abort(),10);
 await assert.rejects(running,e=>e.name==='AgentRunCanceledError');assert.equal(destroyed,true);
});
test('API profiles use provider env then vault, never another provider key',async()=>{
 profile={id:'test',provider:'xai',method:'api_key',endpoint:'https://api.x.ai/v1',model:'grok'};
 let result=await loadQlingConfig({},{QLING_FILE_STATE_DIR:'synthetic-only',OPENAI_API_KEY:'foreign',XAI_API_KEY:'own'});
 assert.equal(result.config.llm.api_key,'own');
 token='vault-key';result=await loadQlingConfig({},{QLING_FILE_STATE_DIR:'synthetic-only',OPENAI_API_KEY:'foreign'});assert.equal(result.config.llm.api_key,'vault-key');token='synthetic-secret';
});

test('managed provider errors redact echoed account token and omit credential-bearing cause',async()=>{
 const c=client('grok-account','https://cli-chat-proxy.grok.com/v1');
 fixture(c,[{error:{message:'Rejected synthetic-secret',status:401,code:'invalid_token'}}]);
 await assert.rejects(c.chatCompletions(input),e=>e instanceof ProviderHttpError && !e.message.includes('synthetic-secret') && !e.cause);
});
test('Responses final completed text succeeds, unknown namespace fails',async()=>{
 const c=client();fixture(c,[{type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:'final'}]}]}}]);
 assert.equal((await c.chatCompletions(input)).content,'final');
 fixture(c,[{type:'response.completed',response:{output:[{type:'function_call',id:'i',call_id:'c',namespace:'foreign',name:'read',arguments:'{}'}]}}]);
 await assert.rejects(c.chatCompletions(input));
});

for (const second401 of [false,true]) test(`ChatGPT retries HTTP 401 once only (second401=${second401})`,async()=>{
 token='synthetic-secret';refreshes=0;const c=client();let sent=0;
 c.client.defaults.adapter=async config=>{sent++;if(sent===1||second401)throw Object.assign(Error('unauthorized'),{config,response:{status:401,data:{error:{code:'invalid_token'}}}});return {status:200,config,headers:{'content-type':'text/event-stream'},data:Readable.from([Buffer.from('data: {"type":"response.completed","response":{"output":[]}}\n\n')])};};
 if(second401)await assert.rejects(c.chatCompletions(input),e=>e.status===401);else await c.chatCompletions(input);
 assert.equal(sent,2);assert.equal(refreshes,1);token='synthetic-secret';
});
test('ChatGPT failed refresh never retries or changes billing mode',async()=>{
 token='synthetic-secret';refreshes=0;failRefresh=true;const c=client();let sent=0;
 c.client.defaults.adapter=async config=>{sent++;throw Object.assign(Error('unauthorized'),{config,response:{status:401,data:{}}});};
 await assert.rejects(c.chatCompletions(input));assert.equal(sent,1);assert.equal(refreshes,1);failRefresh=false;
});

test('ChatGPT model directory uses visible model slugs without inventing entitlement',async()=>{
 const {listRemoteModels}=await import('../../dist/providers/remote-models.js');
 profile={id:'test',provider:'chatgpt',method:'chatgpt_oauth',endpoint,model:'account-model'};
 const result=await listRemoteModels({endpoint,provider:'chatgpt',apiKey:'qling-auth:test',authStateDir:'synthetic-only',fetchImpl:async()=>({ok:true,json:async()=>({models:[{slug:'available',display_name:'Friendly',visibility:'list'},{slug:'hidden',visibility:'hidden'},{slug:'unknown'},{slug:'available',visibility:'list'}]})})});
 assert.deepEqual(result.models,['available']);assert.equal(result.ok,true);
});
test('Responses SSE quota/auth errors preserve status/code without refresh replay',async()=>{
 token='synthetic-secret';refreshes=0;const c=client();let sent=0;
 fixture(c,[{type:'response.failed',response:{error:{code:'insufficient_quota',message:'quota',status:429}}}],()=>sent++);
 await assert.rejects(c.chatCompletions(input),e=>e.code==='insufficient_quota'&&e.status===429);
 assert.equal(sent,1);assert.equal(refreshes,0);
});

test('account presets require credentials even if configured with a local endpoint',async()=>{
 const {apiKeyRequiredForEndpoint}=await import('../../dist/providers/presets.js');
 assert.equal(apiKeyRequiredForEndpoint('http://localhost:1234','chatgpt'),true);
});
test('Responses consumes Unicode final frame without delimiter and enforces idle timeout',async()=>{
 const c=client();
 const frame=Buffer.from('data: '+JSON.stringify({type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:'你好'}]}]}}));
 c.client.defaults.adapter=async config=>({status:200,config,headers:{'content-type':'text/event-stream'},data:Readable.from([...frame].map(b=>Buffer.from([b])))});
 assert.equal((await c.chatCompletions(input)).content,'你好');
 const previous=process.env.QLING_LLM_STREAM_IDLE_MS;process.env.QLING_LLM_STREAM_IDLE_MS='20';
 try {c.client.defaults.adapter=async config=>({status:200,config,headers:{'content-type':'text/event-stream'},data:{[Symbol.asyncIterator](){return {next:()=>new Promise(()=>{})};},destroy(){}}});
 await assert.rejects(c.chatCompletions(input),e=>e.code==='stream_interrupted');
 }finally{if(previous===undefined)delete process.env.QLING_LLM_STREAM_IDLE_MS;else process.env.QLING_LLM_STREAM_IDLE_MS=previous;}
});

for (const terminal of ['failed','interrupted']) test(`outer model retry never replays partial managed SSE (${terminal})`,async()=>{
 const {callModelWithRetry,resolveModelRetryPolicy}=await import('../../dist/providers/model-retry.js');
 const c=client();let sent=0;const deltas=[];
 fixture(c,[{type:'response.output_text.delta',delta:'partial'},...(terminal==='failed'?[{type:'response.failed',response:{error:{code:'server_error'}}}]:[])],()=>sent++);
 await assert.rejects(callModelWithRetry({models:['test-model','backup'],policy:{...resolveModelRetryPolicy({}),maxRetries:1},sleep:async()=>{},call:()=>c.chatCompletions({...input,onTextDelta:d=>deltas.push(d)})}),e=>e.nonReplayable===true && e.retriable===false);
 assert.equal(sent,1);assert.deepEqual(deltas,['partial']);
});
for (const trailing of ['pending','error']) test(`Responses completed closes immediately before trailing ${trailing}`,async()=>{
 const c=client();let destroyed=false,nextCalls=0;
 const final=Buffer.from('data: '+JSON.stringify({type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:'complete'}]}]}})+'\n\n');
 c.client.defaults.adapter=async config=>({status:200,config,headers:{'content-type':'text/event-stream'},data:{[Symbol.asyncIterator](){return {next:async()=>{nextCalls++;if(nextCalls===1)return {done:false,value:final};if(trailing==='error')throw Error('after completion');return new Promise(()=>{});}};},destroy(){destroyed=true;}}});
 const old=process.env.QLING_LLM_STREAM_IDLE_MS;process.env.QLING_LLM_STREAM_IDLE_MS='20';
 try {assert.equal((await c.chatCompletions(input)).content,'complete');assert.equal(nextCalls,1);assert.equal(destroyed,true);}
 finally{if(old===undefined)delete process.env.QLING_LLM_STREAM_IDLE_MS;else process.env.QLING_LLM_STREAM_IDLE_MS=old;}
});

test('outer model retry preserves Grok partial-stream terminal boundary',async()=>{
 const {callModelWithRetry,resolveModelRetryPolicy}=await import('../../dist/providers/model-retry.js');
 const c=client('grok-account','https://cli-chat-proxy.grok.com/v1');let sent=0;const deltas=[];
 fixture(c,[{choices:[{delta:{content:'partial'}}]},{error:{message:'server',status:500,code:'server_error'}}],()=>sent++);
 await assert.rejects(callModelWithRetry({models:['test-model','backup'],policy:{...resolveModelRetryPolicy({}),maxRetries:1},sleep:async()=>{},call:()=>c.chatCompletions({...input,onTextDelta:d=>deltas.push(d)})}),e=>e.nonReplayable===true && e.retriable===false);
 assert.equal(sent,1);assert.deepEqual(deltas,['partial']);
});
