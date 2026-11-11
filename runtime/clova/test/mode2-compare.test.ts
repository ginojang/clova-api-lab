import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {compareMode2,type Mode2Provider} from '../mode2-compare.ts';

const cliSource=process.env.ELDA_CLI_DIR??join(homedir(),'apps/elda-cli');
const installed=existsSync(join(cliSource,'elda'));
const actualCli={skip:installed?false:'Installed Elda CLI is required for the real mode 2 integration',timeout:60000};
const providers:Mode2Provider[]=['groq','openrouter','zai'];
const isolatedEnvironment={PATH:process.env.PATH,HOME:process.env.HOME};

test('mode 2 runs each provider through actual Elda, graph and MCP using only local model fixtures',actualCli,async()=>{
  const outputDir=mkdtempSync(join(tmpdir(),'mode2-compare-test-'));
  try{
    const report=await compareMode2({providers,outputDir,cliSource,environment:{...isolatedEnvironment,
      CLOVA_API_KEY_FILE:'/must-not-propagate/clova',GROQ_API_KEY_FILE:'/must-not-propagate/groq',
      OPENROUTER_API_KEY_FILE:'/must-not-propagate/openrouter',ZAI_API_KEY_FILE:'/must-not-propagate/zai'}});
    assert.equal(report.pass,true,JSON.stringify(report.results.map((r:any)=>({provider:r.provider,error:r.error,checks:r.checks,steps:r.steps}))));
    assert.equal(report.mode,'2');assert.equal(report.inference,'mock');assert.equal(report.status,'mock_passed');
    assert.equal(Object.hasOwn(report.task,'model'),false);assert.equal(report.sharedFixtureSourceModel,'HCX-005');
    assert.equal(report.installedCliUnchanged,true);assert.equal(report.allConfigured,true);
    assert.deepEqual(report.results.map((r:any)=>r.provider),providers);
    assert.deepEqual(report.usage,{input:273,output:147,cacheRead:0,cacheWrite:0});
    for(const result of report.results){
      assert.equal(result.status,'mock_passed');assert.equal(result.mode,'2');assert.equal(result.inference,'mock');
      assert.equal(result.steps.length,3);assert.equal(result.modelRounds,7);assert.equal(result.toolCalls,4);
      assert.equal(result.toolErrors,0);assert.equal(result.httpRequests,7);assert.equal(result.approvals.length,4);
      assert.equal(result.checks.providerObserved,true);assert.equal(result.checks.mcpObserved,true);
      assert.deepEqual(result.remainingProcessIds,[]);
      assert.deepEqual(result.steps.map((s:any)=>s.tools),[['artifact_write'],['artifact_write'],['artifact_undo','artifact_read']]);
      assert.deepEqual(result.approvals.map((a:any)=>a.beforeText),[null,report.task.steps[0].expectedText,report.task.steps[1].expectedText,report.task.steps[0].expectedText]);
      assert.deepEqual(result.steps.map((s:any)=>s.actualText),report.task.steps.map((s:any)=>s.expectedText));
      assert.deepEqual(result.mockRequests.map((request:any)=>request.toolResults),[0,1,0,1,0,1,2]);
      assert.ok(result.mockRequests.at(-1).historyMessages>result.mockRequests[0].historyMessages);
      for(const step of report.task.steps)assert.equal(readFileSync(join(outputDir,result.provider,`${step.id}.txt`),'utf8'),step.expectedText);
      const saved=JSON.parse(readFileSync(join(outputDir,result.provider,'report.json'),'utf8'));
      assert.equal(saved.status,'mock_passed');assert.equal(saved.pass,true);
      assert.equal(JSON.stringify(saved).includes('mode2-fixture-'),false,'fixture credential values must never enter reports');
    }
  }finally{rmSync(outputDir,{recursive:true,force:true});}
});

test('live providers without credential files are explicitly unverified and do not start a CLI',async()=>{
  const outputDir=mkdtempSync(join(tmpdir(),'mode2-missing-'));
  try{
    const report=await compareMode2({live:true,providers,outputDir,cliSource:'/does-not-exist/elda-cli',environment:isolatedEnvironment});
    assert.equal(report.pass,false);assert.equal(report.status,'not_configured');assert.equal(report.inference,'live');
    assert.equal(report.installedCliUnchanged,null);assert.equal(report.allConfigured,false);
    assert.deepEqual(report.usage,{input:0,output:0,cacheRead:0,cacheWrite:0});
    assert.deepEqual(report.results.map((r:any)=>[r.provider,r.status,r.pass,r.steps.length]),providers.map(provider=>[provider,'not_configured',false,0]));
    assert.equal(report.error,undefined);
  }finally{rmSync(outputDir,{recursive:true,force:true});}
});

