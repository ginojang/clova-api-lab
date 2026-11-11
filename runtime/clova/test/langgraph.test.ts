import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';

type Event={v:number;seq:number;t:string;data:Record<string,any>};
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const usage={input:11,output:5,cacheRead:0,cacheWrite:0};
const answer=(content='done')=>({message:{role:'assistant',content},finishReason:'stop',usage});
const call=(name:string,args:object={},id='call1')=>({message:{role:'assistant',content:'',toolCalls:[{id,type:'function',function:{name:`clova__${name}`,arguments:args}}]},finishReason:'tool_calls',usage});

async function session(options:{script?:object[];config?:object;approve?:string;env?:NodeJS.ProcessEnv;model?:string}={}) {
  const root=mkdtempSync(join(tmpdir(),'clova-langgraph-test-')),workspace=join(root,'workspace'),records=join(root,'records');mkdirSync(workspace);
  const fixture=join(root,'brain.json'),config=join(root,'config.json');
  writeFileSync(fixture,JSON.stringify(options.script??[call('artifact_list'),answer()]));
  writeFileSync(config,JSON.stringify(options.config??{}));
  const proc=spawn(process.execPath,[resolve('runtime/clova/langgraph.ts'),'--events','--workspace',workspace,'--records',records,'--config',config,'--model',options.model??`scripted:${fixture}`,'--approve',options.approve??'never'],{
    env:{...process.env,LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false',...options.env},stdio:'pipe',
  });
  const events:Event[]=[],raw:string[]=[];let stderr='';
  proc.stderr.on('data',chunk=>stderr+=chunk);proc.stdin.on('error',()=>{});
  const closed=new Promise<number|null>((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
  createInterface({input:proc.stdout}).on('line',line=>{raw.push(line);try {events.push(JSON.parse(line));}catch{}});
  const wait=async(type:string,from=0)=>{
    const end=Date.now()+12000;
    while(Date.now()<end){const found=events.slice(from).find(event=>event.t===type);if(found)return found;if(proc.exitCode!==null)break;await pause(10);}
    throw new Error(`missing ${type}: ${JSON.stringify(events)} stderr=${stderr}`);
  };
  const send=(value:object)=>proc.stdin.write(JSON.stringify(value)+'\n');
  const turn=async(text='test')=>{const mark=events.length;send({op:'prompt',text});await wait('idle',mark);return events.slice(mark);};
  const close=async()=>{proc.stdin.end();const timer=setTimeout(()=>proc.kill('SIGKILL'),15000);try {return await closed;}finally{clearTimeout(timer);}};
  const cleanup=async()=>{await close();rmSync(root,{recursive:true,force:true});};
  try {await wait('ready');}catch(error){await cleanup();throw error;}
  return {root,workspace,records,events,raw,proc,send,wait,turn,close,cleanup};
}

test('LangGraph mode 2 asks before MCP effects, accepts approval, and honors denial',async()=>{
  const s=await session({approve:'ask',script:[call('artifact_write',{path:'a.txt',text:'first'}),answer(),call('artifact_write',{path:'a.txt',text:'second'}),answer()]});
  try {
    assert.equal(s.events[0].data.framework,'@langchain/langgraph');
    s.send({op:'prompt',text:'write'});const approval=await s.wait('approval');
    assert.equal(existsSync(join(s.workspace,'a.txt')),false);
    assert.equal(s.events.some(event=>event.t==='tool_result'),false);
    s.send({op:'approve',approvalId:approval.data.approvalId,allow:true});await s.wait('idle');
    assert.equal(readFileSync(join(s.workspace,'a.txt'),'utf8'),'first');
    assert.equal(s.events.find(event=>event.t==='turn_end')?.data.toolCalls,1);
    const mark=s.events.length;s.send({op:'prompt',text:'replace'});const denied=await s.wait('approval',mark);
    s.send({op:'approve',approvalId:denied.data.approvalId,allow:false,reason:'keep original'});await s.wait('idle',mark);
    assert.equal(readFileSync(join(s.workspace,'a.txt'),'utf8'),'first');
    assert.equal(s.events.slice(mark).find(event=>event.t==='tool_result')?.data.ok,false);
    assert.equal(s.events.slice(mark).find(event=>event.t==='turn_end')?.data.toolCalls,0);
  } finally {await s.cleanup();}
});

test('LangGraph mode 3 retains the MCP document/undo state and records usage without approval',async()=>{
  const s=await session({script:[call('artifact_write',{path:'a.txt',text:'first'}),answer(),call('artifact_write',{path:'a.txt',text:'second'}),answer(),call('artifact_undo'),call('artifact_read',{path:'a.txt'},'read'),answer()]});
  try {
    assert.deepEqual(s.events[0].data.tools.sort(),['clova__artifact_list','clova__artifact_read','clova__artifact_undo','clova__artifact_write']);
    const first=await s.turn('create'),second=await s.turn('edit'),third=await s.turn('undo and read');
    assert.equal(readFileSync(join(s.workspace,'a.txt'),'utf8'),'first');
    const a=first.find(event=>event.t==='turn_end')!.data,b=second.find(event=>event.t==='turn_end')!.data,c=third.find(event=>event.t==='turn_end')!.data;
    assert.equal(a.sessionId,b.sessionId);assert.equal(b.sessionId,c.sessionId);
    assert.deepEqual(c.usage,{input:33,output:15,cacheRead:0,cacheWrite:0});assert.equal(c.toolCalls,2);
    assert.equal(s.events.some(event=>event.t==='approval'),false);
    assert.ok(third.filter(event=>event.t==='tool_result').every(event=>event.data.ok));
    assert.deepEqual(s.events.map(event=>event.seq),s.events.map((_,index)=>index+1));
    assert.equal(s.raw.length,s.events.length);
    assert.equal(readFileSync(join(s.records,'summaries.ndjson'),'utf8').trim().split('\n').length,3);
    const mark=s.events.length;s.send({op:'new'});await s.wait('notice',mark);const fresh=await s.turn();
    assert.notEqual(fresh.find(event=>event.t==='turn_end')?.data.sessionId,a.sessionId);
  } finally {await s.cleanup();}
});

test('LangGraph cancels an approval wait without executing a tool and remains usable',async()=>{
  const s=await session({approve:'ask',script:[call('artifact_write',{path:'cancel.txt',text:'must not happen'}),answer()]});
  try {
    s.send({op:'prompt',text:'write'});await s.wait('approval');s.send({op:'interrupt'});await s.wait('idle');
    assert.equal(existsSync(join(s.workspace,'cancel.txt')),false);
    assert.equal(s.events.some(event=>event.t==='turn_end'),false);
    assert.ok(s.events.some(event=>event.t==='error'&&event.data.code==='interrupted'));
    assert.equal(s.events.at(-1)?.data.requiresRestart,false);
    const result=await s.turn('continue');assert.equal(result.find(event=>event.t==='turn_end')?.data.ok,true);
  } finally {await s.cleanup();}
});

test('LangGraph applies maxTurns after tool results and enforces per-turn tool limits',async()=>{
  const limited=await session({config:{maxTurns:1},script:[call('artifact_write',{path:'a.txt',text:'one'}),answer()]});
  try {
    const events=await limited.turn(),end=events.find(event=>event.t==='turn_end')!.data;
    assert.equal(end.ok,false);assert.equal(end.endReason,'max_turns');assert.equal(end.turns,1);
    assert.equal(readFileSync(join(limited.workspace,'a.txt'),'utf8'),'one');
    assert.equal(events.at(-1)?.data.requiresRestart,false);
  } finally {await limited.cleanup();}
  const capped=await session({config:{toolCallLimits:{clova__artifact_write:0}},script:[call('artifact_write',{path:'a.txt',text:'no'}),answer()]});
  try {
    const events=await capped.turn();assert.equal(existsSync(join(capped.workspace,'a.txt')),false);
    assert.equal(events.find(event=>event.t==='tool_result')?.data.ok,false);
    assert.equal(events.find(event=>event.t==='turn_end')?.data.toolCalls,0);
  } finally {await capped.cleanup();}
});

test('LangGraph EOF completes a serving turn and denies a pending human approval',async()=>{
  const serving=await session({script:[call('artifact_write',{path:'eof.txt',text:'saved'}),answer()]});
  try {
    serving.send({op:'prompt',text:'write'});assert.equal(await serving.close(),0);
    assert.equal(readFileSync(join(serving.workspace,'eof.txt'),'utf8'),'saved');
    assert.equal(serving.events.find(event=>event.t==='turn_end')?.data.ok,true);
  } finally {await serving.cleanup();}
  const asking=await session({approve:'ask',script:[call('artifact_write',{path:'eof.txt',text:'blocked'}),answer()]});
  try {
    asking.send({op:'prompt',text:'write'});await asking.wait('approval');assert.equal(await asking.close(),0);
    assert.equal(existsSync(join(asking.workspace,'eof.txt')),false);
    assert.equal(asking.events.find(event=>event.t==='tool_result')?.data.ok,false);
  } finally {await asking.cleanup();}
});

test('LangGraph notifies an idle conversation and does not run an unlisted tool',async()=>{
  const s=await session({script:[call('clova_chat',{prompt:'never invoke paid recursion'}),answer()]});
  try {
    s.send({op:'notify',text:'test notification'});await s.wait('idle');
    assert.ok(s.events.some(event=>event.t==='notice'));
    assert.equal(s.events.find(event=>event.t==='tool_result')?.data.ok,false);
    assert.equal(s.events.find(event=>event.t==='turn_end')?.data.toolCalls,0);
  } finally {await s.cleanup();}
});

test('LangGraph uses a real local HTTP CLOVA provider, retries only before tools and cancels timeout',async()=>{
  const root=mkdtempSync(join(tmpdir(),'clova-graph-http-')),key=join(root,'key');writeFileSync(key,'graph-http-test-key',{mode:0o600});
  let mode='retry',count=0;const bodies:any[]=[];
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);bodies.push(body);count++;
    if(mode==='slow'){await pause(500);if(res.destroyed)return;}
    if(mode==='retry'&&count===1){res.writeHead(529);res.end('{}');return;}
    if(mode==='after-tool'&&body.messages.at(-1).role==='tool'){res.writeHead(529);res.end('{}');return;}
    const payload=body.messages.at(-1).role==='tool'?answer():call('artifact_list');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:{code:'20000'},result:{...payload,usage:{promptTokens:11,completionTokens:5}}}));
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const env={CLOVA_API_KEY_FILE:key,CLOVA_BASE_URL:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`};
  try {
    const s=await session({model:'clova:HCX-005',env});
    try {const events=await s.turn();assert.equal(events.find(event=>event.t==='turn_end')?.data.ok,true);assert.equal(count,3);assert.equal(events.filter(event=>event.t==='idle').length,1);assert.equal(bodies[2].messages.at(-1).role,'tool');}finally{await s.cleanup();}
    mode='after-tool';count=0;const after=await session({model:'clova:HCX-005',env});
    try {
      const events=await after.turn();assert.equal(count,2,'must not retry an API error after dispatching a tool');
      assert.equal(events.find(event=>event.t==='turn_end')?.data.apiErrorStatus,529);
      assert.equal(events.at(-1)?.data.requiresRestart,true);
      const mark=after.events.length;after.send({op:'prompt',text:'do not repeat'});
      assert.equal((await after.wait('error',mark)).data.code,'session_invalid');
    } finally {await after.cleanup();}
    mode='slow';count=0;const timed=await session({model:'clova:HCX-005',env,config:{timeoutMs:60}});
    try {const events=await timed.turn();assert.ok(events.some(event=>event.t==='error'&&event.data.code==='interrupted'));assert.equal(events.some(event=>event.t==='turn_end'),false);}finally{await timed.cleanup();}
  } finally {upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
