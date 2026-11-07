import '../helpers/isolated-home.mjs';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
let selected = null;
let status = 'unconfigured';
mock.module('../../dist/auth/service.js', { namedExports: {
  loadActiveProfile: async () => selected,
  inspectActiveConnection: async () => ({profile:selected,status}),
  resolveProfileCredential: async () => 'DESTINATION-VAULT-KEY',
} });
const { modelCommand } = await import('../../dist/commands/model.js');
const { buildGroupedModelPickerSpec } = await import('../../dist/tui/model-picker.js');
const { isProviderCredentialReady, resolveProviderApiKey } = await import('../../dist/providers/resolve-llm.js');
const { applyActiveAuthProfile } = await import('../../dist/config.js');
const { getProviderPreset } = await import('../../dist/providers/presets.js');
const account = {id:'attached',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'gpt-4o'};
function cleanEnv(t, values={}) {
  const old={...process.env};
  for(const key of Object.keys(process.env)) if(/^(QLING_|GROK_|OPENAI_|MIMO_|XAI_|MISTRAL_)/.test(key)) delete process.env[key];
  Object.assign(process.env,values);
  selected=null;status='unconfigured';
  t.after(()=>{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);});
}
function context(provider,endpoint,model='model') {
  const state={provider,endpoint,model,apiKey:'OLD-ORIGIN-KEY'}, patches=[], errors=[];
  let picker;
  return {state,patches,errors,get picker(){return picker;}, ctx:{
    agentLoop:{getProvider:()=>state.provider,getEndpoint:()=>state.endpoint,getModel:()=>state.model,getApiKey:()=>state.apiKey,getStartupProvider:()=>provider,getRuntimeRootDir:()=>'/synthetic',applyLlmSession:patch=>{patches.push(patch);Object.assign(state,patch);}},
    writeLine(){},writeError:s=>errors.push(s),openOptionPicker:s=>picker=s,
  }};
}
for (const [provider,endpoint,destination] of [
  ['openai','https://proxy.invalid/v1','openai'],
  ['mimo','https://api.xiaomimimo.com/v1','mimo-token-plan'],
  ['mimo','https://token-plan-cn.xiaomimimo.com/v1','mimo'],
]) test(`endpoint switch refuses old ${provider} credential from ${endpoint}`,async t=>{
  cleanEnv(t,{QLING_LLM_PROVIDER:provider,QLING_LLM_STARTUP_PROVIDER:provider,QLING_LLM_ENDPOINT:endpoint,QLING_LLM_API_KEY:'OLD-GENERIC', [provider==='openai'?'OPENAI_API_KEY':'MIMO_API_KEY']:'OLD-SPECIFIC'});
  const f=context(provider,endpoint);
  await modelCommand.execute(['use',destination],f.ctx);
  assert.equal(f.patches.length,0); assert.equal(f.state.endpoint,endpoint);assert.ok(f.errors.length);
});
test('switch permits only a positively identified destination key, including base path',async t=>{
  cleanEnv(t,{OPENAI_API_KEY:'OFFICIAL-KEY',OPENAI_BASE_URL:'https://api.openai.com/v1'});
  const f=context('openai','https://proxy.invalid/v1');
  await modelCommand.execute(['use','openai'],f.ctx);
  assert.equal(f.state.apiKey,'OFFICIAL-KEY');
  assert.equal(resolveProviderApiKey('openai',{OPENAI_API_KEY:'PROXY-KEY',OPENAI_BASE_URL:'https://proxy.invalid/tenant-a'},{endpoint:'https://proxy.invalid/tenant-b',currentProvider:'openai',currentEndpoint:'https://proxy.invalid/tenant-a',sessionApiKey:'PROXY-KEY',sameProvider:true}).refused,true);
});
test('duplicate account/API model rows have unique identity and dispatch exactly',async t=>{
  cleanEnv(t,{OPENAI_API_KEY:'API-KEY'});selected=account;status='ready';
  const f=context('chatgpt',account.endpoint,'gpt-4o');f.state.apiKey='qling-auth:attached';
  await modelCommand.execute([],f.ctx);
  const rows=f.picker.items.filter(i=>!i.section);
  assert.equal(new Set(rows.map(i=>i.id)).size,rows.length);
  const active=rows.find(i=>i.active);assert.ok(active);await f.picker.onPick(active);
  assert.equal(f.state.provider,'chatgpt');assert.equal(f.state.apiKey,'qling-auth:attached');
  const api=rows.find(i=>i.id.startsWith('openai:') && i.label==='gpt-4o');assert.ok(api);await f.picker.onPick(api);
  assert.equal(f.state.provider,'openai');assert.equal(f.state.apiKey,'API-KEY');
});
test('MiMo active row matches exact endpoint once',()=>{
  const endpoint=getProviderPreset('mimo-token-plan').endpoint;
  const spec=buildGroupedModelPickerSpec({currentProvider:'mimo',currentEndpoint:endpoint,currentModel:'mimo-v2.6-pro',env:{},callbacks:{applyModel(){},applyPreset(){},writeNotice(){},writeError(){}}});
  const active=spec.items.filter(i=>i.active);assert.equal(active.length,1);assert.match(active[0].id,/mimo-token-plan$/);
});
test('active account/detached/none overrides file key; explicit CLI override scopes credential',async t=>{
  cleanEnv(t);
  for(const p of [account,{...account,id:'detached'},{id:'none',provider:'ollama',method:'none',endpoint:'http://127.0.0.1:11434/v1',model:'local'}]) {
    selected=p;status=p.id==='detached'?'needs_login':'ready';
    const config={llm:{provider:'mistral',endpoint:'https://api.mistral.ai/v1',model:'old',api_key:'FILE-KEY'},runtime:{file_state_dir:'/synthetic'}};
    await applyActiveAuthProfile(config,{}, {},{provider:'file',endpoint:'file',model:'file',apiKey:'file'},[]);
    assert.equal(config.llm.provider,p.provider);assert.equal(config.llm.api_key,p.method==='none'?'':'qling-auth:'+p.id);
  }
  selected=account;status='needs_login';
  const config={llm:{provider:'mistral',endpoint:'https://api.mistral.ai/v1',model:'old',api_key:'FILE-KEY'},runtime:{file_state_dir:'/synthetic'}};
  await applyActiveAuthProfile(config,{provider:'mistral'}, {},{apiKey:'file'},[]);assert.equal(config.llm.api_key,'');
});
test('readiness uses matching local account/session/vault evidence and rejects markers',()=>{
  assert.equal(isProviderCredentialReady('chatgpt',{}).ready,false);
  const connection={profile:account,status:'needs_login'};
  assert.equal(isProviderCredentialReady('chatgpt',{}, {connection}).ready,false);
  connection.status='ready';assert.equal(isProviderCredentialReady('chatgpt',{}, {connection}).ready,true);
  assert.equal(isProviderCredentialReady('chatgpt',{}, {connection,endpoint:'https://custom.invalid/v1'}).ready,false);
  assert.equal(isProviderCredentialReady('mistral',{}, {endpoint:'https://api.mistral.ai/v1',currentProvider:'mistral',currentEndpoint:'https://api.mistral.ai/v1',sessionApiKey:'SESSION-KEY'}).ready,true);
  assert.equal(isProviderCredentialReady('openai',{OPENAI_API_KEY:'qling-auth:account'}).ready,false);
  assert.equal(isProviderCredentialReady('mistral',{}, {connection:{status:'ready',profile:{...account,provider:'mistral',method:'api_key',endpoint:'https://api.mistral.ai/v1'}}}).ready,true);
  assert.equal(isProviderCredentialReady('ollama',{}).ready,true);
  assert.equal(isProviderCredentialReady('unknown',{}).ready,false);
});
test('default state honors saved none under inherited test flags in isolated home',async()=>{
  for(const flags of [{},{NODE_ENV:'test',NODE_TEST_CONTEXT:'child-v8'},{QLING_TEST_EXEC_ARGV:'true'}]) {
    const dir=await mkdtemp(join(tmpdir(),'qling-auth-default-'));
    const script=`import {createAuthService} from ${JSON.stringify(new URL('../../dist/auth/service.js',import.meta.url).href)}; import {loadQlingConfig} from ${JSON.stringify(new URL('../../dist/config.js',import.meta.url).href)}; await createAuthService().saveConnection(${JSON.stringify(join(dir,'.qling'))},{id:'none',provider:'ollama',method:'none',endpoint:'http://127.0.0.1:11434/v1',model:'local'}); const r=await loadQlingConfig({},{}); if(r.config.llm.provider!=='ollama'||r.config.llm.api_key!=='') process.exit(9);`;
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC'].includes(k)));
    const scriptPath=join(dir,'default-path.test.mjs');await writeFile(scriptPath,script);
    const args=flags.QLING_TEST_EXEC_ARGV?['--test',scriptPath]:['--input-type=module','-e',script];
    const result=spawnSync(process.execPath,args,{env:{...env,HOME:dir,USERPROFILE:dir,...flags},cwd:dir,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);
  }
});
test('Grok headers cover injected pending discovery, active discovery and inference',async t=>{
  cleanEnv(t,{GROK_CLI_VERSION:'9.8.7'});
  selected={id:'grok',provider:'grok-account',method:'grok_cli_session',endpoint:'https://cli-chat-proxy.grok.com/v1',model:'grok-build'};status='ready';
  const {listPendingAccountModels}=await import('../../dist/cli/auth-models.js');
  const {listRemoteModels}=await import('../../dist/providers/remote-models.js');
  const {LlmHttpClient}=await import('../../dist/providers/llm-client.js');
  function check(headers){const h=new Headers(headers);assert.equal(h.get('x-grok-client-version'),'9.8.7');assert.equal(h.get('x-grok-client-identifier'),'grok-shell');assert.equal(h.get('User-Agent'),'xai-grok-cli');assert.equal(h.get('X-XAI-Token-Auth'),'xai-grok-cli');assert.ok(h.get('Authorization').startsWith('Bearer '));}
  const fetchImpl=async(url,options)=>{check(options.headers);return {ok:true,json:async()=>({data:[{id:'grok-build'}]})};};
  assert.equal((await listPendingAccountModels(selected,undefined,{fetchImpl,readGrok:async()=>({accessToken:'SYNTHETIC',expiresAt:Date.now()+600000})})).ok,true);
  assert.equal((await listRemoteModels({provider:selected.provider,endpoint:selected.endpoint,authStateDir:'/synthetic',apiKey:'qling-auth:grok',fetchImpl})).ok,true);
  const client=new LlmHttpClient({provider:selected.provider,endpoint:selected.endpoint,authStateDir:'/synthetic',apiKey:'qling-auth:grok',timeoutMs:1000});
  client.client.defaults.adapter=async config=>{check(config.headers);return {status:200,headers:{'content-type':'text/event-stream'},config,data:Readable.from([Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:'ok'}}]})+'\n\ndata: [DONE]\n\n')])};};
  await client.chatCompletions({model:'grok-build',systemPrompt:'test',messages:[{role:'user',content:'test'}],tools:[]});
});

