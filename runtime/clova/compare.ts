#!/usr/bin/env node
import {createServer, type Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createWrapper, type WrapperCallMetrics} from './http.ts';
import {runClaudeProbe} from './claude-probe.ts';
import {runGraphProbe, type ComparisonTask} from './graph-probe.ts';
import {clean, usageZero, type Usage} from './common.ts';

const here=fileURLToPath(new URL('.',import.meta.url));
async function listen(server:Server) {await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw new Error('No listen address');return `http://127.0.0.1:${a.port}`;}
async function close(server:Server) {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}

/** Deterministic provider only for testing transport and harness behavior; never a model-quality score. */
function mockProvider(task:ComparisonTask) {
  return createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw),messages=body.messages as any[];
      const user=messages.findLastIndex(m=>m.role==='user');
      const prompt=messages[user]?.content??'';
      const step=task.steps.find(s=>prompt.includes(s.prompt))??task.steps.find(s=>prompt.includes(s.id==='undo'?'되돌리':s.id==='edit'?'수정 내용':'처음 내용'));
      if(!step)throw new Error('Unknown fixture prompt');
      const recent=messages.slice(user+1);
      const completed=recent.filter(m=>m.role==='tool').length;
      const action=step.id==='undo'?(completed===0?'artifact_undo':completed===1?'artifact_read':undefined):(completed===0?'artifact_write':undefined);
      const name=action?body.tools.find((t:any)=>t.function.name.endsWith(`__${action}`))?.function.name:undefined;
      const args=action==='artifact_write'?{path:task.file,text:step.expectedText}:action==='artifact_read'?{path:task.file}:{};
      const message=action?{role:'assistant',content:'',toolCalls:[{id:randomUUID(),type:'function',function:{name,arguments:args}}]}:{role:'assistant',content:'완료했습니다.'};
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({status:{code:'20000'},result:{message,finishReason:action?'tool_calls':'stop',usage:{promptTokens:13,completionTokens:7}}}));
    }catch{res.writeHead(400);res.end('{}');}
  });
}

