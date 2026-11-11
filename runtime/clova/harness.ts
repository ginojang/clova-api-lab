#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,appendFileSync,realpathSync,readdirSync,statSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Brain} from './provider.ts';
import {Mcp} from './client.ts';
import {Fault,clean,usageZero,type Message,type Tool,type Usage} from './common.ts';

type Hook = {command:string[];onFailure?:'continue'|'block';timeoutMs?:number};
type Config = {toolCallLimits?:Record<string,number>;model?:string;system?:string;maxTurns?:number;timeoutMs?:number;maxBudgetUsd?:number;prices?:{input:number;output:number;cacheRead:number;cacheWrite:number};servers?:{name:string;command:string[];env?:Record<string,string>;allowedTools?:string[]}[];hooks?:Record<string,Hook>};
const args=process.argv.slice(2);
const option=(k:string)=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
let seq=0,sessionId=randomUUID(),recordDir:string|undefined;
function emit(t:string,data:object={}) {
  const line=JSON.stringify(clean({v:1,seq:++seq,ts:new Date().toISOString(),t,data}))+'\n';
  process.stdout.write(line);
  if(recordDir)appendFileSync(join(recordDir,`${sessionId}.jsonl`),line,{mode:0o600});
}
async function main() {
  if(!args.includes('--events')||!option('--workspace'))throw new Fault('configuration','Usage: clova-harness --events --workspace DIR [--config FILE] [--model clova:HCX-005]');
  const configPath=option('--config');
  const config:Config=configPath?JSON.parse(readFileSync(configPath,'utf8')):{};
  const model=option('--model')??process.env.CLOVA_MODEL??config.model??'clova:HCX-005';
  const brain=new Brain(model);
  const maxTurns=Number(process.env.CLOVA_MAX_TURNS??config.maxTurns??12),timeoutMs=config.timeoutMs??300000;
  if(!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>100||!Number.isFinite(timeoutMs)||timeoutMs<1)throw new Fault('configuration','invalid turn or time limit');
  if(config.maxBudgetUsd!==undefined && (!(config.maxBudgetUsd>0)||(!model.startsWith('scripted:')&&!config.prices)))throw new Fault('configuration','a positive budget and explicit prices per 1M tokens are required');
  if(config.prices&&Object.values(config.prices).some(p=>!Number.isFinite(p)||p<0))throw new Fault('configuration','invalid prices');
  if(config.toolCallLimits&&Object.values(config.toolCallLimits).some(n=>!Number.isInteger(n)||n<0))throw new Fault('configuration','toolCallLimits must contain nonnegative integers');
  const ws=resolve(option('--workspace')!);mkdirSync(ws,{recursive:true,mode:0o700});
  const workspace=realpathSync(ws);
  recordDir=option('--records')?resolve(option('--records')!):undefined;
  if(recordDir){mkdirSync(recordDir,{recursive:true,mode:0o700});for(const f of readdirSync(recordDir)){if(f.endsWith('.jsonl')&&Date.now()-statSync(join(recordDir,f)).mtimeMs>90*86400000)rmSync(join(recordDir,f));}}
  const clients:Mcp[]=[],available=new Map<string,{client:Mcp;original:string}>();
  const allTools:Tool[]=[];
  let instructions='';
  const servers=config.servers??[{name:'clova',command:[process.execPath,join(dirname(fileURLToPath(import.meta.url)),import.meta.url.endsWith('.mjs')?'mcp.mjs':'mcp.ts'),'mcp','--workspace','{workspace}'],allowedTools:['artifact_list','artifact_read','artifact_write','artifact_undo']}];
  try {
    for(const server of servers){
      if(!/^[a-z][a-z0-9_]*$/.test(server.name))throw new Fault('configuration','invalid MCP server name');
      const client=new Mcp(server.command.map(s=>s.replaceAll('{workspace}',workspace)),workspace,server.env);clients.push(client);
      const init=await client.initialize();instructions+='\n'+init.instructions;
      for(const tool of init.tools){
        if(server.allowedTools&&!server.allowedTools.includes(tool.name))continue;
        const name=`${server.name}__${tool.name}`;
        if(available.has(name))throw new Fault('configuration','duplicate MCP tool');
        available.set(name,{client,original:tool.name});allTools.push({...tool,name});
      }
    }
    const system:Message={role:'system',content:(config.system??'Complete the user task using only available tools. Never claim a tool succeeded when it failed.')+instructions};
    let history:Message[]=[system],cost=0,active:AbortController|undefined,job:Promise<void>|undefined,closing=false,poisoned=false;
    const notifyQueue:string[]=[];
    async function hook(name:string,fields:object,signal:AbortSignal):Promise<any>{
      const h=config.hooks?.[name];if(!h)return {};
      try {
        return await new Promise((res,rej)=>{
          const p=spawn(h.command[0],h.command.slice(1),{cwd:workspace,env:{PATH:process.env.PATH,HOME:process.env.HOME},stdio:'pipe'});
          let out='';let settled=false;
          const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?rej(error):res(value);};
          const abort=()=>{p.kill('SIGKILL');finish(new Error('hook interrupted'));};
          const timer=setTimeout(()=>{p.kill('SIGKILL');finish(new Error('hook timeout'));},h.timeoutMs??60000);
          signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
          p.on('error',e=>finish(e));p.stdin.on('error',()=>{});p.stderr.resume();
          p.stdout.on('data',d=>{out+=d;if(out.length>1048576)abort();});
          p.on('close',code=>{try{if(code!==0)throw new Error('hook failed');finish(undefined,out.trim()?JSON.parse(out):{});}catch(e){finish(e as Error);}});
          p.stdin.end(JSON.stringify({session_id:sessionId,cwd:workspace,hook_event_name:name,...fields}));
        });
      }catch{if(h.onFailure==='continue')return {};throw new Fault('hook_error',`${name} hook failed`);}
    }
    async function turn(prompt:string){
      const controller=new AbortController();active=controller;
      let timedOut=false;
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      const executed=new Map<string,number>();
      const started=Date.now(),usage=usageZero();let turns=0,toolCalls=0,retried=false,stopActive=false;
      const messages:Message[]=structuredClone(history);messages.push(...notifyQueue.splice(0).map(content=>({role:'user' as const,content})),{role:'user',content:prompt});
      emit('turn_start',{sessionId});
      const finish=(ok:boolean,endReason:string,status?:number)=>{
        emit('turn_end',{ok,turns,toolCalls,usage,durationMs:Date.now()-started,model,sessionId,messages:messages.length,endReason,...(status?{apiErrorStatus:status}:{})});
        if(recordDir)appendFileSync(join(recordDir,'summaries.ndjson'),JSON.stringify(clean({sessionId,at:new Date().toISOString(),ok,endReason,turns,toolCalls,usage,costUsd:cost,durationMs:Date.now()-started}))+'\n',{mode:0o600});
      };
      try {
        const before=await hook('UserPromptSubmit',{prompt},controller.signal);
        if(before.continue===false||before.decision==='block')throw new Fault('denied','prompt blocked by policy');
        if(before.hookSpecificOutput?.additionalContext)messages.push({role:'user',content:String(before.hookSpecificOutput.additionalContext)});
        while(turns<maxTurns){
          if(config.maxBudgetUsd!==undefined&&cost>=config.maxBudgetUsd)throw new Fault('budget_exceeded','session cost cap reached');
          let answer;
          try {answer=await brain.call(messages,allTools,controller.signal);}
          catch(e){if(e instanceof Fault&&e.usage){turns++;for(const k of Object.keys(usage) as (keyof Usage)[]){usage[k]+=e.usage[k];cost+=e.usage[k]*(config.prices?.[k]??0)/1000000;}}if(!retried&&toolCalls===0&&e instanceof Fault&&[429,500,502,503,529].includes(e.status??0)){retried=true;continue;}throw e;}
          turns++;
          for(const k of Object.keys(usage) as (keyof Usage)[]){usage[k]+=answer.usage[k];cost+=answer.usage[k]*(config.prices?.[k]??0)/1000000;}
          controller.signal.throwIfAborted();
          const m=answer.message;
          if(answer.finishReason==='length')throw new Fault('truncated','CLOVA output was truncated');
          messages.push(m);
          if(config.maxBudgetUsd!==undefined&&cost>=config.maxBudgetUsd)throw new Fault('budget_exceeded','session cost cap reached after model response');
          if(m.content&&m.toolCalls?.length){emit('text_delta',{text:m.content});emit('text',{text:m.content});}
          if(m.toolCalls?.length){
            for(const call of m.toolCalls){
              const target=available.get(call.function.name);let input=call.function.arguments;
              const pre=await hook('PreToolUse',{tool_name:call.function.name,tool_input:input,tool_use_id:call.id},controller.signal);
              const decision=pre.hookSpecificOutput?.permissionDecision;
              const limit=config.toolCallLimits?.[call.function.name];
              const limited=limit!==undefined&&(executed.get(call.function.name)??0)>=limit;
              const denied=limited||!target||pre.continue===false||pre.decision==='block'||['deny','ask','defer'].includes(decision);
              if(pre.hookSpecificOutput?.updatedInput)input=pre.hookSpecificOutput.updatedInput;
              emit('tool_call',{tool:call.function.name,callId:call.id,input});
              let output:unknown,ok=false;
              if(denied)output=limited?'denied: this tool already reached its per-turn execution limit; use the previous result and do not repeat it':'denied: tool is not allowed by policy';
              else {
                // Any interrupted/failed transport after dispatch makes workspace state uncertain.
                toolCalls++;executed.set(call.function.name,(executed.get(call.function.name)??0)+1);
                try {const r=await target.client.request('tools/call',{name:target.original,arguments:input},controller.signal);output=r;ok=!r.isError;
                  for(const c of r.content??[])if(c.type==='text'){try{if(JSON.parse(c.text).failed)ok=false;}catch{}}
                }catch(e){poisoned=true;throw e;}
              }
              emit('tool_result',{tool:call.function.name,callId:call.id,ok,output});
              messages.push({role:'tool',toolCallId:call.id,content:JSON.stringify(output)});
              const post=await hook(ok?'PostToolUse':'PostToolUseFailure',{tool_name:call.function.name,tool_input:input,tool_use_id:call.id,tool_response:output},controller.signal);
              if(post.continue===false)throw new Fault('denied','tool result blocked by policy');
              if(post.hookSpecificOutput?.additionalContext)messages.push({role:'user',content:String(post.hookSpecificOutput.additionalContext)});
            }
          }else{
            const stop=await hook('Stop',{stop_hook_active:stopActive,last_assistant_message:m.content},controller.signal);
            if(stop.continue===false)throw new Fault('denied','final output blocked by policy');
            if(stop.decision==='block'){
              if(stopActive)throw new Fault('denied','result still rejected after correction');
              stopActive=true;messages.push({role:'user',content:String(stop.reason??'Correct the result.')});continue;
            }
            if(m.content){emit('text_delta',{text:m.content});emit('text',{text:m.content});}
            history=messages;finish(true,'completed');return;
          }
        }
        history=messages;emit('error',{code:'max_turns',message:'model round trip limit reached'});finish(false,'max_turns');
      }catch(e){
        if(toolCalls>0)poisoned=true;
        if(controller.signal.aborted){emit('error',{code:'interrupted',message:timedOut?'budget_exceeded: turn time limit reached':'turn interrupted'});}
        else{const f=e instanceof Fault?e:new Fault('error','turn failed');emit('error',{code:f.code,message:f.message});finish(false,'error',f.status);}
      }finally{clearTimeout(timer);active=undefined;emit('idle',{sessionId,requiresRestart:poisoned});}
    }
    emit('ready',{sessionId,model,tools:allTools.map(t=>t.name)});
    const lines=createInterface({input:process.stdin});
    const shutdown=()=>{closing=true;active?.abort();lines.close();};
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
    lines.on('line',line=>{
      let op;try{op=JSON.parse(line);}catch{emit('error',{code:'invalid_input',message:'expected JSON object'});return;}
      if(!op||typeof op!=='object'){emit('error',{code:'invalid_input',message:'expected operation'});return;}
      if(op.op==='interrupt'){active?.abort();return;}
      if(op.op==='notify'&&typeof op.text==='string'&&op.text.length<=100000){if(notifyQueue.length>=16){emit('error',{code:'queue_full',message:'notification limit reached'});return;}notifyQueue.push(op.text);emit('notice',{text:'notification queued'});return;}
      if(op.op==='approve'){emit('error',{code:'approval_disabled',message:'serving never asks for approval'});return;}
      if(op.op==='new'){
        if(job){emit('error',{code:'busy',message:'interrupt and wait for idle first'});return;}
        if(poisoned){emit('error',{code:'session_invalid',message:'tool execution was interrupted; restart with a fresh workspace'});return;}
        sessionId=randomUUID();history=[system];brain.reset();notifyQueue.length=0;emit('notice',{text:'new conversation',sessionId});return;
      }
      if(op.op!=='prompt'||typeof op.text!=='string'||!op.text.trim()||op.text.length>100000){emit('error',{code:'invalid_input',message:'expected prompt{text}, new, interrupt, notify or approve'});return;}
      if(job||closing||poisoned){emit('error',{code:poisoned?'session_invalid':'busy',message:poisoned?'restart with a fresh workspace':'wait for idle'});return;}
      job=turn(op.text).finally(()=>{job=undefined;});
    });
    await new Promise<void>(r=>lines.on('close',()=>{closing=true;active?.abort();r();}));
    await job;
  }finally{await Promise.all(clients.map(c=>c.close()));}
}
main().catch(e=>{emit('error',{code:e instanceof Fault?e.code:'configuration',message:e instanceof Fault?e.message:'startup failed'});process.exitCode=1;});
