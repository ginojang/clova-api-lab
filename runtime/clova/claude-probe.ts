#!/usr/bin/env node
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {clean, inside, redact, secretFile, usageZero, type Usage} from './common.ts';

export type ClaudeProbeStep = {id:string; prompt:string; expectedText?:string; requiredTool?:string; alsoRequiredTool?:string};
export type ClaudeProbeOptions = {
  baseUrl:string; tokenFile:string; steps:ClaudeProbeStep[]; artifactPath?:string;
  model?:string; workspace?:string; outputDir?:string; claudeBin?:string;
  timeoutMsPerPrompt?:number; maxTurnsPerPrompt?:number; systemPrompt?:string; inference:'mock'|'live';
  onEvent?:(event:Record<string, any>)=>void;
};
export type ClaudeProbeTurn = {
  id:string; pass:boolean; durationMs:number; text:string; artifactText:string|null;
  tools:string[]; usage:Usage; checks:Record<string,boolean>;
};
export type ClaudeProbeResult = {
  harness:'Claude Code'; inference:'mock'|'live'; model:string; pass:boolean;
  nativeBinary:string; nativeVersion:string|null; durationMs:number;
  turns:ClaudeProbeTurn[]; events:Record<string, any>[]; usage:Usage;
  checks:Record<string,boolean>; stderr:string; error?:string;
};

const here=dirname(fileURLToPath(import.meta.url));
const artifactTools=['artifact_list','artifact_read','artifact_write','artifact_undo'];
const sleep=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
function nativeUsage(raw:Record<string,any>|undefined):Usage {
  return {input:Number(raw?.input_tokens??0),output:Number(raw?.output_tokens??0),
    cacheRead:Number(raw?.cache_read_input_tokens??0),cacheWrite:Number(raw?.cache_creation_input_tokens??0)};
}
function addUsage(total:Usage, value:Usage) { for(const key of Object.keys(total) as (keyof Usage)[]) total[key]+=value[key]; }
function groupAlive(pid:number|undefined) {
  if(!pid)return false;
  try {process.kill(-pid,0);return true;} catch{return false;}
}
async function stopGroup(proc:ChildProcessWithoutNullStreams) {
  proc.stdin.end();
  const until=Date.now()+3000;
  while(proc.exitCode===null&&proc.signalCode===null&&Date.now()<until)await sleep(20);
  if(groupAlive(proc.pid)) {try{process.kill(-proc.pid!,'SIGTERM');}catch{/* already closed */}}
  const terminated=Date.now()+2000;
  while(groupAlive(proc.pid)&&Date.now()<terminated)await sleep(20);
  if(groupAlive(proc.pid)) {try{process.kill(-proc.pid!,'SIGKILL');}catch{/* already closed */}}
  const killed=Date.now()+1000;
  while(groupAlive(proc.pid)&&Date.now()<killed)await sleep(20);
  return !groupAlive(proc.pid);
}

