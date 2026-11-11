#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve, join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {inside, clean} from '../clova/common.ts';

const here=dirname(fileURLToPath(import.meta.url)), root=resolve(here,'../..');
const argv=process.argv.slice(2);
const option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const definitions={
  langgraph:{command:[process.execPath,join(root,'runtime/clova/langgraph.ts')],version:JSON.parse(readFileSync(join(root,'node_modules/@langchain/langgraph/package.json'),'utf8')).version},
  vercel:{command:[process.execPath,join(here,'vercel/cli.mjs')]},
  pydantic:{command:[join(here,'pydantic/.venv.local/bin/python'),'-B',join(here,'pydantic/cli.py')]},
  pi:{command:[process.execPath,join(here,'pi/cli.mjs')]},
};
const selected=option('--frameworks','langgraph,vercel,pydantic,pi').split(',');
if(selected.some(name=>!definitions[name]))throw new Error('Unknown framework');
const output=inside(root,relative(root,resolve(option('--output',join(here,'results/mock.json')))));
const scratch=inside(root,'.local/harness-probes');mkdirSync(scratch,{recursive:true});
const runRoot=join(scratch,`${Date.now()}-${process.pid}`);mkdirSync(runRoot);
const tmp=join(runRoot,'tmp');mkdirSync(tmp);
const usage={input:11,output:5,cacheRead:0,cacheWrite:0};
const answer=(content='done')=>({message:{role:'assistant',content},finishReason:'stop',usage});
const tc=(name,args={},id='call1')=>({id,type:'function',function:{name:`clova__${name}`,arguments:args}});
const calls=(...toolCalls)=>({message:{role:'assistant',content:'',toolCalls},finishReason:'tool_calls',usage});
const write=(path,text,id='write')=>calls(tc('artifact_write',{path,text},id));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function children(pid){try{return readFileSync(`/proc/${pid}/task/${pid}/children`,'utf8').trim().split(/\s+/).filter(Boolean).map(Number);}catch{return [];}}