export async function compare(options:{live:boolean;outputDir:string}) {
  const task:ComparisonTask=JSON.parse(readFileSync(join(here,'fixtures/comparison.json'),'utf8'));
  const output=resolve(options.outputDir);mkdirSync(output,{recursive:true,mode:0o700});
  const scratch=mkdtempSync(join(tmpdir(),'clova-compare-'));
  const saved={key:process.env.CLOVA_API_KEY_FILE,base:process.env.CLOVA_BASE_URL,token:process.env.CLOVA_WRAPPER_TOKEN_FILE};
  let upstream:Server|undefined,wrapper:Server|undefined;
  const inference=options.live?'live':'mock';
  const metrics:WrapperCallMetrics[]=[];
  const report:any={schema:1,createdAt:new Date().toISOString(),inference,task,
    scope:'Native Claude Code print-session versus our LangGraph harness. Elda interactive attach and installed CLI registration are separate integration checks.',
    caveats:['One three-turn file task per harness; this is a functional smoke comparison, not a general quality ranking.',
      'The base instructions, model, sampling, output cap and MCP tool implementations match. Harness-added prompts and tool-name prefixes differ.',
      'Claude Code max-turns and LangGraph model-round limits are different native controls; actual request counts are reported.',
      'Mode 2 approvals are automatically accepted by the test controller for these four isolated file tools.',
      'Anthropic SSE is buffered from native CLOVA responses; latency is full-turn wall time, not time to first token.'],results:[],pass:false};
  try {
    if(!options.live) {
      const key=join(scratch,'mock.key');writeFileSync(key,'local-mock-clova-key',{mode:0o600});process.env.CLOVA_API_KEY_FILE=key;
      upstream=mockProvider(task);process.env.CLOVA_BASE_URL=await listen(upstream);
    }else if(!process.env.CLOVA_API_KEY_FILE)throw new Error('Live comparison requires CLOVA_API_KEY_FILE');
    const token=process.env.CLOVA_WRAPPER_TOKEN_FILE??join(scratch,'wrapper.key');
    if(!process.env.CLOVA_WRAPPER_TOKEN_FILE)writeFileSync(token,randomUUID()+randomUUID(),{mode:0o600});
    wrapper=createWrapper({tokenFile:token,allowedModels:[task.model],onCall:m=>metrics.push(m)});
    const base=await listen(wrapper);
    process.stderr.write(`Comparing mode 1: Claude Code + ${task.model} (${inference})\n`);
    const native=await runClaudeProbe({baseUrl:base,tokenFile:token,steps:task.steps,artifactPath:task.file,
      model:task.model,inference,outputDir:join(output,'mode-1'),timeoutMsPerPrompt:task.timeoutMsPerPrompt,
      systemPrompt:task.systemPrompt,maxTurnsPerPrompt:task.maxTurnsPerPrompt});
    const usage=usageZero();for(const m of metrics)for(const k of Object.keys(usage) as (keyof Usage)[])usage[k]+=m.usage?.[k]??0;
    report.results.push({mode:'1',harness:'Claude Code',pass:native.pass,durationMs:native.durationMs,usage,
      modelCalls:metrics.length,toolCalls:native.turns.reduce((n,t)=>n+t.tools.length,0),approvals:0,
      steps:native.turns.map(t=>({id:t.id,pass:t.pass,durationMs:t.durationMs,artifactMatches:t.checks.exactArtifact,usage:t.usage,checks:t.checks})),
      checks:native.checks,...(native.error?{error:native.error}:{})});
    writeFileSync(join(output,'mode-1','upstream-metrics.json'),JSON.stringify(metrics,null,2)+'\n',{mode:0o600});
    for(const mode of ['2','3'] as const) {
      process.stderr.write(`Comparing mode ${mode}: LangGraph + ${task.model} (${inference})\n`);
      const graph=await runGraphProbe({task,mode,inference,outputDir:join(output,`mode-${mode}`)});
      report.results.push({mode,harness:'LangGraph',pass:graph.pass,durationMs:graph.durationMs,usage:graph.usage,
        modelCalls:graph.steps.reduce((n:number,s:any)=>n+s.modelCalls,0),toolCalls:graph.toolCalls,toolErrors:graph.toolErrors,
        approvals:graph.approvals,steps:graph.steps,cleanExit:graph.cleanExit,sessionPreserved:graph.sessionPreserved,...(graph.error?{error:graph.error}:{})});
    }
    report.pass=report.results.length===3&&report.results.every((r:any)=>r.pass);
  }finally {
    if(wrapper)await close(wrapper);if(upstream)await close(upstream);
    for(const [name,value] of Object.entries({CLOVA_API_KEY_FILE:saved.key,CLOVA_BASE_URL:saved.base,CLOVA_WRAPPER_TOKEN_FILE:saved.token}))if(value===undefined)delete process.env[name];else process.env[name]=value;
    rmSync(scratch,{recursive:true,force:true});
    writeFileSync(join(output,'report.json'),JSON.stringify(clean(report),null,2)+'\n',{mode:0o600});
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if(args.some((a,i)=>!['--live','--mock','--output'].includes(a)&&args[i-1]!=='--output')||(args.includes('--live')&&args.includes('--mock')))throw new Error('Usage: compare.ts [--mock|--live] [--output DIR]');
    const report=await compare({live:args.includes('--live'),outputDir:args.includes('--output')?args[args.indexOf('--output')+1]:join(here,`comparison-${args.includes('--live')?'live':'mock'}.local`)});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.pass?0:1;
  }catch(error){process.stderr.write(JSON.stringify(clean({error:error instanceof Error?error.message:'Comparison failed'}))+'\n');process.exitCode=2;}
}
