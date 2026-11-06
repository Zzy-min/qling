import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let profile={id:'account',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'account-model'};
let code=0,throwLogin=false;
mock.module('../../dist/cli/auth.js',{namedExports:{
 runAuthCli:async(mode,args,dir,write)=>{assert.equal(dir,'/isolated');if(throwLogin)throw Error('cancel');if(mode==='logout' && (!args[0]||args[0]===profile.provider))profile=null;return code;},
 resolveSavedLlmSession:async()=>({provider:'chatgpt',endpoint:'https://api.openai.com/v1',model:'new-model',apiKey:'qling-auth:account'}),
}});
mock.module('../../dist/auth/service.js',{namedExports:{loadActiveProfile:async()=>profile}});
const {loginCommand,logoutCommand,authCommand}=await import('../../dist/commands/auth.js');
function context(){const calls=[];return {calls,agentLoop:{getRuntimeRootDir:()=>'/isolated',getRuntimeSnapshot:()=>({state:'idle'}),applyLlmSession:patch=>calls.push(['apply',patch])},withTerminalHandoff:async run=>{calls.push('suspend');try{return await run();}finally{calls.push('restore');}},onModelChanged:model=>calls.push(['model',model]),writeLine:line=>calls.push(['line',line]),writeError:line=>calls.push(['error',line])};}
test('successful slash login applies entire resolved connection without restarting',async()=>{const c=context();await loginCommand.execute(['chatgpt'],c);assert.deepEqual(c.calls.slice(0,3),['suspend',['apply',{provider:'chatgpt',endpoint:'https://api.openai.com/v1',model:'new-model',apiKey:'qling-auth:account'}],['model','new-model']]);assert.equal(c.calls.at(-1),'restore');});
test('cancelled or failed slash login restores host and never reconfigures old session',async()=>{const c=context();code=1;await loginCommand.execute([],c);assert.deepEqual(c.calls,['suspend','restore']);throwLogin=true;await loginCommand.execute([],c);assert.equal(c.calls.filter(x=>Array.isArray(x)&&x[0]==='apply').length,0);assert.equal(c.calls.at(-2),'restore');throwLogin=false;code=0;});
test('logout clears current runtime credential and does not select API fallback; provider mismatch leaves session intact',async()=>{const c=context();await logoutCommand.execute(['openai'],c);assert.equal(c.calls.some(x=>Array.isArray(x)&&x[0]==='apply'),false);await logoutCommand.execute([],c);assert.deepEqual(c.calls.find(x=>Array.isArray(x)&&x[0]==='apply'),['apply',{apiKey:''}]);assert.equal(c.calls.includes('suspend'),false);});
test('authstatus alias is available and busy legacy inference refuses login/logout',async()=>{assert.ok(authCommand.aliases.includes('/authstatus'));for(const command of [loginCommand,logoutCommand]){const c=context();c.isInferenceRunning=()=>true;await command.execute([],c);assert.equal(c.calls[0][0],'error');assert.equal(c.calls.includes('suspend'),false);}});
