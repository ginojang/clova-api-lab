#!/usr/bin/env node
/** Paid opt-in verification using an isolated, patched copy of the actual Elda CLI. */
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import type {ComparisonTask} from './graph-probe.ts';
import {join,resolve,relative,sep} from 'node:path';

const argv=process.argv.slice(2);
if(!argv.includes('--live'))throw new Error('This probe makes paid CLOVA calls. Explicit --live is required.');
if(!process.env.CLOVA_API_KEY_FILE)throw new Error('CLOVA_API_KEY_FILE is required (mode 600).');
const here=fileURLToPath(new URL('.',import.meta.url));
const task:ComparisonTask=JSON.parse(readFileSync(join(here,'fixtures/comparison.json'),'utf8'));
if(task.maxTurnsPerPrompt>4||task.timeoutMsPerPrompt>120000)throw new Error('This live probe is capped at 4 model rounds and 120 seconds per prompt.');
const cliSource=resolve(process.env.ELDA_CLI_DIR??join(homedir(),'apps/elda-cli')),keyFile=resolve(process.env.CLOVA_API_KEY_FILE);
const output=resolve(argv.includes('--output')?argv[argv.indexOf('--output')+1]:join(here,'comparison-elda-live.local'));
mkdirSync(output,{recursive:true,mode:0o700});
const scratch=mkdtempSync(join(tmpdir(),'clova-elda-live-final-')),cli=join(scratch,'elda-cli');
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const sourceNames=['elda','events.py','adapters/loop.py','providers/__init__.py','mcp_client.py'];
const hashes=()=>Object.fromEntries(sourceNames.map(file=>[file,createHash('sha256').update(readFileSync(join(cliSource,file))).digest('hex')]));
const originalHashes=hashes();
const result:any={taskId:task.id,inference:'live',model:task.model,sourceCliCommit:execFileSync('git',['-C',cliSource,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  integration:'isolated Elda CLI copy with registration patch and thin JSONL adapter -> LangGraph -> native CLOVA API; installed CLI unchanged',
  parameters:{temperature:task.temperature,maxTokens:task.maxTokens,maxTurnsPerPrompt:task.maxTurnsPerPrompt,timeoutMsPerPrompt:task.timeoutMsPerPrompt},
  modes:[],usage:{input:0,output:0,cacheRead:0,cacheWrite:0},pass:false};

function descendants(pid:number|undefined,seen=new Set<number>()){
  if(!pid||seen.has(pid))return seen;seen.add(pid);
  try {for(const child of readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number))descendants(child,seen);}catch{}
  return seen;
}
function alive(pid:number){try {process.kill(pid,0);return true;}catch{return false;}}

try {
  cpSync(cliSource,cli,{recursive:true,filter:path=>!relative(cliSource,path).split(sep).some(part=>['.git','__pycache__'].includes(part))});
  cpSync(join(here,'integration/elda_clova.py'),join(cli,'adapters/clova.py'));
  const patch=join(here,'integration/elda-cli-register.patch');
  // A project-local TMPDIR must not make git apply relative to the parent repo.
  const patchOptions={cwd:cli,env:{...process.env,GIT_CEILING_DIRECTORIES:scratch}};
  execFileSync('git',['apply','--check',patch],patchOptions);execFileSync('git',['apply',patch],patchOptions);
  execFileSync('git',['apply','--reverse','--check',patch],patchOptions);
  if(createHash('sha256').update(readFileSync(join(cli,'elda'))).digest('hex')===originalHashes.elda)throw new Error('CLI registration patch did not change the isolated entry');
  for(const mode of ['2','3']){
    const started=Date.now(),modeOutput=join(output,`mode-${mode}`),workspace=join(scratch,`workspace-${mode}`);
    mkdirSync(modeOutput,{recursive:true,mode:0o700});mkdirSync(workspace,{mode:0o700});
    const profile=join(scratch,`profile-${mode}.json`);
    writeFileSync(profile,JSON.stringify({system:task.systemPrompt,maxTurns:task.maxTurnsPerPrompt,timeoutMs:task.timeoutMsPerPrompt,toolCallLimits:{clova__artifact_undo:1},
      servers:[{name:'clova',command:[process.execPath,join(here,'mcp.ts'),'mcp','--workspace',workspace],env:{CLOVA_MCP_ALLOWED_TOOLS:task.tools.join(',')},allowedTools:task.tools}],
    }),{mode:0o600});
    const report:any={mode,inference:'live',taskId:task.id,model:task.model,steps:[],events:[],approvals:[],usage:{input:0,output:0,cacheRead:0,cacheWrite:0},rounds:0,toolCalls:0,toolErrors:0,pass:false};
    result.modes.push(report);
    const proc=spawn('python3',[join(cli,'elda'),'clova','--events','--approve',mode==='2'?'ask':'auto','--cwd',workspace],{
      cwd:workspace,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',ELDA_EVENTS_EOF_WAIT:'130',ELDA_CLOVA_ENTRY:join(here,'langgraph.ts'),ELDA_CLOVA_NODE:process.execPath,ELDA_CLOVA_CONFIG:profile,
        CLOVA_MODEL:`clova:${task.model}`,CLOVA_API_KEY_FILE:keyFile},stdio:'pipe',
    });
    let exited=false,exitCode:number|null=null,stderr='',activeStep:string|undefined;
    const seenPids=new Set<number>();
    const sample=()=>{for(const pid of descendants(proc.pid))seenPids.add(pid);};
    const done=new Promise<void>(resolve=>proc.once('close',code=>{exited=true;exitCode=code;resolve();}));
    proc.once('error',()=>{stderr+='Elda CLI spawn failed';});proc.stderr.on('data',value=>stderr+=value);proc.stdin.on('error',()=>{});
    const send=(op:object)=>proc.stdin.write(JSON.stringify(op)+'\n');
    createInterface({input:proc.stdout}).on('line',line=>{
      let event;try {event=JSON.parse(line);}catch{stderr+='Invalid JSONL';return;}
      report.events.push(event);sample();
      if(event.t==='approval'){
        const name=String(event.data.tool??'').replace(/^clova__/,'');
        const file=join(workspace,task.file),before=existsSync(file)?readFileSync(file,'utf8'):null;
        const allowed=mode==='2'&&task.tools.includes(name)&&(!['artifact_write','artifact_read'].includes(name)||event.data.input?.path===task.file);
        report.approvals.push({step:activeStep,tool:name,callId:event.data.callId,beforeText:before,allowed});
        send({op:'approve',approvalId:event.data.approvalId,allow:allowed,reason:'authorized isolated HCX-005 integration test'});
      }
    });
    const wait=async(type:string,from=0,timeout=task.timeoutMsPerPrompt+10000)=>{
      const deadline=Date.now()+timeout;
      while(Date.now()<deadline){const found=report.events.slice(from).find((e:any)=>e.t===type);if(found)return found;if(exited)throw new Error(`Elda CLI exited before ${type}`);await pause(20);}
      throw new Error(`Elda CLI timeout before ${type}`);
    };
    try {
      await wait('ready',0,15000);
      for(const step of task.steps){
        activeStep=step.id;const mark=report.events.length,start=Date.now();send({op:'prompt',text:step.prompt});await wait('idle',mark);
        const events=report.events.slice(mark),end=events.find((e:any)=>e.t==='turn_end');
        const calls=events.filter((e:any)=>e.t==='tool_call'),toolResults=events.filter((e:any)=>e.t==='tool_result');
        const good=toolResults.filter((e:any)=>e.data.ok===true).map((e:any)=>String(e.data.tool).replace(/^clova__/,''));
        const file=join(workspace,task.file),actual=existsSync(file)?readFileSync(file,'utf8'):null;
        const pass=!!end?.data.ok&&actual===step.expectedText&&good.filter((n:string)=>n===step.requiredTool).length===1&&(!step.alsoRequiredTool||good.includes(step.alsoRequiredTool))&&(step.id!=='undo'||!good.includes('artifact_write'));
        if(end)for(const field of Object.keys(report.usage))report.usage[field]+=end.data.usage?.[field]??0;
        report.rounds+=end?.data.turns??0;report.toolCalls+=calls.length;report.toolErrors+=toolResults.filter((e:any)=>!e.data.ok).length;
        report.steps.push({id:step.id,pass,fileExact:actual===step.expectedText,actualText:actual,rounds:end?.data.turns??0,usage:end?.data.usage??null,sessionId:end?.data.sessionId,tools:good,errors:events.filter((e:any)=>e.t==='error').map((e:any)=>e.data),durationMs:Date.now()-start});
        writeFileSync(join(modeOutput,`${step.id}.txt`),actual??'',{mode:0o600});
        console.log(JSON.stringify({mode,step:step.id,pass,rounds:end?.data.turns,usage:end?.data.usage}));
        if(!pass)break;
      }
      sample();proc.stdin.end();const kill=setTimeout(()=>proc.kill('SIGTERM'),10000);await done;clearTimeout(kill);
      report.cleanExit=exitCode===0;
      report.sessionPreserved=new Set(report.steps.map((s:any)=>s.sessionId)).size===1;
      report.approvalBeforeFirstWrite=mode==='2'?report.approvals[0]?.beforeText===null:null;
      report.pass=report.steps.length===task.steps.length&&report.steps.every((s:any)=>s.pass)&&report.cleanExit&&report.sessionPreserved&&(mode==='2'?report.approvalBeforeFirstWrite:report.approvals.length===0);
    }catch(error){report.error=error instanceof Error?error.message:'Elda CLI probe failed';}
    finally {
      sample();if(!exited){send({op:'interrupt'});proc.stdin.end();await Promise.race([done,pause(5000)]);}
      if(!exited){for(const pid of [...seenPids].reverse())try{process.kill(pid,'SIGTERM');}catch{}await Promise.race([done,pause(2000)]);}
      await pause(100);report.observedProcessIds=[...seenPids];report.remainingProcessIds=[...seenPids].filter(alive);
      report.processCleanup=report.remainingProcessIds.length===0;
      if(!report.processCleanup){for(const pid of report.remainingProcessIds)try{process.kill(pid,'SIGKILL');}catch{}report.pass=false;}
      report.durationMs=Date.now()-started;
      report.outputWasJsonl=!stderr.includes('Invalid JSONL');
      if(!report.outputWasJsonl||report.toolErrors!==0)report.pass=false;
      writeFileSync(join(modeOutput,'events.jsonl'),report.events.map((e:any)=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
      writeFileSync(join(modeOutput,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
      for(const field of Object.keys(result.usage))result.usage[field]+=report.usage[field];
    }
  }
  result.installedCliUnchanged=JSON.stringify(hashes())===JSON.stringify(originalHashes);
  result.pass=result.installedCliUnchanged&&result.modes.length===2&&result.modes.every((m:any)=>m.pass);
} catch(error){result.error=error instanceof Error?error.message:'Elda CLI probe failed';}
finally {
  writeFileSync(join(output,'report.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  rmSync(scratch,{recursive:true,force:true});
}
console.log(JSON.stringify({pass:result.pass,usage:result.usage,modes:result.modes.map((m:any)=>({mode:m.mode,pass:m.pass,rounds:m.rounds,toolCalls:m.toolCalls,toolErrors:m.toolErrors,approvals:m.approvals.length,sessionPreserved:m.sessionPreserved,processCleanup:m.processCleanup,error:m.error})),installedCliUnchanged:result.installedCliUnchanged,report:join(output,'report.json')}));
if(!result.pass)process.exitCode=1;
