#!/usr/bin/env node
/** Mode 2 only: actual Elda CLI -> transport adapter -> LangGraph -> selected API. */
import {spawn,execFileSync,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer,type Server} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,resolve,relative,sep} from 'node:path';
import {clean,secretFile,usageZero,type Usage} from './common.ts';
import type {ComparisonTask} from './graph-probe.ts';
import {MODE2_PROVIDERS} from './providers.ts';

export type Mode2Provider=typeof MODE2_PROVIDERS[number]['id'];
type Provider={id:Mode2Provider;model:string;prefix:string};
const providers:Provider[]=MODE2_PROVIDERS.map(provider=>({id:provider.id,model:provider.models[0].id,prefix:provider.keyFileEnv.replace(/_API_KEY_FILE$/,'')}));
type Event={v:number;seq:number;t:string;data:Record<string,any>};
type Status='mock_passed'|'live_passed'|'failed'|'not_configured';
export type Mode2CompareOptions={
  live?:boolean;providers?:Mode2Provider[];outputDir?:string;cliSource?:string;
  environment?:NodeJS.ProcessEnv;task?:ComparisonTask;
  /** Local fixture behavior only; it never alters live model output. */
  mockScenario?:'success'|'false_completion';
};
const here=fileURLToPath(new URL('.',import.meta.url));
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function settle(promise:Promise<void>,ms:number) {
  let timer:NodeJS.Timeout|undefined;
  try{await Promise.race([promise,new Promise<void>(r=>{timer=setTimeout(r,ms);})]);}finally{clearTimeout(timer);}
}
const sourceNames=['elda','events.py','adapters/loop.py','providers/__init__.py','mcp_client.py'];
const hashes=(cli:string)=>Object.fromEntries(sourceNames.map(file=>[file,createHash('sha256').update(readFileSync(join(cli,file))).digest('hex')]));
const allKeyNames=['CLOVA_API_KEY_FILE','GROQ_API_KEY_FILE','OPENROUTER_API_KEY_FILE','ZAI_API_KEY_FILE'];

function processStart(pid:number) {
  try {const stat=readFileSync(`/proc/${pid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}catch{return undefined;}
}
function captureProcesses(pid:number|undefined,seen:Map<number,string>) {
  if(!pid)return;
  const start=processStart(pid);if(!start)return;seen.set(pid,start);
  try {for(const child of readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number))captureProcesses(child,seen);}catch{}
}
const remaining=(seen:Map<number,string>)=>[...seen].filter(([pid,start])=>processStart(pid)===start).map(([pid])=>pid);

async function listen(server:Server) {
  await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  return `http://127.0.0.1:${(server.address() as {port:number}).port}/v1`;
}
async function close(server:Server) {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}

/** All model traffic is local in mock mode. Tool effects still cross real MCP stdio. */
function mockApi(task:ComparisonTask,provider:Provider,key:string,scenario:Mode2CompareOptions['mockScenario']) {
  const observations:any[]=[];
  const server=createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw),messages=body.messages as any[];
      if(req.headers.authorization!==`Bearer ${key}`)throw new Error('Missing fixture authentication');
      if(body.model!==provider.model.slice(provider.id.length+1))throw new Error('Model changed');
      const system=messages[0];if(system.role!=='system'||!system.content.startsWith(task.systemPrompt??''))throw new Error('System prompt changed');
      const names=body.tools.map((t:any)=>t.function.name).sort();
      if(JSON.stringify(names)!==JSON.stringify(task.tools.map(t=>`clova__${t}`).sort()))throw new Error('Tool set changed');
      const user=messages.findLastIndex(m=>m.role==='user');
      const step=task.steps.find(s=>messages[user]?.content===s.prompt);if(!step)throw new Error('Unknown fixture prompt');
      const after=messages.slice(user+1),done=after.filter(m=>m.role==='tool').length;
      for(const m of after.filter(m=>m.role==='tool'))if(typeof m.tool_call_id!=='string'||typeof m.content!=='string')throw new Error('Tool result history lost');
      observations.push({step:step.id,model:body.model,tools:names,historyMessages:messages.length,toolResults:done});
      const action=done===0?(step.id==='undo'?'artifact_undo':'artifact_write'):step.id==='undo'&&done===1?'artifact_read':undefined;
      const useTool=action&&scenario!=='false_completion';
      const input=action==='artifact_write'?{path:task.file,text:step.expectedText}:action==='artifact_read'?{path:task.file}:{};
      const message=useTool?{role:'assistant',content:null,tool_calls:[{id:`call_${randomUUID()}`,type:'function',function:{name:`clova__${action}`,arguments:JSON.stringify(input)}}]}:{role:'assistant',content:'완료했습니다.'};
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({id:`chatcmpl-${randomUUID()}`,object:'chat.completion',model:body.model,
        choices:[{index:0,message,finish_reason:useTool?'tool_calls':'stop'}],usage:{prompt_tokens:13,completion_tokens:7,total_tokens:20}}));
    }catch{res.writeHead(400,{'content-type':'application/json'});res.end('{"error":{"message":"Fixture request did not match the comparison contract"}}');}
  });
  return {server,observations};
}

