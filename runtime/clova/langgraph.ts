#!/usr/bin/env node
import {Annotation, END, START, StateGraph} from '@langchain/langgraph';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {readFileSync, mkdirSync, appendFileSync, realpathSync, readdirSync, statSync, rmSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {compileToolSchema, toolArgumentError} from './tool-schema.ts';
import {Brain} from './provider.ts';
import {Mcp} from './client.ts';
import {Fault, clean, usageZero, type Message, type Tool, type Usage} from './common.ts';

type Hook = {command:string[];onFailure?:'continue'|'block';timeoutMs?:number};
export type GraphConfig = {
  model?:string;system?:string;approve?:'ask'|'never'|'auto';maxTurns?:number;timeoutMs?:number;
  rawToolNames?:boolean;includeMcpInstructions?:boolean;plainToolResults?:boolean;tokenLimit?:number;
  maxBudgetUsd?:number;prices?:Usage;toolCallLimits?:Record<string,number>;
  servers?:{name:string;command:string[];env?:Record<string,string>;allowedTools?:string[]}[];
  hooks?:Record<string,Hook>;
};
type Emit = (type:string, data:Record<string,unknown>) => void;
type Route = 'model'|'tools'|'end';
const State = Annotation.Root({
  messages:Annotation<Message[]>({reducer:(_old,next)=>next,default:()=>[]}),
  route:Annotation<Route>({reducer:(_old,next)=>next,default:()=>'model'}),
  endReason:Annotation<string>({reducer:(_old,next)=>next,default:()=>''}),
});
type Pending = {resolve:(decision:{allow:boolean;reason?:string})=>void;callId:string};
type Turn = {
  controller:AbortController;usage:Usage;turns:number;toolCalls:number;retried:boolean;
  malformed:number;policyRejected:boolean;toolFailed:boolean;stopActive:boolean;executed:Map<string,number>;messages:Message[];
};

/** Shared mode-2/mode-3 engine. LangGraph schedules every model/tool transition. */
export class ClovaGraphHarness {
  readonly model:string;
  readonly workspace:string;
  readonly tools:Tool[]=[];
  sessionId=randomUUID();
  private readonly config:GraphConfig;
  private readonly emitEvent:Emit;
  private readonly records?:string;
  private readonly brain:Brain;
  private readonly maxTurns:number;
  private readonly timeoutMs:number;
  private readonly approvalMode:'ask'|'never';
  private readonly clients:Mcp[]=[];
  private readonly available=new Map<string,{client:Mcp;original:string}>();
  private readonly pending=new Map<string,Pending>();
  private readonly notifications:string[]=[];
  private system:Message={role:'system',content:''};
  private history:Message[]=[];
  private current?:Turn;
  private running?:Promise<void>;
  private closing=false;
  private poisoned=false;
  private cost=0;
  private graph;

  constructor(options:{workspace:string;config?:GraphConfig;model?:string;approve?:string;records?:string;emit:Emit}) {
    this.config=options.config??{};
    this.model=options.model??process.env.CLOVA_MODEL??this.config.model??'clova:HCX-005';
    this.brain=new Brain(this.model);
    this.maxTurns=Number(process.env.CLOVA_MAX_TURNS??this.config.maxTurns??12);
    this.timeoutMs=this.config.timeoutMs??300000;
    if(this.config.tokenLimit!==undefined&&(!Number.isInteger(this.config.tokenLimit)||this.config.tokenLimit<1))throw new Fault('configuration','invalid token limit');
    const approve=options.approve??this.config.approve??'never';
    if(!['ask','never','auto'].includes(approve))throw new Fault('configuration','approve must be ask, never or auto');
    this.approvalMode=approve==='ask'?'ask':'never';
    if(!Number.isInteger(this.maxTurns)||this.maxTurns<1||this.maxTurns>100||!Number.isFinite(this.timeoutMs)||this.timeoutMs<1)throw new Fault('configuration','invalid turn or time limit');
    if(this.config.maxBudgetUsd!==undefined&&(!(this.config.maxBudgetUsd>0)||(!this.model.startsWith('scripted:')&&!this.config.prices)))throw new Fault('configuration','a positive budget and explicit prices per 1M tokens are required');
    if(this.config.prices&&(['input','output','cacheRead','cacheWrite'] as const).some(k=>!Number.isFinite(this.config.prices![k])||this.config.prices![k]<0))throw new Fault('configuration','invalid prices');
    if(this.config.toolCallLimits&&Object.values(this.config.toolCallLimits).some(n=>!Number.isInteger(n)||n<0))throw new Fault('configuration','toolCallLimits must contain nonnegative integers');
    mkdirSync(resolve(options.workspace),{recursive:true,mode:0o700});this.workspace=realpathSync(resolve(options.workspace));
    this.records=options.records?resolve(options.records):undefined;
    this.emitEvent=options.emit;
    if(this.records){mkdirSync(this.records,{recursive:true,mode:0o700});for(const file of readdirSync(this.records))if(file.endsWith('.jsonl')&&Date.now()-statSync(join(this.records,file)).mtimeMs>90*86400000)rmSync(join(this.records,file));}
    this.graph=new StateGraph(State)
      .addNode('model',state=>this.modelNode(state))
      .addNode('tools',state=>this.toolNode(state))
      .addEdge(START,'model')
      .addConditionalEdges('model',state=>state.route,{model:'model',tools:'tools',end:END})
      .addEdge('tools','model')
      .compile();
  }

  private emit(type:string,data:Record<string,unknown>={}) {this.emitEvent(type,data);}
  private text(content:string) {if(content){this.emit('text_delta',{text:content});this.emit('text',{text:content,merged:true});}}
  private account(usage:Usage) {
    const turn=this.current!;
    for(const key of Object.keys(turn.usage) as (keyof Usage)[]){turn.usage[key]+=usage[key];this.cost+=usage[key]*(this.config.prices?.[key]??0)/1000000;}
  }
  private checkBudget(checkTokens=true) {if(checkTokens&&this.config.tokenLimit!==undefined&&this.current!.usage.input+this.current!.usage.output>=this.config.tokenLimit)throw new Fault('token_limit','turn token limit reached');if(this.config.maxBudgetUsd!==undefined&&this.cost>=this.config.maxBudgetUsd)throw new Fault('budget_exceeded','session cost cap reached');}

  async initialize() {
    const defaultCommand=[process.execPath,join(dirname(fileURLToPath(import.meta.url)),import.meta.url.endsWith('.mjs')?'mcp.mjs':'mcp.ts'),'mcp','--workspace','{workspace}'];
    const servers=this.config.servers??[{name:'clova',command:defaultCommand,env:{CLOVA_MCP_ALLOWED_TOOLS:'artifact_list,artifact_read,artifact_write,artifact_undo'},allowedTools:['artifact_list','artifact_read','artifact_write','artifact_undo']}];
    const instructions:string[]=[];
    try {
      for(const server of servers){
        if(!/^[a-z][a-z0-9_]*$/.test(server.name)||!Array.isArray(server.command)||!server.command.length)throw new Fault('configuration','invalid MCP server profile');
        const client=new Mcp(server.command.map(arg=>arg.replaceAll('{workspace}',this.workspace)),this.workspace,server.env);
        this.clients.push(client);const init=await client.initialize();instructions.push(init.instructions);
        for(const tool of init.tools){
          if(server.allowedTools&&!server.allowedTools.includes(tool.name))continue;
          // Paid model recursion is outside this engine's tool contract.
          if(tool.name==='clova_chat')continue;
          const name=this.config.rawToolNames?tool.name:`${server.name}__${tool.name}`;
          if(this.available.has(name))throw new Fault('configuration','duplicate MCP tool name');
          compileToolSchema(tool.inputSchema);
          this.available.set(name,{client,original:tool.name});this.tools.push({...tool,name});
        }
      }
      this.system={role:'system',content:(this.config.system??'Complete the user task using the available tools. Never claim a failed tool succeeded.')+(this.config.includeMcpInstructions===false?'':'\n'+instructions.join('\n'))};
      this.history=[this.system];
      this.emit('ready',{sessionId:this.sessionId,model:this.model,approve:this.approvalMode,harness:'langgraph',framework:'@langchain/langgraph',tools:this.tools.map(tool=>tool.name)});
    } catch(error) {await Promise.all(this.clients.map(client=>client.close()));throw error;}
  }

  private async modelNode(state:typeof State.State):Promise<Partial<typeof State.State>> {
    const turn=this.current!;turn.controller.signal.throwIfAborted();
    if(turn.turns>=this.maxTurns)return {route:'end',endReason:'max_turns'};
    this.checkBudget();
    let answer;
    try {answer=await this.brain.call(state.messages,this.tools,turn.controller.signal);}
    catch(error){
      if(error instanceof Fault&&error.usage){turn.turns++;this.account(error.usage);}
      if(!turn.retried&&turn.toolCalls===0&&error instanceof Fault&&[429,500,502,503,529].includes(error.status??0)){turn.retried=true;return {route:'model'};}
      throw error;
    }
    turn.turns++;this.account(answer.usage);turn.controller.signal.throwIfAborted();
    this.checkBudget(false);
    if(answer.finishReason==='length')throw new Fault('truncated','CLOVA output was truncated');
    const messages=[...state.messages,answer.message];turn.messages=messages;
    if(answer.message.toolCalls?.length){this.text(answer.message.content);return {messages,route:'tools'};}
    const stop=await this.hook('Stop',{stop_hook_active:turn.stopActive,last_assistant_message:answer.message.content},turn.controller.signal);
    if(stop.continue===false)throw new Fault('denied','final output blocked by policy');
    if(stop.decision==='block'){
      if(turn.stopActive)throw new Fault('denied','result still rejected after correction');
      turn.stopActive=true;
      const corrected=[...messages,{role:'user' as const,content:String(stop.reason??'Correct the result.')}];turn.messages=corrected;
      return {messages:corrected,route:'model'};
    }
    this.text(answer.message.content);return {messages,route:'end',endReason:'completed'};
  }

  private async toolNode(state:typeof State.State):Promise<Partial<typeof State.State>> {
    const turn=this.current!,messages=[...state.messages];
    const calls=state.messages.at(-1)?.toolCalls??[];
    for(const call of calls){
      turn.controller.signal.throwIfAborted();
      const target=this.available.get(call.function.name);let input=call.function.arguments;
      const pre=await this.hook('PreToolUse',{tool_name:call.function.name,tool_input:input,tool_use_id:call.id},turn.controller.signal);
      const limit=this.config.toolCallLimits?.[call.function.name];
      const limited=limit!==undefined&&(turn.executed.get(call.function.name)??0)>=limit;
      const permission=pre.hookSpecificOutput?.permissionDecision;
      let denied=limited||!target||pre.continue===false||pre.decision==='block'||['deny','defer'].includes(permission);
      if(pre.hookSpecificOutput?.updatedInput)input=pre.hookSpecificOutput.updatedInput;
      const diagnostic=!denied&&target?toolArgumentError(this.tools.find(t=>t.name===call.function.name)!.inputSchema,input):undefined;
      this.emit('tool_call',{tool:call.function.name,callId:call.id,input});
      let reason=limited?'tool reached its per-turn execution limit':'tool is not allowed by policy';
      if(!denied&&!diagnostic&&(this.approvalMode==='ask'||permission==='ask')){
        if(this.approvalMode==='never'){denied=true;reason='serving policy cannot ask for approval';}
        else{const decision=await this.ask(call.function.name,call.id,input,turn.controller.signal);denied=!decision.allow;reason=decision.reason??'user denied tool execution';}
      }
      turn.controller.signal.throwIfAborted();
      let output:unknown,ok=false;
      if(diagnostic){output=diagnostic;turn.malformed++;}
      else if(denied)output=`denied: ${reason}`;
      else {
        turn.malformed=0;turn.toolCalls++;turn.executed.set(call.function.name,(turn.executed.get(call.function.name)??0)+1);
        try {
          const result=await target!.client.request('tools/call',{name:target!.original,arguments:input},turn.controller.signal);
          output=result;ok=!result.isError;
          for(const content of result.content??[])if(content.type==='text'){try {if(JSON.parse(content.text).failed)ok=false;} catch {}}
        } catch(error){this.poisoned=true;throw error;}
      }
      if(!ok&&!denied)turn.toolFailed=true;
      this.emit('tool_result',{tool:call.function.name,callId:call.id,ok,output,sideEffect:denied||diagnostic?'not_started':'completed'});
      messages.push({role:'tool',toolCallId:call.id,content:this.config.plainToolResults&&output&&typeof output==='object'&&Array.isArray((output as any).content)?(output as any).content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(''):JSON.stringify(output)});turn.messages=messages;
      if(diagnostic&&turn.malformed>=4){
        for(const tail of calls.slice(calls.indexOf(call)+1)){
          this.emit('tool_result',{tool:tail.function.name,callId:tail.id,ok:false,output:'malformed_tool_use: repeated invalid arguments',sideEffect:'not_started'});
          messages.push({role:'tool',toolCallId:tail.id,content:'malformed_tool_use: repeated invalid arguments'});
        }
        throw new Fault('malformed_tool_use','repeated invalid tool arguments');
      }
      if(denied){
        turn.policyRejected=true;
        for(const tail of calls.slice(calls.indexOf(call)+1)){
          this.emit('tool_result',{tool:tail.function.name,callId:tail.id,ok:false,output:'denied: earlier call was rejected',sideEffect:'not_started'});
          messages.push({role:'tool',toolCallId:tail.id,content:'denied: earlier call was rejected'});
        }
        throw new Fault('denied','tool execution was denied');
      }
      const post=await this.hook(ok?'PostToolUse':'PostToolUseFailure',{tool_name:call.function.name,tool_input:input,tool_use_id:call.id,tool_response:output},turn.controller.signal);
      if(post.continue===false)throw new Fault('denied','tool result blocked by policy');
      if(post.hookSpecificOutput?.additionalContext)messages.push({role:'user',content:String(post.hookSpecificOutput.additionalContext)});
    }
    return {messages,route:'model'};
  }

  private ask(tool:string,callId:string,input:unknown,signal:AbortSignal):Promise<{allow:boolean;reason?:string}> {
    if(this.closing)return Promise.resolve({allow:false,reason:'input closed'});
    return new Promise((resolve,reject)=>{
      const approvalId=`ap_${randomUUID()}`;
      const abort=()=>{this.pending.delete(approvalId);reject(new Fault('interrupted','turn interrupted'));};
      const complete=(decision:{allow:boolean;reason?:string})=>{signal.removeEventListener('abort',abort);this.pending.delete(approvalId);resolve(decision);};
      this.pending.set(approvalId,{resolve:complete,callId});
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted){abort();return;}
      this.emit('approval',{tool,callId,input,approvalId});
    });
  }

  private async hook(name:string,fields:object,signal:AbortSignal):Promise<any> {
    const hook=this.config.hooks?.[name];if(!hook)return {};
    try {
      return await new Promise((resolve,reject)=>{
        const proc=spawn(hook.command[0],hook.command.slice(1),{cwd:this.workspace,env:{PATH:process.env.PATH,HOME:process.env.HOME},stdio:'pipe'});
        let output='',done=false;
        const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
        const abort=()=>{proc.kill('SIGKILL');finish(new Error('hook interrupted'));};
        const timer=setTimeout(()=>{proc.kill('SIGKILL');finish(new Error('hook timeout'));},hook.timeoutMs??60000);
        signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
        proc.on('error',error=>finish(error));proc.stdin.on('error',()=>{});proc.stderr.resume();
        proc.stdout.on('data',chunk=>{output+=chunk;if(output.length>1048576)abort();});
        proc.on('close',code=>{try {if(code!==0)throw new Error('hook failed');finish(undefined,output.trim()?JSON.parse(output):{});} catch(error){finish(error as Error);}});
        proc.stdin.end(JSON.stringify({session_id:this.sessionId,cwd:this.workspace,hook_event_name:name,...fields}));
      });
    } catch {if(hook.onFailure==='continue')return {};throw new Fault('hook_error',`${name} hook failed`);}
  }

  private async runTurn(prompt:string) {
    const turn:Turn={controller:new AbortController(),usage:usageZero(),turns:0,toolCalls:0,retried:false,malformed:0,policyRejected:false,toolFailed:false,stopActive:false,executed:new Map(),messages:[...structuredClone(this.history),{role:'user',content:prompt}]};
    this.current=turn;let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;turn.controller.abort();},this.timeoutMs),started=Date.now();
    let summaryReason='error';
    const finish=(ok:boolean,endReason:string,status?:number)=>{
      summaryReason=endReason;
      this.emit('turn_end',{ok,endReason,runCompleted:endReason==='completed',policyRejected:turn.policyRejected,toolFailed:turn.toolFailed,costBasis:this.config.prices?'list':'unknown',turns:turn.turns,toolCalls:turn.toolCalls,usage:turn.usage,durationMs:Date.now()-started,model:this.model,sessionId:this.sessionId,messages:turn.messages.length,harness:'langgraph',...(status?{apiErrorStatus:status}:{})});
    };
    this.emit('turn_start',{sessionId:this.sessionId,harness:'langgraph'});
    try {
      const before=await this.hook('UserPromptSubmit',{prompt},turn.controller.signal);
      if(before.continue===false||before.decision==='block')throw new Fault('denied','prompt blocked by policy');
      if(before.hookSpecificOutput?.additionalContext)turn.messages.push({role:'user',content:String(before.hookSpecificOutput.additionalContext)});
      const result=await this.graph.invoke({messages:turn.messages,route:'model',endReason:''},{signal:turn.controller.signal,recursionLimit:this.maxTurns*3+10});
      turn.controller.signal.throwIfAborted();
      this.history=result.messages;turn.messages=result.messages;
      if(result.endReason==='max_turns'){this.emit('error',{code:'max_turns',message:'model round trip limit reached'});finish(false,'max_turns');}
      else finish(true,'completed');
    } catch(error) {
      if(turn.toolCalls>0)this.poisoned=true;
      if(turn.controller.signal.aborted){summaryReason='interrupted';this.emit('error',{code:'interrupted',message:timedOut?'budget_exceeded: turn time limit reached':'turn interrupted'});}
      else{const fault=error instanceof Fault?error:new Fault('error','graph turn failed');this.emit('error',{code:fault.code,message:fault.message});finish(false,['denied','token_limit','malformed_tool_use'].includes(fault.code)?fault.code:'error',fault.status);}
    } finally {
      clearTimeout(timer);this.current=undefined;
      if(this.records)appendFileSync(join(this.records,'summaries.ndjson'),JSON.stringify(clean({sessionId:this.sessionId,model:this.model,at:new Date().toISOString(),ok:summaryReason==='completed',endReason:summaryReason,turns:turn.turns,toolCalls:turn.toolCalls,usage:turn.usage,costUsd:this.cost,durationMs:Date.now()-started,harness:'langgraph'}))+'\n',{mode:0o600});
      this.emit('idle',{sessionId:this.sessionId,requiresRestart:this.poisoned});
    }
  }

  private launch(text:string) {
    this.running=this.runTurn(text).finally(()=>{
      this.running=undefined;
      if(!this.closing&&!this.poisoned&&this.notifications.length)this.launch(this.notifications.shift()!);
    });
  }

  input(op:unknown) {
    if(!op||typeof op!=='object'||Array.isArray(op)){this.emit('error',{code:'bad_input',message:'expected operation object'});return;}
    const value=op as Record<string,unknown>;
    if(value.op==='interrupt'){this.current?.controller.abort();return;}
    if(value.op==='approve'){
      if(this.approvalMode==='never'){this.emit('error',{code:'approval_disabled',message:'serving never asks for approval'});return;}
      const pending=typeof value.approvalId==='string'?this.pending.get(value.approvalId):undefined;
      if(!pending){this.emit('error',{code:'no_such_approval',message:'no matching pending approval'});return;}
      if(typeof value.allow!=='boolean'){this.emit('error',{code:'bad_input',message:'approve.allow must be boolean'});return;}
      pending.resolve({allow:value.allow,reason:typeof value.reason==='string'?value.reason:undefined});return;
    }
    if(value.op==='new'){
      if(this.running){this.emit('error',{code:'busy',message:'interrupt and wait for idle first'});return;}
      if(this.poisoned){this.emit('error',{code:'session_invalid',message:'restart with a fresh workspace'});return;}
      this.sessionId=randomUUID();this.history=[this.system];this.brain.reset();this.notifications.length=0;
      this.emit('notice',{text:'new conversation',sessionId:this.sessionId});return;
    }
    if(!['prompt','notify'].includes(String(value.op))||typeof value.text!=='string'||!value.text.trim()||value.text.length>100000){this.emit('error',{code:'bad_input',message:'expected prompt, notify, approve, interrupt or new'});return;}
    if(this.closing||this.poisoned){this.emit('error',{code:'session_invalid',message:'restart with a fresh workspace'});return;}
    if(value.op==='notify'){
      if(this.notifications.length>=16){this.emit('error',{code:'queue_full',message:'notification limit reached'});return;}
      this.emit('notice',{text:'notification received'});
      if(this.running){this.notifications.push(value.text);this.emit('queued',{text:value.text});}else this.launch(value.text);
      return;
    }
    if(this.running){this.emit('error',{code:'busy',message:'wait for idle'});return;}
    this.launch(value.text);
  }

  async close(interrupt=false) {
    this.closing=true;this.notifications.length=0;
    for(const pending of this.pending.values())pending.resolve({allow:false,reason:'input closed'});
    if(interrupt)this.current?.controller.abort();
    // EOF completes the active turn; SIGINT/SIGTERM cancel it. The turn's own
    // time budget still applies, and pending human approvals are denied.
    await this.running;
    await Promise.all(this.clients.map(client=>client.close()));
  }
}