class Session {
  constructor(framework,name,script,{maxTurns=4}={}) {
    this.framework=framework;this.name=name;this.events=[];this.raw=[];this.stderr='';this.ended=false;this.closed=false;
    this.dir=join(runRoot,framework,name);this.workspace=join(this.dir,'workspace');mkdirSync(this.workspace,{recursive:true});
    const scriptFile=join(this.dir,'responses.json');writeFileSync(scriptFile,JSON.stringify(script,null,2));
    const config=join(this.dir,'config.json');writeFileSync(config,JSON.stringify({maxTurns,timeoutMs:12000,system:fixture.systemPrompt}));
    const def=definitions[framework];
    const args=framework==='langgraph'
      ?['--events','--workspace',this.workspace,'--model',`scripted:${scriptFile}`,'--approve','ask','--config',config]
      :['--workspace',this.workspace,'--script',scriptFile,'--max-turns',String(maxTurns),'--timeout-ms','12000'];
    this.started=performance.now();
    this.proc=spawn(def.command[0],[...def.command.slice(1),...args],{cwd:root,env:{
      PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG??'C.UTF-8',
      TMPDIR:tmp,XDG_CACHE_HOME:join(runRoot,'cache'),PYTHONDONTWRITEBYTECODE:'1',
      LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false',LOGFIRE_SEND_TO_LOGFIRE:'false',
    },stdio:'pipe'});
    this.proc.stdin.on('error',()=>{});
    this.proc.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-12000);});
    this.exit=new Promise(resolveExit=>{
      this.proc.once('error',err=>{this.startError=err.message;});
      this.proc.once('close',(code,signal)=>{this.ended=true;this.exitCode=code;this.signal=signal;resolveExit(code);});
    });
    createInterface({input:this.proc.stdout}).on('line',line=>{
      this.raw.push(line);
      try {const event=JSON.parse(line);this.events.push(event);} catch {this.invalidJSON=true;}
    });
  }
  async ready(){
    const event=await this.wait('ready');this.startupMs=performance.now()-this.started;
    this.mcpPids=[...new Set([event.data?.mcpPid,...children(this.proc.pid)].filter(x=>Number.isInteger(x)&&x>0))];
    assert.equal(event.v,1);assert.equal(event.seq,1);
    assert.deepEqual([...event.data.tools].sort(),['clova__artifact_list','clova__artifact_read','clova__artifact_undo','clova__artifact_write']);
    this.version=event.data.version??definitions[this.framework].version??'unknown';
    return this;
  }
  send(value){this.proc.stdin.write(JSON.stringify(value)+'\n');}
  async wait(type,from=0,predicate=()=>true,timeout=18000){
    const end=performance.now()+timeout;
    while(performance.now()<end){
      const found=this.events.slice(from).find(e=>e.t===type&&predicate(e));if(found)return found;
      if(this.ended)throw new Error(`worker exited before ${type}: ${this.startError??this.stderr??this.exitCode}`);
      await sleep(5);
    }
    throw new Error(`timeout waiting ${type}; events=${this.events.map(e=>e.t).join(',')}`);
  }
  async turn(text='test',decide=async()=>true){
    const mark=this.events.length;this.send({op:'prompt',text});
    let cursor=mark;
    const end=performance.now()+18000;
    while(performance.now()<end){
      while(cursor<this.events.length){
        const event=this.events[cursor++];
        if(event.t==='approval'){
          const allow=await decide(event);
          this.send({op:'approve',approvalId:event.data.approvalId,allow});
        }
        if(event.t==='idle')return this.events.slice(mark,cursor);
      }
      if(this.ended)throw new Error(`worker exited during turn: ${this.stderr}`);
      await sleep(5);
    }
    throw new Error('turn timeout');
  }
  file(path='comparison.txt'){return readFileSync(join(this.workspace,path),'utf8');}
  exists(path){return existsSync(join(this.workspace,path));}
  summary(events){return events.find(e=>e.t==='turn_end')?.data;}
  async close(){
    if(this.closed)return;this.closed=true;
    this.proc.stdin.end();
    const timer=setTimeout(()=>this.proc.kill('SIGKILL'),5000);
    try{await this.exit;}finally{clearTimeout(timer);}
    await sleep(30);
    this.survivingPids=(this.mcpPids??[]).filter(alive);
    for(const pid of this.survivingPids){try{process.kill(pid,'SIGKILL');}catch{}}
    writeFileSync(join(this.dir,'events.jsonl'),this.raw.join('\n')+'\n');
    if(this.stderr)writeFileSync(join(this.dir,'stderr.txt'),String(clean(this.stderr)));
  }
  validate(){
    assert.equal(this.invalidJSON,undefined,'stdout contains invalid JSON');
    assert.equal(this.events.length,this.raw.length);
    assert.deepEqual(this.events.map(e=>e.seq),this.events.map((_,i)=>i+1),'event sequence must be monotonic');
    assert.equal(this.exitCode,0,`worker cleanup exit ${this.exitCode}, signal ${this.signal}`);
    assert.deepEqual(this.survivingPids,[],'MCP process remained after worker exit');
    for(const event of this.events.filter(e=>e.t==='tool_result'&&e.data.ok)){
      const approval=this.events.find(e=>e.t==='approval'&&e.data.callId===event.data.callId&&e.seq<event.seq);
      assert.ok(approval,'successful tool result lacks a preceding approval');
    }
  }
}

