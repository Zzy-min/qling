import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { evaluateTaskResult } from '../../dist/session/outcome-evidence.js';
import { runInnerIterationLoop, runOuterAgentLoop } from '../../dist/agent/main-loop.js';
import { ContextCompactor } from '../../dist/context-compactor.js';
import { ExecutionEventBus } from '../../dist/execution/event-bus.js';
import { RecoveryController } from '../../dist/execution/recovery-controller.js';
import { AgentLoop } from '../../dist/agent-loop.js';
import { runWithRuntimeRoots } from '../../dist/runtime-paths.js';
import { runBash } from '../../dist/tools/bash.js';

const claim = 'I ran the tests and they passed.';
const evaluate = (toolExecutions, extra = {}) => evaluateTaskResult({userPrompt:'Run the unit tests', finalText:claim, toolExecutions, ...extra});
const shell = (command, exitCode = 0, extra = {}) => ({tool:'bash', command, exitCode, failed:false, output:'ok', ...extra});
const call = (name, args, id = name) => ({id, type:'function', function:{name, arguments:JSON.stringify(args)}});

async function fixture(t, responses, options = {}) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'qling-runtime-regression-'));
  t.after(() => fs.rm(workspace, {recursive:true, force:true}));
  const events = [];
  const bus = new ExecutionEventBus();
  bus.subscribe(event => events.push(event));
  const recovery = new RecoveryController();
  recovery.startRun({runId:"run_runtime_test",sessionId:"runtime_test",originalTask:options.prompt ?? "Run the unit tests"});
  let modelCalls = 0;
  const host = {
    messages:[{role:'user', content:options.prompt ?? 'Run the unit tests'}], turnCount:0,
    activeRunId:'run_runtime_test', sessionId:'runtime_test', maxIterations:options.maxIterations ?? 5,
    toolRepeatLimit:6, parseRetries:0, verificationCommand:null,
    counters:{sessionTokens:0,sessionPromptTokens:0,sessionCompletionTokens:0,tokenUsageSource:'unknown'},
    compactionCount:0, toolCallTotal:0, toolFailureTotal:0,retryCountTotal:0,loggingFormat:'json',
    compactor:new ContextCompactor(8000,'gpt-4o'),
    pipeline:{execute:async tc => {
      if (tc.name === 'bash') return {...await runWithRuntimeRoots({workspaceDir:workspace,fileStateDir:workspace,fileCacheDir:workspace},()=>runBash({command:tc.arguments.command,cwd:workspace})), tool_call_id:tc.id};
      if (tc.name === 'write') {await fs.writeFile(path.join(workspace,tc.arguments.path),tc.arguments.content); return {tool_call_id:tc.id,output:'written',is_error:false};}
      return {tool_call_id:tc.id,output:'ok',is_error:false};
    }},
    tools:['bash','write'].map(name=>({name,description:name,parameters:{type:'object',properties:{}}})),
    guardConfig:{mode:'allow'},channel:null,approvalGate:{},
    knowledgeAdapter:{onAssistantMessage:()=>{},onToolCall:()=>{},onToolResult:()=>{},onTurnEnd:async()=>{}},
    memoryStore:{addPractice:()=>{},addConversationTurn:()=>{},link:()=>{}},
    workspaceDir:workspace,fileStateDir:workspace,workflowRuntime:{updateContext:async()=>{}},
    executionEventBus:bus,recoveryController:recovery,verifier:{},
    buildSystemPrompt:async()=> 'Scripted local regression',
    chat:async()=> {const response = responses[Math.min(modelCalls,responses.length-1)]; modelCalls++; return response;},
    emit:()=>{},runVerificationCommand:async command=> { const result=await runWithRuntimeRoots({workspaceDir:workspace,fileStateDir:workspace,fileCacheDir:workspace},()=>runBash({command,cwd:workspace})); return {code:result.meta?.exitCode ?? 1,stdout:result.output,stderr:''}; },
    getRecoveryState:()=>null,reflectiveThink:async()=>({decision:'proceed',reason:'ok'}),checkAutoDream:async()=>{},
    ...options.host,
  };
  return {host, workspace,events,modelCalls:()=>modelCalls};
}