export async function runLangGraph(argv=process.argv.slice(2)) {
  const option=(name:string)=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];};
  const records=option('--records')?resolve(option('--records')!):undefined;
  let seq=0,harness:ClovaGraphHarness|undefined;
  const emit:Emit=(type,data)=>{
    const line=JSON.stringify(clean({v:1,seq:++seq,ts:new Date().toISOString(),t:type,data}))+'\n';
    process.stdout.write(line);
    if(records&&harness){mkdirSync(records,{recursive:true,mode:0o700});appendFileSync(join(records,`${harness.sessionId}.jsonl`),line,{mode:0o600});}
  };
  try {
    if(!argv.includes('--events')||!option('--workspace'))throw new Fault('configuration','Usage: clova-langgraph --events --workspace DIR [--config FILE] [--model MODEL] [--approve ask|never]');
    const config=option('--config')?JSON.parse(readFileSync(option('--config')!,'utf8')) as GraphConfig:{};
    harness=new ClovaGraphHarness({workspace:option('--workspace')!,model:option('--model'),approve:option('--approve'),config,records,emit});
    await harness.initialize();
    const lines=createInterface({input:process.stdin});let interrupted=false;
    const shutdown=()=>{interrupted=true;harness!.input({op:'interrupt'});lines.close();};
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
    lines.on('line',line=>{try {harness!.input(JSON.parse(line));} catch {emit('error',{code:'bad_input',message:'expected JSON object'});}});
    await new Promise<void>(resolve=>lines.once('close',resolve));
    await harness.close(interrupted);
    process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);
  } catch(error){emit('error',{code:error instanceof Fault?error.code:'configuration',message:error instanceof Fault?error.message:'startup failed'});if(harness)await harness.close(true);process.exitCode=1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)await runLangGraph();
