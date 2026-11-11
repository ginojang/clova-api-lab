#!/usr/bin/env node
/** Opt-in live probe: the installed Elda CLI owns the agent loop and MCP. */
import {spawn, execFileSync, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir, tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createWrapper} from './http.ts';
import {clean, usageZero, type Usage} from './common.ts';

type Event = {v:number;seq:number;ts:string;t:string;data:Record<string,any>};
const args=process.argv.slice(2);
const option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const here=fileURLToPath(new URL('.',import.meta.url));
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const sources=['events.py','adapters/loop.py','providers/__init__.py','providers/openai_compat.py','mcp_client.py'];

async function main() {
  if(!args.includes('--live'))throw new Error('Live CLOVA calls require explicit --live. Use the free elda-modes.test.ts first.');
  const cliDir=resolve(process.env.ELDA_CLI_DIR??join(homedir(),'apps/elda-cli'));
  const tokenFile=process.env.CLOVA_WRAPPER_TOKEN_FILE;
  if(!tokenFile||!process.env.CLOVA_API_KEY_FILE)throw new Error('CLOVA_WRAPPER_TOKEN_FILE and CLOVA_API_KEY_FILE are required (distinct mode-600 files).');
  const selected=option('--mode')??'both';
  if(!['2','3','both'].includes(selected))throw new Error('--mode must be 2, 3 or both');
  const model=process.env.CLOVA_MODEL?.replace(/^clova:/,'')??'HCX-005';
  const maxTurns=Number(option('--max-turns')??4);
  if(!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>6)throw new Error('--max-turns must be 1..6');
  const out=resolve(option('--out')??'results.local/elda-cli-live');mkdirSync(out,{recursive:true,mode:0o700});
  const scratch=mkdtempSync(join(tmpdir(),'clova-elda-live-'));
  const hashes=()=>Object.fromEntries(sources.map(file=>[file,createHash('sha256').update(readFileSync(join(cliDir,file))).digest('hex')]));
  const before=hashes();
  const report:any={at:new Date().toISOString(),live:true,model,cliDir,
    cliCommit:execFileSync('git',['-C',cliDir,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    integration:'test profile bootstrap; original Elda CLI events, LoopAdapter, OpenAICompat and MCP client; no CLI installation or registry change',
    maxTurnsPerPrompt:maxTurns,maxPromptsPerMode:3,modes:[],usage:usageZero(),pass:false};
  const wrapper=createWrapper({tokenFile,allowedModels:[model]});
  let running:ChildProcessWithoutNullStreams|undefined;
  try {
    await new Promise<void>((resolve,reject)=>{wrapper.once('error',reject);wrapper.listen(0,'127.0.0.1',resolve);});
    const base=`http://127.0.0.1:${(wrapper.address() as {port:number}).port}`;
    for(const mode of selected==='both'?['2','3']: [selected]) {
      const workspace=join(scratch,`mode-${mode}`);mkdirSync(workspace,{mode:0o700});
      const profile=join(workspace,'profile.json');
      writeFileSync(profile,JSON.stringify({model:`openai-compat:${model}@${base}/v1`,max_turns:maxTurns,
        system:'You are testing a local file tool. Execute exactly the requested artifact_write or artifact_read once, then stop. Do not call batch or clova_chat. Do not perform unrelated work.',
        servers:[{name:'clova',command:[process.execPath,join(here,'mcp.ts'),'mcp','--workspace',workspace]}],
      }),{mode:0o600});
      const proc=spawn(process.env.PYTHON??'python3',[join(here,'test/elda-session.py'),'--cli-dir',cliDir,'--profile',profile,'--workspace',workspace,'--mode',mode,'--token-file',resolve(tokenFile)],{
        cwd:workspace,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',ELDA_EVENTS_EOF_WAIT:'10'},stdio:'pipe',
      });running=proc;
      const events:Event[]=[],approvalChecks:any[]=[];let stderr='';
      const exit=new Promise<number|null>((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
      proc.stderr.on('data',chunk=>{stderr+=chunk;});proc.stdin.on('error',()=>{});
      const send=(value:object)=>proc.stdin.write(JSON.stringify(value)+'\n');
      createInterface({input:proc.stdout}).on('line',line=>{
        let event:Event;try {event=JSON.parse(line);} catch {stderr+='\nInvalid JSONL';return;}
        events.push(event);
        if(event.t==='approval') {
          const previous=existsSync(join(workspace,'probe.txt'))?readFileSync(join(workspace,'probe.txt'),'utf8'):null;
          approvalChecks.push({callId:event.data.callId,beforeText:previous,tool:event.data.tool});
          // This dedicated test approves only its known file operations. The
          // normal mode-2 session remains interactive outside this probe.
          const allowed=['artifact_write','artifact_read'].includes(event.data.tool);
          send({op:'approve',approvalId:event.data.approvalId,allow:allowed,reason:'explicit CLOVA integration test'});
        }
      });
      const wait=async(type:string,from=0)=>{
        const deadline=Date.now()+180000;
        while(Date.now()<deadline){const found=events.slice(from).find(e=>e.t===type);if(found)return found;if(proc.exitCode!==null)break;await pause(20);}
        throw new Error(`mode ${mode}: ${type} missing; ${stderr.slice(-500)}`);
      };
      const result:any={mode,pass:false,turns:[],approvalChecks,events};report.modes.push(result);
      await wait('ready');
      const first=`clova-mode-${mode}-${randomUUID()}`,second=first+'-updated';
      const prompts=[
        `Call artifact_write exactly once: path="probe.txt", text="${first}". Then stop.`,
        `Call artifact_write exactly once: path="probe.txt", text="${second}". Then stop.`,
        'Call artifact_read exactly once with path="probe.txt". Return the exact text read, then stop.',
      ];
      for(const [index,prompt] of prompts.entries()) {
        const mark=events.length;send({op:'prompt',text:prompt});await wait('idle',mark);
        const turn=events.slice(mark),end=turn.find(e=>e.t==='turn_end');
        if(end)for(const key of Object.keys(report.usage) as (keyof Usage)[])report.usage[key]+=Number(end.data.usage?.[key]??0);
        if(!end?.data.ok)throw new Error(`mode ${mode} prompt ${index+1} failed: ${JSON.stringify(turn.filter(e=>e.t==='error').map(e=>e.data))}`);
        const toolResults=turn.filter(e=>e.t==='tool_result');
        if(toolResults.length!==1||toolResults[0].data.ok!==true)throw new Error(`mode ${mode} prompt ${index+1} did not execute exactly one successful tool`);
        const actual=readFileSync(join(workspace,'probe.txt'),'utf8');
        if(actual!==(index===0?first:second))throw new Error(`mode ${mode}: artifact content mismatch`);
        if(index===2&&!String(toolResults[0].data.output).includes(second))throw new Error(`mode ${mode}: read result mismatch`);
        result.turns.push({index:index+1,...end.data,artifactMatches:true});
      }
      if(new Set(result.turns.map((t:any)=>t.sessionId)).size!==1)throw new Error(`mode ${mode}: session was not preserved`);
      if(mode==='2'&&(approvalChecks.length!==3||approvalChecks[0].beforeText!==null||approvalChecks[1].beforeText!==first))throw new Error('mode 2: approval was not observed before the writes');
      if(mode==='3'&&approvalChecks.length)throw new Error('mode 3: unexpected approval');
      proc.stdin.end();
      const timer=setTimeout(()=>proc.kill('SIGKILL'),15000);
      try {if(await exit!==0)throw new Error(`mode ${mode}: CLI process did not shut down cleanly`);} finally {clearTimeout(timer);}
      running=undefined;result.pass=true;
      writeFileSync(join(out,`mode-${mode}.events.jsonl`),events.map(event=>JSON.stringify(clean(event))).join('\n')+'\n',{mode:0o600});
    }
    report.pass=true;
  } catch(error) {report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
  finally {
    if(running&&running.exitCode===null){running.stdin.end();const processDone=new Promise<void>(resolve=>running!.once('close',()=>resolve()));const timer=setTimeout(()=>running?.kill('SIGKILL'),15000);await processDone;clearTimeout(timer);}
    wrapper.closeAllConnections();await new Promise<void>(resolve=>wrapper.close(()=>resolve()));
    report.cliSourcesUnchanged=JSON.stringify(before)===JSON.stringify(hashes());
    if(!report.cliSourcesUnchanged){report.pass=false;process.exitCode=1;}
    report.cliSources=before;
    writeFileSync(join(out,'report.json'),JSON.stringify(clean(report),null,2)+'\n',{mode:0o600});
    rmSync(scratch,{recursive:true,force:true});
  }
  console.log(JSON.stringify({pass:report.pass,report:join(out,'report.json'),usage:report.usage,error:report.error}));
}

main().catch(error=>{console.error(error instanceof Error?error.message:'live integration failed');process.exitCode=1;});