test('test claims require successful matching command evidence, not arbitrary shell/read success', () => {
  for (const command of ['pwd','echo "tests passed"','# npm test','cat test.log','npm test || true','node --test --help','pytest --collect-only','npm run build','tsc --noEmit']) {
    const result = evaluate([shell(command)]);
    assert.equal(result.completionStatus,'incomplete',command);
    assert.ok(result.claimAuditFindings.some(f=>f.kind==='unbacked_verification_claim'),command);
  }
  assert.equal(evaluate([{tool:'read',failed:false,output:'all tests passed'}]).completionStatus,'incomplete');
  assert.equal(evaluate([shell('npm test')]).completionStatus,'completed_verified');
  assert.equal(evaluate([shell('node --test tests/unit/example.test.mjs')]).completionStatus,'completed_verified');
  assert.notEqual(evaluate([shell('npm test',null)]).completionStatus,'completed_verified');
  assert.notEqual(evaluate([shell('npm test',1)]).completionStatus,'completed_verified');
});

test('failure, blocked results, later test failures, and mutations invalidate test pass evidence', () => {
  for (const items of [
    [shell('npm test',1,{failed:true})],
    [shell('npm test',0,{verificationVerdict:'blocked'})],
    [shell('npm test'),shell('npm test',1,{failed:true})],
    [shell('npm test'),{tool:'write',failed:false,mutation:'updated',targetPath:'app.js'}],
    [{tool:'verify',failed:false,isVerification:true,verificationVerdict:'blocked'}],
    [{tool:'verify',failed:false,isVerification:true,verificationVerdict:'fail'}],
  ]) assert.notEqual(evaluate(items).completionStatus,'completed_verified');
  assert.notEqual(evaluate([], {latestVerificationVerdict:'pass'}).completionStatus,'completed_verified');
  assert.equal(evaluate([shell('npm test'),shell('pwd')]).completionStatus,'completed_verified');
});

test('without matching checks code task stays unverified, ordinary chat and actual lookup retain compatibility', () => {
  assert.equal(evaluate([shell('pwd')],{finalText:'Done.'}).completionStatus,'incomplete');
  assert.equal(evaluate([],{userPrompt:'Hello',finalText:'Hello!'}).completionStatus,'completed_unverified');
  assert.equal(evaluate([{tool:'read',failed:false,output:'{"version":"1"}'}],{userPrompt:'Find the version',finalText:'Version 1.'}).completionStatus,'completed_verified');
});

test('real shell executor preserves command and explicit exit status', async t => {
  const f = await fixture(t,[{content:'hello'}]);
  const result = await runWithRuntimeRoots({workspaceDir:f.workspace,fileStateDir:f.workspace,fileCacheDir:f.workspace},()=>runBash({command:'node --version',cwd:f.workspace}));
  assert.equal(result.meta?.exitCode,0);
  assert.equal(result.meta?.command,'node --version');
});

test('actual inner loop rejects unrelated shell success as tests, but accepts real local test process', async t => {
  for (const command of ['pwd','node --test passing.test.mjs','node --test failing.test.mjs']) {
    const f = await fixture(t,[{content:'',tool_calls:[call('bash',{command})]},{content:claim}]);
    await fs.writeFile(path.join(f.workspace,'passing.test.mjs'),"import test from 'node:test'; test('passes',()=>{});\n");
    await fs.writeFile(path.join(f.workspace,'failing.test.mjs'),"import test from 'node:test'; import assert from 'node:assert'; test('fails',()=>assert.fail('expected'));\n");
    const result = await runInnerIterationLoop(f.host);
    if(command.includes('passing')) {assert.equal(result.status,'succeeded');assert.equal(result.completionStatus,'completed_verified');}
    else {assert.notEqual(result.status,'succeeded');assert.notEqual(result.completionStatus,'completed_verified');assert.doesNotMatch(result.text,/I ran the tests and they passed/);}
  }
});

