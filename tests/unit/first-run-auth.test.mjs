import test from 'node:test';
import assert from 'node:assert/strict';
import { runConnectionWizard, shouldRunFirstRunSetup } from '../../dist/cli/setup.js';
const config = (provider='openai',api_key='') => ({llm:{provider,api_key,endpoint:'https://api.openai.com/v1',model:'gpt-test'},runtime:{file_state_dir:'/unused'}});
function fixture(answers){const output=[],calls=[]; return {output,calls, options:{stateDir:'/unused',isTTY:true,prompt:{ask:async(label,options)=>{calls.push({label,options});return answers.shift() ?? null;},write:s=>output.push(s),close(){}},services:{listModels:async()=>({ok:false,models:[]}),openBrowser:async()=>{},saveConnection:async(...args)=>calls.push({saved:args}),markComplete:async()=>calls.push({marked:true})}}};}
test('first run uses selected provider readiness and skips no TTY / JSON',async()=>{assert.equal(await shouldRunFirstRunSetup(config(),{isTTY:true}),true);assert.equal(await shouldRunFirstRunSetup(config('openai','key'),{isTTY:true}),false);assert.equal(await shouldRunFirstRunSetup(config('ollama'),{isTTY:true}),false);assert.equal(await shouldRunFirstRunSetup(config(),{isTTY:false}),false);assert.equal(await shouldRunFirstRunSetup(config(),{isTTY:true,json:true}),false);});
test('API wizard hides key and atomically saves profile then marks complete',async()=>{const f=fixture(['3','1','','secret-test','','y']);const result=await runConnectionWizard(f.options);assert.equal(result.status,'saved');assert.equal(f.calls.find(x=>x.options?.secret).label.includes('Key'),true);const saved=f.calls.find(x=>x.saved).saved;assert.equal(saved[2].apiKey,'secret-test');assert.equal(saved[1].method,'api_key');assert.equal(f.calls.at(-1).marked,true);assert.doesNotMatch(f.output.join(' '),/secret-test/);});
test('local wizard does not ask for key; cancellation does not persist',async()=>{const f=fixture(['4','','','llama-test','y']);assert.equal((await runConnectionWizard(f.options)).status,'saved');assert.equal(f.calls.some(x=>x.options?.secret),false);const c=fixture(['3',null]);assert.equal((await runConnectionWizard(c.options)).status,'cancelled');assert.equal(c.calls.some(x=>x.saved||x.marked),false);});
test('account choices precede API; model remains explicitly unverified',async()=>{const f=fixture(['1','custom-model','y']);f.options.services.loginChatGpt=async()=>({profile:{id:'fake',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'default'},credential:{accessToken:'fake'}});const result=await runConnectionWizard(f.options);assert.equal(result.profile.model,'custom-model');assert.match(f.output.join(' '),/尚未验证/);assert.match(f.output[0],/ChatGPT.*Grok.*API/s);});
test('save failure and declined summary leave completion marker untouched',async()=>{const f=fixture(['4','','','llama-test','y']);f.options.services.saveConnection=async()=>{throw Error('disk');};await assert.rejects(runConnectionWizard(f.options),/保存失败/);assert.equal(f.calls.some(x=>x.marked),false);const c=fixture(['4','','','llama-test','n']);assert.equal((await runConnectionWizard(c.options)).status,'cancelled');assert.equal(c.calls.some(x=>x.saved||x.marked),false);});
test('pending account catalog is selected before activation and cancellation keeps old connection',async()=>{const f=fixture(['1','2','n']);let catalog=0;f.options.services.loginChatGpt=async()=>({profile:{id:'pending',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'default'},credential:{accessToken:'pending-secret'}});f.options.services.listModels=async(profile,credential)=>{catalog++;assert.equal(credential.accessToken,'pending-secret');assert.equal(f.calls.some(x=>x.saved),false);return {ok:true,models:['account-a','account-b']};};const result=await runConnectionWizard(f.options);assert.equal(result.status,'cancelled');assert.equal(catalog,1);assert.match(f.output.join(' '),/account-a/);assert.equal(f.calls.some(x=>x.saved),false);});
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTerminalPrompt } from '../../dist/cli/setup.js';
import { prepareStartupConnection } from '../../dist/cli/first-run.js';
import { loadQlingConfig } from '../../dist/config.js';
import { createAuthService } from '../../dist/auth/service.js';
import { listPendingAccountModels } from '../../dist/cli/auth-models.js';
import { parseCliArgs } from '../../dist/cli/startup-contract.js';
import { withDefaultWriters } from '../../dist/slash-context.js';
import { loginCommand, logoutCommand, authCommand } from '../../dist/commands/auth.js';
import { StreamingREPL } from '../../dist/tui/streaming-repl.js';
import { Repl } from '../../dist/repl.js';
const cipher={encrypt:async x=>x,decrypt:async x=>x};
test('hidden input handles paste/backspace/cancel and restores prior raw mode/listeners',async()=>{
 for(const [value,answer,raw] of [['ab\x7fc\r','ac',false],['\x1b[200~secret-paste\x1b[201~\r','secret-paste',true],['hidden\x03',null,false],['\x1b',null,true]]){
  const stream=new PassThrough();stream.isTTY=true;stream.isRaw=raw;stream.setRawMode=v=>{stream.isRaw=v;};let out='';const prompt=createTerminalPrompt(stream,{write:s=>out+=s});
  const pending=prompt.ask('Key: ',{secret:true});stream.write(value);assert.equal(await pending,answer);assert.equal(stream.isRaw,raw);assert.equal(stream.listenerCount('data'),0);assert.equal(out,'Key: \n');
 }
});
test('startup reloads saved profile in same process without replacing dotenv/advanced switches or using another provider key',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'qling-first-run-'));await writeFile(join(dir,'.env'),'KEEP_ADVANCED=true\n');await writeFile(join(dir,'.onboarded'),'old-card');
 const cli={fileStateDir:dir};const env={QLING_LLM_PROVIDER:'openai',DEEPSEEK_API_KEY:'other-provider-secret'};
 const initial=await loadQlingConfig(cli,env);assert.equal(initial.config.llm.api_key,'');const order=[];
 const f=fixture(['4','','','same-process-model','y']);f.options.stateDir=dir;delete f.options.services.saveConnection;delete f.options.services.markComplete;
 const result=await prepareStartupConnection({mode:'chat',isTTY:true,loaded:initial,cli,
 wizard:async options=>{order.push('wizard');assert.equal(options.stateDir,dir);return runConnectionWizard(f.options);},
 load:async options=>{order.push('reload');return loadQlingConfig(options,env);}});
 assert.deepEqual(order,['wizard','reload']);assert.equal(result.status,'ready');assert.equal(result.loaded.config.llm.provider,'ollama');assert.equal(result.loaded.config.llm.model,'same-process-model');assert.equal(await readFile(join(dir,'.env'),'utf8'),'KEEP_ADVANCED=true\n');
 await access(join(dir,'.onboarded'));
});
test('startup management/help/existing configs and nonTTY JSON never prompt',async()=>{
 const loaded={config:config(),warnings:[]};let called=0;const options={loaded,cli:{},load:async()=>{throw Error('unexpected reload');},wizard:async()=>{called++;return {status:'cancelled'};}};
 for(const mode of ['help','version','doctor','login','logout','auth','models'])assert.equal((await prepareStartupConnection({...options,mode,isTTY:true})).status,'ready');
 for(const [mode,isTTY,json] of [['chat',false,false],['repl',false,false],['run',true,true]])assert.equal((await prepareStartupConnection({...options,mode,isTTY,json})).status,'required');
 assert.equal((await prepareStartupConnection({...options,mode:'chat',isTTY:true,loaded:{config:config('openai','existing'),warnings:[]}})).status,'ready');assert.equal(called,0);
 for(const args of [['login','chatgpt'],['logout','grok'],['auth','status']]){const result=parseCliArgs(args);assert.equal(result.kind,'ok');assert.equal(result.mode,args[0]);assert.deepEqual(result.subArgs,args.slice(1));}
});
test('local status does not refresh or expose credentials; expired renewable ChatGPT is locally ready',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'qling-status-'));let network=0,grokReads=0;const service=createAuthService({cipher,http:async()=>{network++;throw Error('network forbidden');},readGrokCredential:async()=>{grokReads++;return {accessToken:'grok-secret',expiresAt:Date.now()-1000};}});
 const profile={id:'status',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'fake-model'};
 await service.saveConnection(dir,profile,{accessToken:'secret-access',refreshToken:'secret-refresh',expiresAt:Date.now()-1000,scopes:['chatgpt.tokens.use.direct','resource.invoke']});
 const before=await readFile(join(dir,'auth','connections.json'),'utf8');const status=await service.inspectActiveConnection(dir);assert.equal(status.status,'ready');assert.equal(status.needsRefresh,true);assert.equal(network,0);assert.equal(grokReads,0);assert.doesNotMatch(JSON.stringify(status),/secret-access|secret-refresh/);assert.equal(await readFile(join(dir,'auth','connections.json'),'utf8'),before);
 await service.saveConnection(dir,{...profile,id:'expired'},{accessToken:'expired',expiresAt:Date.now()-1000,scopes:['chatgpt.tokens.use.direct','resource.invoke']});assert.equal((await service.inspectActiveConnection(dir)).status,'needs_login');
 await service.saveConnection(dir,{id:'grok',provider:'grok-account',method:'grok_cli_session',endpoint:'https://cli-chat-proxy.grok.com/v1',model:'grok-build'});assert.equal((await service.inspectActiveConnection(dir)).status,'needs_login');assert.equal(grokReads,1);assert.equal(network,0);
});
test('pending account catalog fixes origin, disallows redirects, filters hidden models and sanitizes failures',async()=>{
 const profile={id:'pending',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'fake'};let calls=0;
 const models=await listPendingAccountModels(profile,{accessToken:'pending-token'},{fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/models');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer pending-token');return {ok:true,json:async()=>({models:[{slug:'allowed',visibility:'list'},{slug:'hidden',visibility:'hidden'}]})};}});assert.deepEqual(models,{ok:true,models:['allowed']});
 await assert.rejects(listPendingAccountModels({...profile,endpoint:'https://evil.test'},{accessToken:'pending-token'},{fetchImpl:async()=>{calls++;}}),/official/);assert.equal(calls,1);
 const failed=await listPendingAccountModels(profile,{accessToken:'pending-token'},{fetchImpl:async()=>{throw Error('pending-token');}});assert.deepEqual(failed,{ok:false,models:[]});
});
test('slash authentication refuses busy runtime or unsafe host and preserves terminal handoff adapter',async()=>{
 let handed=0;const errors=[];const context=withDefaultWriters({agentLoop:{getRuntimeRootDir:()=>'/unused',getRuntimeSnapshot:()=>({state:'running'})},withTerminalHandoff:async run=>{handed++;return run();},writeError:s=>errors.push(s),writeLine:()=>{}});assert.equal(typeof context.withTerminalHandoff,'function');await loginCommand.execute([],context);assert.equal(handed,0);assert.match(errors[0],/等待/);
 context.agentLoop.getRuntimeSnapshot=()=>({state:'idle'});context.withTerminalHandoff=undefined;await loginCommand.execute([],context);assert.match(errors.at(-1),/安全终端交接/);
});
test('TUI handoff stops only UI and restores UI/scheduler even when auth fails',async()=>{
 const repl=new StreamingREPL({getModel:()=> 'fake',getToolCount:()=>0,getWorkspaceDir:()=>'/unused'});const calls=[];repl.ui={stop:()=>calls.push('ui-stop'),start:()=>calls.push('ui-start')};repl.scheduler={setBusy:v=>calls.push(`busy:${v}`)};repl.inputQueue={pendingCount:0,isProcessing:false};const context=repl.createSlashContext();await assert.rejects(context.withTerminalHandoff(async()=>{calls.push('auth');throw Error('cancel');}),/cancel/);assert.deepEqual(calls,['busy:true','ui-stop','auth','ui-start','busy:false']);
});
test('REPL handoff detaches old readline and recreates input after failure',async()=>{
 const repl=new Repl({getWorkspaceDir:()=>'/unused'});const old=repl.rl;let busy=[];repl.scheduler={setBusy:v=>busy.push(v)};await assert.rejects(repl.createSlashContext().withTerminalHandoff(async()=>{assert.equal(old.closed,true);throw Error('cancel');}),/cancel/);assert.notEqual(repl.rl,old);assert.deepEqual(busy,[true,false]);repl.rl.close();
});
test('account logout remains detached across restart despite paid API env and never rereads Grok; new save reattaches',async()=>{
 for(const provider of ['chatgpt','grok-account']){
  const dir=await mkdtemp(join(tmpdir(),'qling-detached-'));let grokReads=0;const service=createAuthService({cipher,readGrokCredential:async()=>{grokReads++;return {accessToken:'official-session',expiresAt:Date.now()+100000};}});
  const profile={id:'account',provider,method:provider==='chatgpt'?'chatgpt_oauth':'grok_cli_session',endpoint:provider==='chatgpt'?'https://api.openai.com/v1':'https://cli-chat-proxy.grok.com/v1',model:'account-model'};
  const credential=provider==='chatgpt'?{accessToken:'account-token',refreshToken:'refresh',expiresAt:Date.now()+100000,scopes:['chatgpt.tokens.use.direct','resource.invoke']}:undefined;
  await service.saveConnection(dir,profile,credential);await service.logoutProfile(dir);
  assert.deepEqual(await service.loadActiveProfile(dir),profile);assert.equal((await service.inspectActiveConnection(dir)).status,'needs_login');await assert.rejects(service.resolveProfileCredential(dir,profile),/needs_login/);assert.equal(grokReads,0);
  const loaded=await loadQlingConfig({fileStateDir:dir},{OPENAI_API_KEY:'paid-openai',XAI_API_KEY:'paid-xai',QLING_LLM_API_KEY:'paid-generic'});assert.equal(loaded.config.llm.provider,provider);assert.equal(loaded.config.llm.api_key,'qling-auth:account');
  assert.equal(await shouldRunFirstRunSetup(loaded.config,{isTTY:true}),true);
  await service.saveConnection(dir,profile,credential);assert.equal((await service.inspectActiveConnection(dir)).status,'ready');assert.equal(grokReads,provider==='grok-account'?1:0);
 }
});