/** Run the installed native Claude agent loop; every model request uses the given CLOVA wrapper. */
export async function runClaudeProbe(options:ClaudeProbeOptions):Promise<ClaudeProbeResult> {
  const url=new URL(options.baseUrl);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('baseUrl must be a loopback HTTP origin');
  if(!options.steps.length)throw new Error('At least one prompt is required');
  const wrapperToken=secretFile(options.tokenFile);
  const nativeBinary=realpathSync(options.claudeBin??join(homedir(),'.local/bin/claude'));
  const model=options.model??'HCX-005';
  const scratch=mkdtempSync(join(tmpdir(),'clova-native-claude-'));
  const workspace=options.workspace?resolve(options.workspace):join(scratch,'workspace');
  const config=join(scratch,'config'), mcp=join(scratch,'mcp.json');
  const mcpEntry=existsSync(join(here,'mcp.ts'))?join(here,'mcp.ts'):join(here,'mcp.mjs');
  mkdirSync(workspace,{recursive:true,mode:0o700});mkdirSync(config,{mode:0o700});
  writeFileSync(mcp,JSON.stringify({mcpServers:{clova:{command:process.execPath,args:[mcpEntry,'mcp','--workspace',workspace],env:{CLOVA_MCP_ALLOWED_TOOLS:artifactTools.join(',')}}}}),{mode:0o600});
  const started=performance.now();
  const result:ClaudeProbeResult={harness:'Claude Code',inference:options.inference,model,pass:false,nativeBinary,nativeVersion:null,
    durationMs:0,turns:[],events:[],usage:usageZero(),stderr:'',checks:{isolatedConfig:true,singleNativeProcess:true,clovaKeyAbsentFromChild:true,onlyArtifactTools:true,processGroupStopped:false}};
  // Deliberate allowlist: neither CLOVA credentials nor inherited Claude/OAuth settings enter the native process.
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:process.env.HOME,USER:process.env.USER,LOGNAME:process.env.LOGNAME,
    LANG:'C.UTF-8',SHELL:process.env.SHELL,TERM:'dumb',CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:url.origin,
    ANTHROPIC_API_KEY:wrapperToken,ANTHROPIC_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,
    ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,CLAUDE_CODE_SUBAGENT_MODEL:model,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS:'2048',MAX_THINKING_TOKENS:'0',CLAUDE_CODE_EFFORT_LEVEL:'unset',DISABLE_PROMPT_CACHING:'1',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',NODE_NO_WARNINGS:'1'};
  const args=['--bare','-p','--model',model,'--max-turns',String(options.maxTurnsPerPrompt??4),'--input-format','stream-json','--output-format','stream-json','--verbose',
    '--setting-sources','','--strict-mcp-config','--mcp-config',mcp,'--tools','',
    '--allowedTools',artifactTools.map(name=>`mcp__clova__${name}`).join(','),
    '--disallowedTools','mcp__clova__clova_chat,mcp__clova__batch,mcp__clova__api_version',
    '--permission-mode','dontAsk','--permission-prompts','none',
    '--system-prompt',options.systemPrompt??'Complete each user request using the provided artifact tools. Preserve the exact requested file content. Never use clova_chat or other tools. After tool success, answer briefly.'];
  let proc:ChildProcessWithoutNullStreams|undefined;
  let processError:Error|undefined;
  try {
    proc=spawn(nativeBinary,args,{cwd:workspace,env,stdio:'pipe',detached:true});
    proc.once('error',error=>{processError=error;});
    proc.stdin.on('error',()=>{});
    proc.stderr.on('data',chunk=>{result.stderr=(result.stderr+redact(String(chunk))).slice(-100000);});
    let invalidLines=0;
    createInterface({input:proc.stdout}).on('line',line=>{
      try {
        const event=clean(JSON.parse(line)) as Record<string,any>;
        result.events.push(event);options.onEvent?.(event);
        if(event.type==='system'&&event.subtype==='init') {
          result.nativeVersion=typeof event.claude_code_version==='string'?event.claude_code_version:null;
          result.checks.onlyArtifactTools=Array.isArray(event.tools)&&JSON.stringify([...event.tools].sort())===JSON.stringify(artifactTools.map(name=>`mcp__clova__${name}`).sort());
        }
      } catch {invalidLines++;}
    });
    for(const step of options.steps) {
      const from=result.events.length, turnStarted=performance.now();
      proc.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:step.prompt}})+'\n');
      const until=Date.now()+(options.timeoutMsPerPrompt??120000);
      let completion:Record<string,any>|undefined;
      while(Date.now()<until) {
        completion=result.events.slice(from).find(event=>event.type==='result');
        if(completion)break;
        if(processError)throw processError;
        if(proc.exitCode!==null||proc.signalCode!==null)throw new Error(`native Claude exited before completing ${step.id} (code ${proc.exitCode}, signal ${proc.signalCode})`);
        await sleep(10);
      }
      if(!completion)throw new Error(`native Claude timed out on ${step.id}`);
      const turnEvents=result.events.slice(from);
      const tools=turnEvents.filter(e=>e.type==='assistant').flatMap(e=>Array.isArray(e.message?.content)?e.message.content:[])
        .filter((block:any)=>block.type==='tool_use').map((block:any)=>String(block.name));
      const toolResults=turnEvents.filter(e=>e.type==='user').flatMap(e=>Array.isArray(e.message?.content)?e.message.content:[])
        .filter((block:any)=>block.type==='tool_result');
      const artifact=options.artifactPath?inside(workspace,options.artifactPath):undefined;
      const artifactText=artifact&&existsSync(artifact)?readFileSync(artifact,'utf8'):null;
      const checks:Record<string,boolean>={nativeSuccess:completion.is_error===false&&completion.subtype==='success',
        noToolErrors:toolResults.every((block:any)=>block.is_error!==true),toolRoundTrip:tools.length>0&&toolResults.length===tools.length};
      if(step.expectedText!==undefined)checks.exactArtifact=artifactText===step.expectedText;
      if(step.requiredTool)checks.requiredTool=tools.some(name=>name===`mcp__clova__${step.requiredTool}`);
      if(step.alsoRequiredTool)checks.alsoRequiredTool=tools.some(name=>name===`mcp__clova__${step.alsoRequiredTool}`);
      if(step.requiredTool==='artifact_write'||step.requiredTool==='artifact_undo')checks.requiredToolOnce=tools.filter(name=>name===`mcp__clova__${step.requiredTool}`).length===1;
      if(step.requiredTool==='artifact_undo')checks.undoWithoutRewrite=!tools.includes('mcp__clova__artifact_write');
      if(options.outputDir&&artifactText!==null) {
        mkdirSync(options.outputDir,{recursive:true,mode:0o700});
        writeFileSync(join(options.outputDir,`${step.id.replace(/[^A-Za-z0-9_-]/g,'_')}.txt`),artifactText,{mode:0o600});
      }
      const usage=nativeUsage(completion.usage);addUsage(result.usage,usage);
      result.turns.push({id:step.id,pass:Object.values(checks).every(Boolean),durationMs:Math.round(performance.now()-turnStarted),
        text:String(completion.result??''),artifactText,tools,usage,checks});
      if(!checks.nativeSuccess)throw new Error(`native Claude reported failure on ${step.id}`);
    }
    result.checks.validJsonEvents=invalidLines===0;
    result.checks.nativeInit=result.events.some(e=>e.type==='system'&&e.subtype==='init');
    result.checks.allPromptsCompleted=result.turns.length===options.steps.length;
  } catch(error) {
    result.error=redact(error instanceof Error?error.message:String(error));
  } finally {
    if(proc)result.checks.processGroupStopped=await stopGroup(proc);
    else result.checks.processGroupStopped=true;
    result.durationMs=Math.round(performance.now()-started);
    result.pass=!result.error&&result.turns.every(t=>t.pass)&&Object.values(result.checks).every(Boolean);
    rmSync(scratch,{recursive:true,force:true});
    if(options.outputDir) {
      mkdirSync(options.outputDir,{recursive:true,mode:0o700});
      writeFileSync(join(options.outputDir,'events.jsonl'),result.events.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
      writeFileSync(join(options.outputDir,'metrics.json'),JSON.stringify({...result,events:undefined},null,2)+'\n',{mode:0o600});
    }
  }
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2), value=(name:string)=>args[args.indexOf(name)+1];
    if(!args.includes('--base-url')||!args.includes('--token-file')||(!args.includes('--mock')&&!args.includes('--live')))throw new Error('Usage: claude-probe.ts --base-url http://127.0.0.1:PORT --token-file FILE --mock|--live [--fixture FILE] [--output DIR]');
    const fixture=JSON.parse(readFileSync(args.includes('--fixture')?value('--fixture'):join(here,'fixtures/comparison.json'),'utf8'));
    const result=await runClaudeProbe({baseUrl:value('--base-url'),tokenFile:value('--token-file'),steps:fixture.steps,
      artifactPath:fixture.file,model:fixture.model,inference:args.includes('--live')?'live':'mock',
      outputDir:args.includes('--output')?value('--output'):undefined,timeoutMsPerPrompt:fixture.timeoutMsPerPrompt,
      maxTurnsPerPrompt:fixture.maxTurnsPerPrompt,systemPrompt:fixture.systemPrompt});
    process.stdout.write(JSON.stringify({...result,events:undefined})+'\n');process.exitCode=result.pass?0:1;
  } catch(error) {process.stderr.write(JSON.stringify({error:redact(error instanceof Error?error.message:String(error))})+'\n');process.exitCode=2;}
}