test('bounded self-check exhaustion cannot return success or original false text through outer/public string API', async t => {
  const falseText='I have created file report.md. I ran the tests and they passed.';
  const f=await fixture(t,[{content:falseText}],{prompt:'Create file report.md and run the tests'});
  let activeRun=null;
  const outcome=await runOuterAgentLoop({sessionId:f.host.sessionId,messages:f.host.messages,activeRun:null,recoveryController:f.host.recoveryController,
    executionEventBus:f.host.executionEventBus,getRecoveryState:()=>null,formatRecoveryPause:reason=>reason,
    applyRecoveryStrategy:async()=>{},executeInner:()=>runInnerIterationLoop(f.host),setActiveRun:run=>{activeRun=run;}});
  assert.equal(f.modelCalls(),2);
  assert.equal(outcome.status,'paused');
  assert.equal(outcome.completionStatus,'incomplete');
  assert.match(outcome.text,/未完成|incomplete/i);
  assert.doesNotMatch(outcome.text,/I have created|tests and they passed/);
  assert.equal(await AgentLoop.prototype.run.call({runDetailed:async()=>outcome}),outcome.text);
  assert.ok(f.events.some(e=>e.type==='result_evaluated'&&e.status==='recovering'));
  assert.ok(!f.events.some(e=>e.type==='run_completed'&&e.status==='succeeded'));
});

test('zero and one iteration budgets remain honest and bounded', async t => {
  for (const limit of [0,1]) {
    const f=await fixture(t,[{content:'I have created file report.md. '+claim}],{prompt:'Create file report.md and run tests',maxIterations:limit});
    const outcome=await runInnerIterationLoop(f.host);
    assert.notEqual(outcome.status,'succeeded');
    assert.equal(f.modelCalls(),limit);
    assert.match(outcome.text,/未完成|incomplete/i);
    assert.doesNotMatch(outcome.text,/tests and they passed/);
  }
});

test('honest blocked and partial reports are surfaced as paused, while ordinary chat succeeds', async t => {
  for (const content of ['Blocked by missing credentials; remaining steps are pending.','Partially completed. Remaining steps are blocked.','Hello!']) {
    const f=await fixture(t,[{content}],{prompt:content==='Hello!'?'Hello':'Run the tests'});
    const outcome=await runInnerIterationLoop(f.host);
    assert.equal(outcome.status,content==='Hello!'?'succeeded':'paused');
    if(content!=='Hello!') assert.match(outcome.text,/未完成|部分完成|blocked|partial/i);
  }
});

test('false claim can recover by actually writing and running local verification', async t => {
  const f=await fixture(t,[{content:'I have created file report.md. '+claim},
    {content:'',tool_calls:[call('write',{path:'report.md',content:'Real report\n'})]},
    {content:'',tool_calls:[call('bash',{command:'node --test passing.test.mjs'})]},
    {content:'Created report.md. '+claim}],{prompt:'Create file report.md and run tests',host:{verificationCommand:'node --test passing.test.mjs'}});
  await fs.writeFile(path.join(f.workspace,'passing.test.mjs'),"import test from 'node:test'; test('passes',()=>{});\n");
  const outcome=await runInnerIterationLoop(f.host);
  assert.equal(outcome.status,'succeeded');
  assert.equal(outcome.completionStatus,'completed_verified');
  assert.equal(await fs.readFile(path.join(f.workspace,'report.md'),'utf8'),'Real report\n');
});


