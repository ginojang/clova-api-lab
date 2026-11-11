import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {clean, usageZero, type Usage} from './common.ts';

export type ComparisonStep={id:string;prompt:string;expectedText:string;requiredTool:string;alsoRequiredTool?:string};
export type ComparisonTask={id:string;model:string;temperature:number;maxTokens:number;systemPrompt?:string;maxTurnsPerPrompt:number;timeoutMsPerPrompt:number;tools:string[];file:string;steps:ComparisonStep[]};
type Event={v:number;seq:number;t:string;ts:string;data:Record<string,any>};
export type GraphProbeOptions={task:ComparisonTask;mode:'2'|'3';outputDir:string;inference:'mock'|'live';model?:string;workspace?:string};
const here=fileURLToPath(new URL('.',import.meta.url));
const pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));

/** Runs the framework harness itself. Assertions inspect real files and tool results. */
export async function runGraphProbe(options:GraphProbeOptions) {
  const {task,mode,inference}=options;
  const root=mkdtempSync(join(tmpdir(),'clova-graph-probe-'));
  const workspace=options.workspace??join(root,'workspace');mkdirSync(workspace,{recursive:true,mode:0o700});
  const outputDir=resolve(options.outputDir);mkdirSync(outputDir,{recursive:true,mode:0o700});
  const ext=existsSync(join(here,'langgraph.mjs'))?'.mjs':'.ts';
  const profile=join(root,'profile.json');
  writeFileSync(profile,JSON.stringify({maxTurns:task.maxTurnsPerPrompt,timeoutMs:task.timeoutMsPerPrompt,
    system:task.systemPrompt,
    toolCallLimits:{clova__artifact_undo:1},
    servers:[{name:'clova',command:[process.execPath,join(here,`mcp${ext}`),'mcp','--workspace',workspace],
      env:{CLOVA_MCP_ALLOWED_TOOLS:task.tools.join(',')},allowedTools:task.tools}],
  }),{mode:0o600});
  const started=Date.now();
  const report:any={harness:'langgraph',mode,inference,taskId:task.id,model:task.model,
    parameters:{temperature:task.temperature,maxTokens:task.maxTokens,maxTurnsPerPrompt:task.maxTurnsPerPrompt,timeoutMsPerPrompt:task.timeoutMsPerPrompt},
    steps:[],usage:usageZero(),approvals:0,toolCalls:0,toolErrors:0,pass:false,events:[]};
  let child:ChildProcessWithoutNullStreams|undefined;
  try {
    child=spawn(process.execPath,[join(here,`langgraph${ext}`),'--events','--workspace',workspace,
      '--model',options.model??`clova:${task.model}`,'--config',profile,'--approve',mode==='2'?'ask':'never'],{
      cwd:workspace,stdio:'pipe',env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',
        CLOVA_API_KEY_FILE:process.env.CLOVA_API_KEY_FILE,CLOVA_BASE_URL:process.env.CLOVA_BASE_URL},
    });
    const proc=child;let stderr='';let exitCode:number|null=null;let exited=false;
    const done=new Promise<void>(r=>proc.once('close',code=>{exitCode=code;exited=true;r();}));
    proc.once('error',()=>{stderr+='Harness could not start';});proc.stderr.on('data',data=>{stderr+=data;});proc.stdin.on('error',()=>{});
    const send=(data:object)=>proc.stdin.write(JSON.stringify(data)+'\n');
    createInterface({input:proc.stdout}).on('line',line=>{
      let event:Event;try {event=JSON.parse(line);} catch {stderr+='Invalid harness JSONL';return;}
      report.events.push(event);
      if(event.t==='approval'){
        report.approvals++;
        const name=String(event.data.tool??'').replace(/^clova__/,'');
        const permitted=mode==='2'&&task.tools.includes(name);
        send({op:'approve',approvalId:event.data.approvalId,allow:permitted,reason:'isolated comparison test'});
      }
    });
    const wait=async(type:string,from=0,timeout=task.timeoutMsPerPrompt+5000)=>{
      const deadline=Date.now()+timeout;
      while(Date.now()<deadline){const found=report.events.slice(from).find((e:Event)=>e.t===type);if(found)return found;if(exited)throw new Error(`Harness exited before ${type}: ${stderr.slice(-400)}`);await pause(20);}
      throw new Error(`Harness timeout waiting for ${type}`);
    };
    await wait('ready',0,15000);
    for(const step of task.steps){
      const mark=report.events.length;const start=Date.now();send({op:'prompt',text:step.prompt});await wait('idle',mark);
      const events:Event[]=report.events.slice(mark);const end=events.find(e=>e.t==='turn_end');
      const toolCalls=events.filter(e=>e.t==='tool_call');const toolResults=events.filter(e=>e.t==='tool_result');
      report.toolCalls+=toolCalls.length;report.toolErrors+=toolResults.filter(e=>e.data.ok===false).length;
      if(end)for(const k of Object.keys(report.usage) as (keyof Usage)[])report.usage[k]+=end.data.usage?.[k]??0;
      const file=join(workspace,task.file),actual=existsSync(file)?readFileSync(file,'utf8'):null;
      const names=toolResults.filter(e=>e.data.ok===true).map(e=>String(e.data.tool??'').replace(/^clova__/,''));
      const pass=!!end?.data.ok&&actual===step.expectedText&&names.filter(n=>n===step.requiredTool).length===1&&(!step.alsoRequiredTool||names.includes(step.alsoRequiredTool))&&
        (step.id!=='undo'||(names.filter(n=>n==='artifact_undo').length===1&&!names.includes('artifact_write')));
      report.steps.push({id:step.id,pass,artifactMatches:actual===step.expectedText,actualText:actual,
        durationMs:Date.now()-start,modelCalls:end?.data.turns??0,toolCalls:toolCalls.length,toolErrors:toolResults.filter(e=>e.data.ok===false).length,usage:end?.data.usage??usageZero(),sessionId:end?.data.sessionId});
      writeFileSync(join(outputDir,`${step.id}.txt`),actual??'',{mode:0o600});
      if(!pass)break;
    }
    proc.stdin.end();
    const kill=setTimeout(()=>proc.kill('SIGKILL'),5000);await done;clearTimeout(kill);
    report.cleanExit=exitCode===0;
    report.sessionPreserved=new Set(report.steps.map((s:any)=>s.sessionId)).size===1;
    report.pass=report.steps.length===task.steps.length&&report.steps.every((s:any)=>s.pass)&&report.cleanExit&&report.sessionPreserved&&(mode!=='3'||report.approvals===0);
    child=undefined;
  }catch(error){report.error=error instanceof Error?error.message:'Graph probe failed';}
  finally{
    if(child&&child.exitCode===null){child.stdin.end();child.kill('SIGTERM');await Promise.race([new Promise<void>(r=>child!.once('close',()=>r())),pause(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}
    report.durationMs=Date.now()-started;
    writeFileSync(join(outputDir,'report.json'),JSON.stringify(clean(report),null,2)+'\n',{mode:0o600});
    writeFileSync(join(outputDir,'events.jsonl'),report.events.map((e:Event)=>JSON.stringify(clean(e))).join('\n')+'\n',{mode:0o600});
    rmSync(root,{recursive:true,force:true});
  }
  return report;
}