const fixture=JSON.parse(readFileSync(join(root,'runtime/clova/fixtures/comparison.json'),'utf8'));
const cases=[
  {name:'create_edit_undo_read',script:[write(fixture.file,fixture.steps[0].expectedText,'create'),answer(),write(fixture.file,fixture.steps[1].expectedText,'edit'),answer(),calls(tc('artifact_undo',{},'undo')),calls(tc('artifact_read',{path:fixture.file},'read')),answer()],run:async s=>{
    for(const [i,step] of fixture.steps.entries()){
      const before=i===0?undefined:fixture.steps[i-1].expectedText;
      const events=await s.turn(step.prompt,async event=>{
        await sleep(20);
        if(event.data.tool==='clova__artifact_write'){
          if(before===undefined)assert.equal(s.exists(fixture.file),false,'write happened before approval');
          else assert.equal(s.file(),before,'overwrite happened before approval');
        }
        return true;
      });
      assert.equal(s.file(),step.expectedText);
      assert.equal(s.summary(events)?.ok,true,'successful file task reported failure');
    }
    assert.equal(s.events.filter(e=>e.t==='approval').length,4);
    assert.equal(s.events.filter(e=>e.t==='tool_result'&&e.data.ok).length,4);
    assert.equal(s.events.filter(e=>e.t==='turn_end').reduce((a,e)=>a+e.data.turns,0),7);
  }},
  {name:'denial_no_effect',script:[write('denied.txt','must not exist'),answer()],run:async s=>{
    const events=await s.turn('write denied.txt',async()=>false);
    assert.equal(s.exists('denied.txt'),false);
    assert.equal(s.summary(events)?.toolCalls,0);
    assert.ok(events.some(e=>e.t==='tool_result'&&e.data.ok===false));
  }},
  {name:'stale_duplicate_approval',script:[write('once.txt','once'),answer()],run:async s=>{
    s.send({op:'prompt',text:'write once'});const ap=await s.wait('approval');
    let mark=s.events.length;s.send({op:'approve',approvalId:'not-the-request',allow:true});
    await s.wait('error',mark,e=>e.data.code==='no_such_approval');assert.equal(s.exists('once.txt'),false);
    mark=s.events.length;s.send({op:'approve',approvalId:ap.data.approvalId,allow:'true'});
    await s.wait('error',mark,e=>e.data.code==='invalid_input');assert.equal(s.exists('once.txt'),false);
    s.send({op:'approve',approvalId:ap.data.approvalId,allow:true});await s.wait('idle');
    mark=s.events.length;s.send({op:'approve',approvalId:ap.data.approvalId,allow:true});
    await s.wait('error',mark,e=>e.data.code==='no_such_approval');
    assert.equal(s.file('once.txt'),'once');assert.equal(s.events.filter(e=>e.t==='tool_result'&&e.data.ok).length,1);
  }},
  {name:'two_calls_individual_approval',script:[calls(tc('artifact_write',{path:'a.txt',text:'a'},'a'),tc('artifact_write',{path:'b.txt',text:'b'},'b')),answer()],run:async s=>{
    s.send({op:'prompt',text:'write a and b'});
    const first=await s.wait('approval');
    assert.equal(s.exists('a.txt'),false);assert.equal(s.exists('b.txt'),false);
    s.send({op:'approve',approvalId:first.data.approvalId,allow:true});
    const second=await s.wait('approval',0,e=>e.data.approvalId!==first.data.approvalId);
    await sleep(100);
    assert.equal(s.exists(second.data.input.path),false,'second tool executed before its approval');
    s.observation={firstApprovedFileExistsWhileSecondPending:s.exists(first.data.input.path),
      firstToolResultBeforeSecondApprovalEvent:s.events.some(e=>e.t==='tool_result'&&e.data.callId===first.data.callId&&e.seq<second.seq)};
    s.send({op:'approve',approvalId:second.data.approvalId,allow:true});await s.wait('idle');
    assert.equal(s.file('a.txt'),'a');assert.equal(s.file('b.txt'),'b');
    assert.equal(s.summary(s.events)?.toolCalls,2);
  }},
  {name:'interrupt_pending_approval',script:[write('cancel.txt','no'),answer()],run:async s=>{
    s.send({op:'prompt',text:'write then cancel'});await s.wait('approval');
    s.send({op:'interrupt'});await s.wait('idle');
    assert.equal(s.exists('cancel.txt'),false);assert.ok(s.events.some(e=>e.t==='error'&&e.data.code==='interrupted'));
  }},
  {name:'eof_pending_approval',script:[write('eof.txt','no'),answer()],run:async s=>{
    s.send({op:'prompt',text:'write then EOF'});await s.wait('approval');await s.close();assert.equal(s.exists('eof.txt'),false);
  }},
  {name:'tool_path_error_no_escape',script:[write('../escape.txt','no'),answer()],run:async s=>{
    const events=await s.turn('invalid path');assert.equal(existsSync(join(s.dir,'escape.txt')),false);
    assert.ok(events.some(e=>e.t==='tool_result'&&e.data.ok===false),'tool error must be visible');
  }},
  {name:'model_round_limit',script:[write('bounded.txt','one'),calls(tc('artifact_list',{},'list')),answer()],options:{maxTurns:1},run:async s=>{
    const events=await s.turn('bounded call');const end=s.summary(events);
    assert.equal(end?.turns,1);assert.equal(end?.ok,false);assert.equal(end?.endReason,'max_turns');assert.equal(s.file('bounded.txt'),'one');
  }},
  {name:'new_resets_conversation',script:[write('reset.txt','same'),answer()],run:async s=>{
    const first=s.summary(await s.turn('first'));
    const mark=s.events.length;s.send({op:'new'});await s.wait('notice',mark);
    const second=s.summary(await s.turn('after reset'));
    assert.notEqual(first?.sessionId,second?.sessionId);assert.equal(second?.ok,true);assert.equal(second?.turns,2);
  }},
  {name:'malformed_input_recovers',script:[answer('ready')],run:async s=>{
    s.proc.stdin.write('{\n');await s.wait('error',0,e=>e.data.code==='invalid_input');
    const events=await s.turn('valid');assert.equal(s.summary(events)?.ok,true);
  }},
  {name:'busy_prompt_rejected',script:[write('busy.txt','first'),answer()],run:async s=>{
    s.send({op:'prompt',text:'first'});const ap=await s.wait('approval');
    const mark=s.events.length;s.send({op:'prompt',text:'must not run concurrently'});
    await s.wait('error',mark,e=>e.data.code==='busy');
    s.send({op:'approve',approvalId:ap.data.approvalId,allow:true});await s.wait('idle');
    assert.equal(s.events.filter(e=>e.t==='turn_start').length,1);assert.equal(s.file('busy.txt'),'first');
  }},
  {name:'false_completion_detected_by_file_oracle',script:[answer('File saved successfully.')],run:async s=>{
    const events=await s.turn('create comparison.txt');
    const taskSucceeded=s.exists(fixture.file)&&events.some(e=>e.t==='tool_result'&&e.data.ok);
    assert.equal(taskSucceeded,false,'file oracle must reject a text-only completion');
    s.observation='The shared file oracle rejects this task; a framework normal stop alone is not proof of task success.';
  }},
  {name:'interrupt_delayed_model_no_late_effect',frameworks:['vercel','pydantic','pi'],script:[{...write('late.txt','must not appear'),delayMs:600},answer()],run:async s=>{
    s.send({op:'prompt',text:'delayed model then cancel'});await s.wait('turn_start');await sleep(60);
    s.send({op:'interrupt'});await s.wait('idle');await sleep(650);
    assert.equal(s.exists('late.txt'),false);assert.equal(s.events.some(e=>e.t==='approval'),false);
    assert.ok(s.events.some(e=>e.t==='error'&&e.data.code==='interrupted'));
  }},
];
const requested=option('--scenario',null);
const scenarios=cases.filter(c=>!requested||c.name===requested);
if(!scenarios.length)throw new Error('Unknown scenario');