test('public AgentLoop.run returns honest paused text using an actual scripted client', async t => {
  const f = await fixture(t, [{content:'Hello'}]);
  const agent = new AgentLoop({apiKey:'local-fixture-only', maxIterations:3,
    runtime:{workspaceDir:f.workspace,fileStateDir:f.workspace,fileCacheDir:f.workspace,maxSteps:3,parseRetries:0,toolRepeatLimit:6,timeoutMs:5000},
  });
  t.after(()=>agent.shutdown());
  agent.checkAutoDream=async()=>{};
  let calls=0;
  agent.llmClient.chatCompletions=async()=>{calls++;return {content:'I have created file report.md. I ran the tests and they passed.'};};
  agent.addUserMessage('Create file report.md and run tests');
  const text=await agent.run();
  assert.match(text,/任务未完成/);
  assert.doesNotMatch(text,/I have created|tests and they passed/);
  assert.equal(calls,2);
});

test('an existing file and an unrelated shell success cannot prove this run changed it', async t => {
  const f = await fixture(t, [{content:'Done'}]);
  await fs.writeFile(path.join(f.workspace, 'report.md'), 'old');
  const input = {userPrompt:'修改 report.md', finalText:'已修改该文件。', workspaceDir:f.workspace};
  for (const evidence of [shell('pwd'), shell('echo ok', 0, {mutation:'updated', targetPath:'other.txt'}),
    shell('echo ok', 0, {mutation:'updated', targetPath:'<workspace-capture-unavailable>'})]) {
    const result = evaluateTaskResult({...input, toolExecutions:[evidence]});
    assert.equal(result.allowFinish, false);
    assert.ok(result.claimAuditFindings.some(finding => finding.kind === 'unbacked_file_mutation_claim'));
  }
  await fs.writeFile(path.join(f.workspace, 'another.txt'), 'changed');
  const mutation = shell('node change.cjs', 0, {mutation:'updated', targetPath:'another.txt', changedPaths:['another.txt', 'report.md']});
  assert.equal(evaluateTaskResult({...input, toolExecutions:[mutation]}).allowFinish, true);
});

test('a real shell write carries observed changed paths through the production loop', async t => {
  const f = await fixture(t, [{content:'',tool_calls:[call('bash',{command:'node change.cjs'})]},
    {content:'Modified report.md.'}], {prompt:'Modify report.md', host:{verificationCommand:'node --check change.cjs'}});
  const reliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = 'true';
  t.after(() => { if (reliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2; else process.env.QLING_FEATURES_RELIABILITY_V2 = reliability; });
  execFileSync('git', ['init','--quiet'], {cwd:f.workspace});
  await fs.writeFile(path.join(f.workspace, 'change.cjs'), "require('node:fs').writeFileSync('report.md','new contents');");
  await fs.writeFile(path.join(f.workspace, 'report.md'), 'old');
  const outcome = await runInnerIterationLoop(f.host);
  assert.equal(await fs.readFile(path.join(f.workspace,'report.md'),'utf8'), 'new contents');
  assert.equal(outcome.status,'succeeded',outcome.text);
});

test('a failed requested edit remains incomplete after an unrelated successful read', () => {
  const result = evaluateTaskResult({userPrompt:'Modify the settings', finalText:'Done.',
    toolExecutions:[{tool:'patch', failed:true}, {tool:'read', failed:false}]});
  assert.equal(result.completionStatus, 'failed');
  assert.equal(result.allowFinish, false);
});

test('required command checks distinguish explanations, standalone builds and independent negations', () => {
  const empty = prompt => evaluateTaskResult({userPrompt:prompt, finalText:'Done.', toolExecutions:[]});
  assert.equal(empty('How do I run the unit tests?').completionStatus, 'completed_unverified');
  assert.equal(empty('诊断为什么构建失败').completionStatus, 'completed_unverified');
  assert.equal(empty('Build the project').allowFinish, false);
  assert.equal(empty('Do not run tests; run the build').allowFinish, false);
  assert.equal(evaluate([{tool:'read', command:'npm test', exitCode:0, failed:false}]).allowFinish, false);
  assert.equal(evaluate([shell('npm test'), {tool:'verify', failed:true, verificationVerdict:'blocked'}]).allowFinish, false);
});