async function runProvider(options:{provider:Provider;task:ComparisonTask;cli:string;scratch:string;output:string;environment:NodeJS.ProcessEnv;keyFile:string;live:boolean;mockScenario?:Mode2CompareOptions['mockScenario']}) {
  const {provider,task,cli,scratch,environment,live}=options;
  const dir=join(options.output,provider.id),workspace=join(scratch,provider.id,'workspace');
  mkdirSync(dir,{recursive:true,mode:0o700});mkdirSync(workspace,{recursive:true,mode:0o700});
  const report:any={provider:provider.id,model:provider.model,mode:'2',inference:live?'live':'mock',taskId:task.id,
    usageKind:live?'provider_reported':'synthetic',status:'failed' as Status,pass:false,steps:[],events:[],approvals:[],usage:usageZero(),modelRounds:0,toolCalls:0,toolErrors:0,
    checks:{approvalBeforeFirstWrite:false,approvalBeforeEffects:false,oneSession:false,cleanExit:false,processCleanup:false,jsonlOnly:true,providerCredentialIsolation:true,mcpCredentialIsolation:true,providerObserved:false,mcpObserved:false}};
  const profile=join(scratch,provider.id,'profile.json');
  const ext=existsSync(join(here,'langgraph.mjs'))?'.mjs':'.ts';
  writeFileSync(profile,JSON.stringify({system:task.systemPrompt,maxTurns:task.maxTurnsPerPrompt,timeoutMs:task.timeoutMsPerPrompt,
    toolCallLimits:{clova__artifact_undo:1},servers:[{name:'clova',command:[process.execPath,join(here,`mcp${ext}`),'mcp','--workspace',workspace],
      env:{CLOVA_MCP_ALLOWED_TOOLS:task.tools.join(',')},allowedTools:task.tools}]}),{mode:0o600});
  const keyName=`${provider.prefix}_API_KEY_FILE`,baseName=`${provider.prefix}_BASE_URL`;
  let mock:ReturnType<typeof mockApi>|undefined;
  let proc:ChildProcessWithoutNullStreams|undefined,exited=false,exitCode:number|null=null,done:Promise<void>|undefined;
  const seenPids=new Map<number,string>(),inspectedPids=new Set<number>();
  const started=Date.now();let invalidLines=0;let activeStep:string|undefined;let expectedBeforeEffect:string|null=null;
  const seenApproval=new Set<string>(),seenResult=new Set<string>();
  const sample=()=>{
    captureProcesses(proc?.pid,seenPids);
    for(const pid of seenPids.keys()) {
      if(inspectedPids.has(pid))continue;
      try {
        const cmd=readFileSync(`/proc/${pid}/cmdline`,'utf8');
        const names=readFileSync(`/proc/${pid}/environ`,'utf8').split('\0').map(line=>line.slice(0,line.indexOf('=')));
        if(cmd.includes(`mcp${ext}`)){report.checks.mcpCredentialIsolation&&=!allKeyNames.some(name=>names.includes(name));report.checks.mcpObserved=true;inspectedPids.add(pid);}
        else if(cmd.includes(`langgraph${ext}`)){report.checks.providerCredentialIsolation&&=names.includes(keyName)&&!allKeyNames.filter(n=>n!==keyName).some(name=>names.includes(name));report.checks.providerObserved=true;inspectedPids.add(pid);}
      }catch{}
    }
  };
  try {
    const env:NodeJS.ProcessEnv={PATH:environment.PATH??process.env.PATH,HOME:environment.HOME??process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',
      ELDA_EVENTS_EOF_WAIT:'130',ELDA_CLOVA_ENTRY:join(here,`langgraph${ext}`),ELDA_CLOVA_NODE:process.execPath,ELDA_CLOVA_CONFIG:profile,
      CLOVA_MODEL:provider.model,[keyName]:options.keyFile};
    if(!live){mock=mockApi(task,provider,secretFile(options.keyFile),options.mockScenario??'success');env[baseName]=await listen(mock.server);}
    else if(environment[baseName])env[baseName]=environment[baseName];
    proc=spawn(environment.PYTHON??'python3',[join(cli,'elda'),'clova','--events','--approve','ask','--cwd',workspace],{cwd:workspace,env,stdio:'pipe'});
    const child=proc;
    done=new Promise<void>(r=>child.once('close',code=>{exited=true;exitCode=code;r();}));
    child.once('error',()=>{});child.stderr.resume();child.stdin.on('error',()=>{});
    const send=(operation:object)=>{if(!exited)child.stdin.write(JSON.stringify(operation)+'\n');};
    createInterface({input:child.stdout}).on('line',line=>{
      let event:Event;try{event=JSON.parse(line);if(event.v!==1||!event.data||typeof event.t!=='string')throw new Error();}catch{invalidLines++;return;}
      report.events.push(event);sample();
      if(event.t==='approval'){
        const name=String(event.data.tool??'').replace(/^clova__/,'');
        const path=event.data.input?.path;
        const before=existsSync(join(workspace,task.file))?readFileSync(join(workspace,task.file),'utf8'):null;
        report.checks.approvalBeforeEffects&&=before===expectedBeforeEffect;
        const allowed=task.tools.includes(name)&&(!['artifact_write','artifact_read'].includes(name)||path===task.file);
        seenApproval.add(event.data.callId);
        report.approvals.push({step:activeStep,tool:name,callId:event.data.callId,beforeText:before,allowed});
        send({op:'approve',approvalId:event.data.approvalId,allow:allowed,reason:'isolated mode 2 comparison controller'});
      }
      if(event.t==='tool_result'){
        if(!seenApproval.has(event.data.callId))report.checks.approvalBeforeEffects=false;seenResult.add(event.data.callId);
        expectedBeforeEffect=existsSync(join(workspace,task.file))?readFileSync(join(workspace,task.file),'utf8'):null;
      }
    });
    report.checks.approvalBeforeEffects=true;
    const wait=async(kind:string,from=0,timeout=task.timeoutMsPerPrompt+10000)=>{
      const deadline=Date.now()+timeout;
      while(Date.now()<deadline){sample();const event=report.events.slice(from).find((e:Event)=>e.t===kind);if(event)return event;if(exited)throw new Error(`Elda CLI exited before ${kind}`);await pause(20);}
      throw new Error(`Elda CLI timed out waiting for ${kind}`);
    };
    await wait('ready',0,15000);
    for(const step of task.steps){
      activeStep=step.id;const mark=report.events.length,start=Date.now();send({op:'prompt',text:step.prompt});await wait('idle',mark);
      const events:Event[]=report.events.slice(mark),end=events.find(e=>e.t==='turn_end');
      const calls=events.filter(e=>e.t==='tool_call'),results=events.filter(e=>e.t==='tool_result');
      const names=results.filter(e=>e.data.ok===true).map(e=>String(e.data.tool??'').replace(/^clova__/,''));
      const actual=existsSync(join(workspace,task.file))?readFileSync(join(workspace,task.file),'utf8'):null;
      const checks={turnSucceeded:end?.data.ok===true,fileExact:actual===step.expectedText,
        withinBudget:Number.isInteger(end?.data.turns)&&end!.data.turns>=1&&end!.data.turns<=task.maxTurnsPerPrompt&&Date.now()-start<=task.timeoutMsPerPrompt,
        requiredToolOnce:names.filter(n=>n===step.requiredTool).length===1,
        alsoRequiredTool:!step.alsoRequiredTool||names.includes(step.alsoRequiredTool),
        allToolResultsSucceeded:calls.length>0&&calls.length===results.length&&results.every(e=>e.data.ok===true),
        noErrors:events.every(e=>e.t!=='error'),
        undoWithoutRewrite:step.id!=='undo'||(!names.includes('artifact_write')&&names.indexOf('artifact_undo')<names.indexOf('artifact_read'))};
      const pass=Object.values(checks).every(Boolean);
      if(end)for(const name of Object.keys(report.usage) as (keyof Usage)[])report.usage[name]+=end.data.usage?.[name]??0;
      report.modelRounds+=end?.data.turns??0;report.toolCalls+=calls.length;report.toolErrors+=results.filter(e=>e.data.ok!==true).length;
      report.steps.push({id:step.id,pass,checks,actualText:actual,modelRounds:end?.data.turns??0,usage:end?.data.usage??null,
        sessionId:end?.data.sessionId,tools:names,durationMs:Date.now()-start});
      writeFileSync(join(dir,`${step.id}.txt`),actual??'',{mode:0o600});
      if(!pass)break;
    }
    sample();child.stdin.end();await settle(done,10000);
    report.checks.cleanExit=exited&&exitCode===0;
    report.checks.oneSession=report.steps.length===task.steps.length&&report.steps.every((s:any)=>!!s.sessionId)&&new Set(report.steps.map((s:any)=>s.sessionId)).size===1;
    const firstWrite=report.approvals.find((a:any)=>a.tool==='artifact_write');report.checks.approvalBeforeFirstWrite=firstWrite?.beforeText===null;
    report.checks.approvalBeforeEffects&&=seenResult.size>0&&report.approvals.length===seenResult.size;
  }catch(error){report.error=error instanceof Error?error.message:'Mode 2 comparison failed';}
  finally {
    sample();
    if(proc&&!exited){try{proc.stdin.write(JSON.stringify({op:'interrupt'})+'\n');}catch{}proc.stdin.end();await settle(done!,1000);}
    for(const signal of ['SIGTERM','SIGKILL'] as const){
      const pids=remaining(seenPids);if(!pids.length)break;
      for(const pid of pids.reverse())try{process.kill(pid,signal);}catch{}
      const deadline=Date.now()+1500;while(remaining(seenPids).length&&Date.now()<deadline)await pause(20);
    }
    report.checks.processCleanup=remaining(seenPids).length===0;
    report.checks.jsonlOnly=invalidLines===0;
    report.remainingProcessIds=remaining(seenPids);report.durationMs=Date.now()-started;
    if(mock){await close(mock.server);report.mockRequests=mock.observations;report.httpRequests=mock.observations.length;}
    report.pass=!report.error&&report.steps.length===task.steps.length&&report.steps.every((s:any)=>s.pass)&&Object.values(report.checks).every(Boolean);
    report.status=report.pass?(live?'live_passed':'mock_passed'):'failed';
    writeFileSync(join(dir,'events.jsonl'),report.events.map((e:Event)=>JSON.stringify(clean(e))).join('\n')+'\n',{mode:0o600});
    writeFileSync(join(dir,'report.json'),JSON.stringify(clean(report),null,2)+'\n',{mode:0o600});
  }
  return report;
}