const report={schemaVersion:1,generatedAt:new Date().toISOString(),kind:'scripted-model-real-framework-real-mcp',
  externalModelCalls:0,actualEldaCli:false,deployed:false,
  limits:{maxModelRequests:4,timeoutMs:12000},
  fixture:fixture.id,toolNames:fixture.tools,
  caveat:'Synthetic model answers test control flow and actual file effects, not model quality or production readiness. Single-run latency includes framework startup and approval-driver polling; not a performance ranking.',
  rawArtifacts:relative(root,runRoot),frameworks:[]};
for(const framework of selected){
  const sources=framework==='langgraph'?['runtime/clova/langgraph.ts']:framework==='vercel'?['runtime/harness-lab/vercel/worker.ts']:framework==='pydantic'?['runtime/harness-lab/pydantic/cli.py']:['runtime/harness-lab/pi/cli.mjs'];
  const group={framework,version:definitions[framework].version??null,sourceSha256:Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')])),cases:[],notRun:[]};report.frameworks.push(group);
  for(const spec of scenarios){
    if(spec.frameworks&&!spec.frameworks.includes(framework)){group.notRun.push({scenario:spec.name,reason:'Existing Brain scripted responses do not implement delayMs; existing runtime HTTP cancellation regression is separate.'});continue;}
    let session;const started=performance.now();let failure;
    try {session=new Session(framework,spec.name,spec.script,spec.options);await session.ready();group.version=session.version;await spec.run(session);}
    catch(err){failure=err instanceof Error?err.message:String(err);}
    finally {if(session){try {await session.close();session.validate();}catch(err){failure=[failure,err.message].filter(Boolean).join('; ');}}}
    const result={scenario:spec.name,passed:!failure,durationMs:Math.round(performance.now()-started),startupMs:session?.startupMs?Math.round(session.startupMs):null,
      approvals:session?.events.filter(e=>e.t==='approval').length??0,
      toolResults:session?.events.filter(e=>e.t==='tool_result').length??0,
      failedToolResults:session?.events.filter(e=>e.t==='tool_result'&&!e.data.ok).length??0,
      modelRequestsReportedByTurnEnd:session?.events.some(e=>e.t==='turn_end')?session.events.filter(e=>e.t==='turn_end').reduce((a,e)=>a+(e.data.turns??0),0):null,
      turnOutcomes:session?.events.filter(e=>e.t==='turn_end').map(e=>({ok:e.data.ok,endReason:e.data.endReason}))??[],
      cleanupPassed:session?.exitCode===0&&session?.survivingPids?.length===0,
      ...(session?.observation?{observation:session.observation}:{}),...(failure?{failure:String(clean(failure))}:{})};
    group.cases.push(result);process.stdout.write(`${framework} ${spec.name}: ${failure?'FAIL':'PASS'}${failure?' — '+failure:''}\n`);
  }
  group.passed=group.cases.filter(c=>c.passed).length;group.total=group.cases.length;
}
report.passed=report.frameworks.every(f=>f.passed===f.total);
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Report: ${relative(root,output)}\n`);
if(!report.passed)process.exitCode=1;