test('real proxy OpenAI to attached ChatGPT to OpenAI refuses original generic proxy key',async t=>{
  cleanEnv(t,{QLING_LLM_PROVIDER:'openai',QLING_LLM_STARTUP_PROVIDER:'openai',QLING_LLM_ENDPOINT:'https://proxy.invalid/tenant',QLING_LLM_API_KEY:'ORIGINAL-PROXY-KEY',QLING_MEMORY_WAL_ENABLED:'false'});
  const {AgentLoop}=await import('../../dist/agent-loop.js');
  const dir=await mkdtemp(join(tmpdir(),'qling-origin-transitions-'));
  const agent=new AgentLoop({provider:'openai',endpoint:'https://proxy.invalid/tenant',apiKey:'ORIGINAL-PROXY-KEY',model:'proxy-model',runtime:{fileStateDir:dir}});t.after(()=>agent.shutdown());
  selected=account;status='ready';const errors=[];
  const ctx={agentLoop:agent,writeLine(){},writeError:s=>errors.push(s)};
  await modelCommand.execute(['use','chatgpt'],ctx);assert.equal(agent.getProvider(),'chatgpt');
  await modelCommand.execute(['use','openai'],ctx);assert.equal(agent.getProvider(),'chatgpt');assert.ok(errors.length);
  process.env.OPENAI_BASE_URL='https://api.openai.com/v1';
  await modelCommand.execute(['use','openai'],ctx);assert.equal(agent.getProvider(),'chatgpt');
  process.env.OPENAI_API_KEY='INDEPENDENT-OFFICIAL-KEY';
  await modelCommand.execute(['use','openai'],ctx);assert.equal(agent.getProvider(),'openai');assert.equal(agent.getApiKey(),'INDEPENDENT-OFFICIAL-KEY');
});
test('actual endpoint-only AgentLoop patch clears bearer for key-free target and refuses keyed target',async t=>{
  cleanEnv(t,{QLING_MEMORY_WAL_ENABLED:'false'});
  const {AgentLoop}=await import('../../dist/agent-loop.js');const dir=await mkdtemp(join(tmpdir(),'qling-endpoint-only-'));
  const agent=new AgentLoop({provider:'openai',endpoint:'https://proxy.invalid/tenant',apiKey:'SYNTHETIC-OLD-KEY',model:'m',runtime:{fileStateDir:dir}});t.after(()=>agent.shutdown());
  agent.applyLlmSession({endpoint:'http://127.0.0.1:11434/v1'});
  agent.llmClient.client.defaults.adapter=async config=>{assert.equal(config.headers.get('Authorization'),undefined);return {status:200,headers:{},config,data:{choices:[{message:{content:'ok'}}]}};};
  await agent.llmClient.chatCompletions({model:'m',systemPrompt:'test',messages:[{role:'user',content:'test'}],tools:[]});
  assert.throws(()=>agent.applyLlmSession({endpoint:'https://api.openai.com/v1'}),/credential/);
  assert.throws(()=>agent.applyLlmSession({endpoint:'https://api.openai.com/v1',apiKey:''}),/credential/);
  assert.throws(()=>agent.applyLlmSession({provider:'mistral',endpoint:'https://api.mistral.ai/v1'}),/credential/);assert.equal(agent.getEndpoint(),'http://127.0.0.1:11434/v1');
});
test('same-target CLI/session key wins; destination env precedes vault; managed is revalidated',async t=>{
  cleanEnv(t,{MISTRAL_API_KEY:'ENV-KEY'});
  selected={id:'vault',provider:'mistral',method:'api_key',endpoint:'https://api.mistral.ai/v1',model:'codestral-latest'};status='ready';
  const live=context('mistral',selected.endpoint);live.state.apiKey='EXPLICIT-CLI-KEY';
  await modelCommand.execute(['use','mistral'],live.ctx);assert.equal(live.state.apiKey,'EXPLICIT-CLI-KEY');
  const cross=context('deepseek','https://api.deepseek.com');await modelCommand.execute(['use','mistral'],cross.ctx);assert.equal(cross.state.apiKey,'ENV-KEY');
  delete process.env.MISTRAL_API_KEY;const vault=context('deepseek','https://api.deepseek.com');await modelCommand.execute(['use','mistral'],vault.ctx);assert.equal(vault.state.apiKey,'DESTINATION-VAULT-KEY');
  selected=account;status='needs_login';const detached=context('chatgpt',account.endpoint);detached.state.apiKey='qling-auth:attached';await modelCommand.execute(['use','chatgpt'],detached.ctx);assert.equal(detached.patches.length,0);
});
test('plaintext all-provider output shares exact active endpoint and readiness evidence',async t=>{
  cleanEnv(t);
  const p=getProviderPreset('mimo-token-plan'),f=context('mimo',p.endpoint,p.model),lines=[];delete f.ctx.openOptionPicker;f.ctx.writeLine=s=>lines.push(s);
  await modelCommand.execute(['list','--all'],f.ctx);assert.equal(lines.filter(s=>s.startsWith('✔')).length,1);
  const local=context('openai','http://localhost:11434/v1');local.state.apiKey='local';const statusLines=[];local.ctx.writeLine=s=>statusLines.push(s);
  await modelCommand.execute(['status'],local.ctx);assert.match(statusLines.join('\n'),/免Key/);
  const {formatGroupedModelPickerLines}=await import('../../dist/tui/model-picker.js');
  const text=formatGroupedModelPickerLines('chatgpt','gpt-4o',{}, {currentEndpoint:account.endpoint,connection:{profile:account,status:'ready'}}).join('\n');assert.match(text,/本地账号就绪/);
});