export async function compareMode2(options:Mode2CompareOptions={}) {
  const live=options.live===true,environment=options.environment??process.env;
  const selected=(options.providers??providers.map(p=>p.id)).map(id=>{const p=providers.find(p=>p.id===id);if(!p)throw new Error(`Unsupported provider: ${id}`);return p;});
  if(!selected.length||new Set(selected.map(p=>p.id)).size!==selected.length)throw new Error('Choose one or more distinct providers');
  const task=options.task??JSON.parse(readFileSync(join(here,'fixtures/comparison.json'),'utf8')) as ComparisonTask;
  if(!Number.isInteger(task.maxTurnsPerPrompt)||task.maxTurnsPerPrompt<1||task.maxTurnsPerPrompt>4||!Number.isInteger(task.timeoutMsPerPrompt)||task.timeoutMsPerPrompt<1||task.timeoutMsPerPrompt>120000||task.maxTokens!==2048||task.temperature!==0)throw new Error('Comparison budget must match the bounded shared fixture');
  const output=resolve(options.outputDir??join(here,`mode2-${live?'live':'mock'}.local`));mkdirSync(output,{recursive:true,mode:0o700});
  const scratch=mkdtempSync(join(tmpdir(),'elda-mode2-compare-'));
  const cliSource=resolve(options.cliSource??environment.ELDA_CLI_DIR??join(homedir(),'apps/elda-cli')),cli=join(scratch,'elda-cli');
  const {model:sharedFixtureSourceModel,...sharedTask}=task;
  const report:any={schema:1,createdAt:new Date().toISOString(),mode:'2',inference:live?'live':'mock',usageKind:live?'provider_reported':'synthetic',
    task:sharedTask,sharedFixtureSourceModel,
    integration:'Isolated actual Elda CLI -> thin adapter -> LangGraph -> provider API -> MCP; installed CLI unchanged',
    approvalPolicy:'Test controller approves only the shared fixture file tools. A normal mode 2 client asks the user.',
    results:[],usage:usageZero(),pass:false,allConfigured:false,status:'not_configured',installedCliUnchanged:null};
  let originalHashes:ReturnType<typeof hashes>|undefined;
  try {
    const runnable:{provider:Provider;keyFile:string}[]=[];
    for(const provider of selected){
      let keyFile=live?environment[`${provider.prefix}_API_KEY_FILE`]:join(scratch,`${provider.id}.key`);
      if(!keyFile){report.results.push({provider:provider.id,model:provider.model,mode:'2',inference:'live',status:'not_configured',pass:false,reason:`Set ${provider.prefix}_API_KEY_FILE to a mode-600 credential file`,steps:[]});continue;}
      keyFile=resolve(keyFile);
      if(!live)writeFileSync(keyFile,`mode2-fixture-${provider.id}-${randomUUID()}`,{mode:0o600});
      try{secretFile(keyFile);}catch(error){
        const missing=live&&!!error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT';
        report.results.push({provider:provider.id,model:provider.model,mode:'2',inference:live?'live':'mock',
          status:missing?'not_configured':'failed',pass:false,
          reason:missing?`Create the credential file configured by ${provider.prefix}_API_KEY_FILE with mode 600`:'Credential file must exist, be nonempty, and have mode 600',steps:[]});
        continue;
      }
      runnable.push({provider,keyFile});
    }
    report.allConfigured=runnable.length===selected.length;
    if(runnable.length){
      originalHashes=hashes(cliSource);
      try{report.sourceCliCommit=execFileSync('git',['-C',cliSource,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
      cpSync(cliSource,cli,{recursive:true,filter:path=>!relative(cliSource,path).split(sep).some(part=>['.git','__pycache__'].includes(part))});
      cpSync(join(here,'integration/elda_clova.py'),join(cli,'adapters/clova.py'));
      const patch=join(here,'integration/elda-cli-register.patch');
      // Keep registration local to the CLI copy even when TMPDIR is inside a repo.
      const patchOptions={cwd:cli,env:{...process.env,GIT_CEILING_DIRECTORIES:scratch}};
      execFileSync('git',['apply','--check',patch],patchOptions);execFileSync('git',['apply',patch],patchOptions);
      execFileSync('git',['apply','--reverse','--check',patch],patchOptions);
      if(createHash('sha256').update(readFileSync(join(cli,'elda'))).digest('hex')===originalHashes.elda)throw new Error('CLI registration patch did not change the isolated entry');
      for(const entry of runnable){
        const result=await runProvider({...entry,task,cli,scratch,output,environment,live,mockScenario:options.mockScenario});
        report.results.push(result);for(const field of Object.keys(report.usage) as (keyof Usage)[])report.usage[field]+=result.usage[field];
      }
    }
  }catch(error){report.error=error instanceof Error?error.message:'Comparison setup failed';}
  finally {
    if(originalHashes)report.installedCliUnchanged=JSON.stringify(hashes(cliSource))===JSON.stringify(originalHashes);
    report.results.sort((a:any,b:any)=>selected.findIndex(p=>p.id===a.provider)-selected.findIndex(p=>p.id===b.provider));
    report.pass=!report.error&&report.installedCliUnchanged===true&&report.results.length===selected.length&&report.results.every((r:any)=>r.pass);
    report.status=report.pass?(live?'live_passed':'mock_passed'):report.error||report.results.some((r:any)=>r.status==='failed')?'failed':report.results.some((r:any)=>r.pass)?'partial':'not_configured';
    writeFileSync(join(output,'report.json'),JSON.stringify(clean(report),null,2)+'\n',{mode:0o600});rmSync(scratch,{recursive:true,force:true});
  }
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try {
    const args=process.argv.slice(2);
    if(args.includes('--live')&&args.includes('--mock'))throw new Error('Choose --mock or --live');
    if(args.some((a,i)=>!['--live','--mock','--providers','--output'].includes(a)&&!['--providers','--output'].includes(args[i-1])))throw new Error('Usage: mode2-compare.ts [--mock|--live] [--providers openrouter,groq,zai] [--output DIR]');
    const value=(name:string)=>{const i=args.indexOf(name);if(i===-1)return undefined;const v=args[i+1];if(!v||v.startsWith('--'))throw new Error(`Missing value after ${name}`);return v;};
    const result=await compareMode2({live:args.includes('--live'),providers:value('--providers')?.split(',') as Mode2Provider[]|undefined,outputDir:value('--output')});
    process.stdout.write(JSON.stringify(clean({...result,results:result.results.map((r:any)=>({...r,events:undefined,mockRequests:undefined}))}),null,2)+'\n');
    process.exitCode=result.pass?0:result.status==='not_configured'?2:1;
  }catch(error){process.stderr.write(JSON.stringify(clean({error:error instanceof Error?error.message:'Mode 2 comparison failed'}))+'\n');process.exitCode=2;}
}