test('live configured credential paths missing on disk remain not_configured without starting a CLI',async()=>{
  const outputDir=mkdtempSync(join(tmpdir(),'mode2-paths-only-'));
  try{
    const report=await compareMode2({live:true,providers,outputDir,cliSource:'/does-not-exist/elda-cli',environment:{...isolatedEnvironment,
      GROQ_API_KEY_FILE:join(outputDir,'groq.key'),OPENROUTER_API_KEY_FILE:join(outputDir,'openrouter.key'),ZAI_API_KEY_FILE:join(outputDir,'zai.key')}});
    assert.equal(report.pass,false);assert.equal(report.status,'not_configured');assert.equal(report.allConfigured,false);
    assert.equal(report.installedCliUnchanged,null);assert.equal(report.error,undefined);
    assert.deepEqual(report.usage,{input:0,output:0,cacheRead:0,cacheWrite:0});
    assert.deepEqual(report.results.map((r:any)=>[r.provider,r.status,r.pass,r.steps.length]),providers.map(provider=>[provider,'not_configured',false,0]));
    assert.equal(existsSync(join(outputDir,'groq.key')),false);
    assert.equal(existsSync(join(outputDir,'openrouter.key')),false);
    assert.equal(existsSync(join(outputDir,'zai.key')),false);
  }finally{rmSync(outputDir,{recursive:true,force:true});}
});

test('live empty credential files remain failed rather than not_configured',async()=>{
  const outputDir=mkdtempSync(join(tmpdir(),'mode2-empty-key-')),key=join(outputDir,'key');
  try{
    writeFileSync(key,'',{mode:0o600});
    const report=await compareMode2({live:true,providers:['groq'],outputDir,cliSource:'/does-not-exist/elda-cli',environment:{...isolatedEnvironment,GROQ_API_KEY_FILE:key}});
    assert.equal(report.pass,false);assert.equal(report.status,'failed');assert.equal(report.results[0].status,'failed');
    assert.equal(report.installedCliUnchanged,null);assert.equal(report.results[0].steps.length,0);
    assert.deepEqual(report.usage,{input:0,output:0,cacheRead:0,cacheWrite:0});
  }finally{rmSync(outputDir,{recursive:true,force:true});}
});

test('a model claiming completion without a tool effect fails the exact-file comparison',actualCli,async()=>{
  const outputDir=mkdtempSync(join(tmpdir(),'mode2-false-completion-'));
  try{
    const report=await compareMode2({providers:['groq'],outputDir,cliSource,environment:isolatedEnvironment,mockScenario:'false_completion'});
    assert.equal(report.pass,false);assert.equal(report.status,'failed');
    const result=report.results[0];assert.equal(result.inference,'mock');assert.equal(result.status,'failed');
    assert.equal(result.steps.length,1);assert.equal(result.steps[0].checks.turnSucceeded,true);
    assert.equal(result.steps[0].checks.fileExact,false);assert.equal(result.steps[0].checks.requiredToolOnce,false);
    assert.equal(result.steps[0].actualText,null);assert.equal(result.toolCalls,0);assert.equal(result.httpRequests,1);
    assert.equal(result.checks.processCleanup,true);assert.equal(report.installedCliUnchanged,true);
  }finally{rmSync(outputDir,{recursive:true,force:true});}
});

test('a configured live credential with unsafe permissions fails before CLI or network startup',async()=>{
  const outputDir=mkdtempSync(join(tmpdir(),'mode2-key-permissions-')),key=join(outputDir,'key');
  try{
    writeFileSync(key,'fixture-invalid-permissions',{mode:0o644});
    const report=await compareMode2({live:true,providers:['zai'],outputDir,cliSource:'/does-not-exist/elda-cli',environment:{...isolatedEnvironment,ZAI_API_KEY_FILE:key}});
    assert.equal(report.pass,false);assert.equal(report.status,'failed');assert.equal(report.results[0].status,'failed');
    assert.equal(report.installedCliUnchanged,null);assert.equal(report.results[0].steps.length,0);
    assert.equal(JSON.stringify(report).includes('fixture-invalid-permissions'),false);
  }finally{rmSync(outputDir,{recursive:true,force:true});}
});
