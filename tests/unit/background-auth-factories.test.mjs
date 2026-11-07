import '../helpers/isolated-home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createAuthService } from '../../dist/auth/service.js';
import { DurableSessionSupervisor } from '../../dist/agent/durable-session-supervisor.js';

const call = { model:'local-test', systemPrompt:'test', messages:[{role:'user',content:'synthetic task'}], tools:[] };
const temporary = () => mkdtemp(join(tmpdir(),'qling-background-auth-'));
const cipher = {encrypt:async s=>s,decrypt:async s=>s};
async function saveNone(dir,endpoint) {
    await createAuthService({cipher}).saveConnection(dir,{id:'none',provider:'ollama',method:'none',endpoint,model:'local-test'});
}
function testEnv(dir) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
        ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'].includes(name)));
    return { ...env, HOME:dir, USERPROFILE:dir, QLING_FILE_STATE_DIR:dir,
        QLING_LLM_PROVIDER:'openai', QLING_LLM_STARTUP_PROVIDER:'openai', QLING_LLM_API_KEY:'UNRELATED-PAID-KEY',
        QLING_FEATURES_DYNAMIC_DISCOVERY:'false', QLING_FEATURES_SEMANTIC_MEMORY:'false',
        QLING_MEMORY_WAL_ENABLED:'false', QLING_MEMORY_DREAM_LLM_ENABLED:'false', QLING_METRICS_ENABLED:'false' };
}
async function listen(server) {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    return `http://127.0.0.1:${server.address().port}`;
}

test('durable background factory preserves none profile through actual Axios request', async t => {
    const dir=await temporary();
    await saveNone(dir,'http://127.0.0.1:11434/v1');
    const old={...process.env};
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env,testEnv(dir));
    t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);});
    const supervisor=new DurableSessionSupervisor({stateDir:dir});
    const agent=await supervisor.createAgent();
    t.after(()=>agent.shutdown());
    const requests=[];
    agent.llmClient.client.defaults.adapter=async config=>{
        requests.push(config.headers.get('Authorization'));
        return {status:200,headers:{},config,data:{choices:[{message:{content:'ok'}}]}};
    };
    await agent.llmClient.chatCompletions(call);
    assert.deepEqual(requests,[undefined]);
    assert.equal(agent.getLlmFieldSources().apiKey,'session');
});

test('daemon mission factory never sends unrelated generic key for saved none profile', async t => {
    const dir=await temporary();
    let resolveRequest;
    const captured=new Promise(resolve=>resolveRequest=resolve);
    const modelServer=createServer((req,res)=>{
        req.resume();
        req.on('end',()=>{
            resolveRequest(req.headers.authorization);
            res.writeHead(200,{'content-type':'application/json'});
            res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'done'},finish_reason:'stop'}]}));
        });
    });
    const endpoint=await listen(modelServer);
    t.after(()=>new Promise(resolve=>{modelServer.closeAllConnections();modelServer.close(resolve);}));
    await saveNone(dir,endpoint);
    const reserved=createServer();
    const daemonBase=await listen(reserved);
    const port=reserved.address().port;
    await new Promise(resolve=>reserved.close(resolve));
    const child=spawn(process.execPath,[resolve('dist/daemon.js')],{cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...testEnv(dir),QLING_DAEMON_PORT:String(port),QLING_DAEMON_HOST:'127.0.0.1'}});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    t.after(async()=>{
        const ended=new Promise(resolve=>child.once('exit',resolve));
        child.kill('SIGTERM');
        let deadline;
        await Promise.race([ended,new Promise(resolve=>{deadline=setTimeout(resolve,2500);})]);
        clearTimeout(deadline);
        if(child.exitCode===null)child.kill('SIGKILL');
    });
    const deadline=Date.now()+5000;
    while(true){
        if(child.exitCode!==null)throw Error(`daemon exited: ${errors}`);
        try{if((await fetch(`${daemonBase}/health`)).ok)break;}catch{}
        if(Date.now()>deadline)throw Error(`daemon readiness timeout: ${errors}`);
        await new Promise(resolve=>setTimeout(resolve,40));
    }
    const token=(await readFile(join(dir,'daemon.token'),'utf8')).trim();
    const response=await fetch(`${daemonBase}/missions`,{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({name:'synthetic auth test',description:'Reply done'})});
    assert.equal(response.status,200);
    let timer;
    try{
        const authorization=await Promise.race([captured,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`mission made no model request: ${errors}`)),5000);})]);
        assert.equal(authorization,undefined);
    }finally{clearTimeout(timer);}
});
