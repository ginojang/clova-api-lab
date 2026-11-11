import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {makeTools} from '../mcp.ts';
import {Brain, normalizeToolCalls} from '../provider.ts';
import {clean,secretFile} from '../common.ts';

function temp(){return mkdtempSync(join(tmpdir(),'clova-runtime-test-'));}
test('MCP atomic writes, relative/absolute/symlink isolation and partial batch semantics',async()=>{
  const root=temp(),ws=join(root,'ws');mkdirSync(ws);
  try{
    const tools=makeTools(ws),call=(name:string,args:Record<string,unknown>={})=>tools.find(t=>t.name===name)!.run(args);
    await call('artifact_write',{path:'a.txt',text:'original'});
    await assert.rejects(call('artifact_write',{path:'a.txt',text:3}),/text/);
    assert.equal(readFileSync(join(ws,'a.txt'),'utf8'),'original');
    symlinkSync(root,join(ws,'escape'));
    for(const path of ['../outside',join(root,'absolute'),'escape/symlink'])await assert.rejects(call('artifact_write',{path,text:'escape'}),/forbidden|escapes/);
    const result=await call('batch',{steps:[{tool:'artifact_write',args:{path:'b.txt',text:'saved'},as:'saved'},{tool:'artifact_read',args:{path:'$saved.id'}},{tool:'missing'},{tool:'artifact_write',args:{path:'a.txt',text:'bad'}}]}) as any;
    assert.equal(result.completed,2);assert.equal(result.failed.step,2);assert.equal(result.results[1].text,'saved');
    assert.equal(readFileSync(join(ws,'a.txt'),'utf8'),'original');
    const later=await call('batch',{steps:[{tool:'artifact_read',args:{path:'$saved.id'}}]}) as any;
    assert.equal(later.results[0].text,'saved');
    await call('artifact_write',{path:'a.txt',text:'replacement'});
    await call('artifact_write',{path:'a.txt',text:'replacement'});await call('artifact_undo');
    assert.equal(readFileSync(join(ws,'a.txt'),'utf8'),'original');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('v3 provider sends tools, toolCallId and bearer file; normalizes usage and HTTP errors',async()=>{
  const root=temp(),key=join(root,'key');writeFileSync(key,'test-private-value',{mode:0o600});
  const old={key:process.env.CLOVA_API_KEY_FILE,base:process.env.CLOVA_BASE_URL};
  let status=200;const requests:any[]=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    requests.push({url:req.url,auth:req.headers.authorization,body:JSON.parse(raw)});
    res.writeHead(status,{'Content-Type':'application/json'});
    res.end(JSON.stringify({status:{code:'20000'},result:{message:{role:'assistant',content:'done'},finishReason:'stop',usage:{promptTokens:4,completionTokens:2}}}));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
    process.env.CLOVA_API_KEY_FILE=key;process.env.CLOVA_BASE_URL=`http://127.0.0.1:${(server.address() as any).port}`;
    const brain=new Brain('clova:HCX-005');
    const answer=await brain.call([{role:'tool',content:'{}',toolCallId:'call1'}],[{name:'sample',description:'test tool',inputSchema:{type:'object'}}],new AbortController().signal);
    assert.deepEqual(answer.usage,{input:4,output:2,cacheRead:0,cacheWrite:0});
    assert.equal(requests[0].url,'/v3/chat-completions/HCX-005');assert.equal(requests[0].auth,'Bearer test-private-value');
    assert.equal(requests[0].body.messages[0].toolCallId,'call1');assert.equal(requests[0].body.tools[0].function.name,'sample');
    status=429;await assert.rejects(brain.call([],[],new AbortController().signal),(e:any)=>e.code==='api_error'&&e.status===429);
    assert.equal(clean('test-private-value'),'***');
    chmodSync(key,0o644);assert.throws(()=>secretFile(key),/600/);
  }finally{
    if(old.key===undefined)delete process.env.CLOVA_API_KEY_FILE;else process.env.CLOVA_API_KEY_FILE=old.key;
    if(old.base===undefined)delete process.env.CLOVA_BASE_URL;else process.env.CLOVA_BASE_URL=old.base;
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});
  }
});

async function session(extra:string[]=[],env:NodeJS.ProcessEnv={}){
  const root=temp(),events:any[]=[];
  const proc=spawn(process.execPath,[resolve('runtime/clova/harness.ts'),'--events','--workspace',root,'--model',`scripted:${resolve('runtime/clova/fixtures/brain.json')}`,...extra],{env:{...process.env,...env},stdio:'pipe'});
  let stderr='';proc.stderr.on('data',d=>stderr+=d);
  createInterface({input:proc.stdout}).on('line',line=>events.push(JSON.parse(line)));
  const send=(op:unknown)=>proc.stdin.write(JSON.stringify(op)+'\n');
  const wait=async(t:string,from=0)=>{
    const start=Date.now();while(Date.now()-start<10000){const found=events.slice(from).find(e=>e.t===t);if(found)return found;await new Promise(r=>setTimeout(r,10));}
    throw new Error(`missing ${t}: ${JSON.stringify(events)} stderr=${stderr}`);
  };
  const close=async()=>{const exit=new Promise(r=>proc.once('close',r));proc.stdin.end();const timer=setTimeout(()=>proc.kill('SIGKILL'),2000);await exit;clearTimeout(timer);rmSync(root,{recursive:true,force:true});};
  await wait('ready');return{events,send,wait,close};
}
test('harness executes MCP, accumulates usage, preserves/new sessions and caps turns',async()=>{
  const s=await session();try{
    s.send({op:'prompt',text:'list'});const first=await s.wait('turn_end');await s.wait('idle');
    assert.equal(first.data.ok,true);assert.equal(first.data.turns,2);assert.equal(first.data.toolCalls,1);assert.equal(first.data.usage.input,25);
    let mark=s.events.length;s.send({op:'prompt',text:'again'});const second=await s.wait('turn_end',mark);await s.wait('idle',mark);assert.equal(second.data.sessionId,first.data.sessionId);
    mark=s.events.length;s.send({op:'new'});s.send({op:'prompt',text:'new'});const third=await s.wait('turn_end',mark);await s.wait('idle',mark);assert.notEqual(third.data.sessionId,first.data.sessionId);
    assert.ok(s.events.every((e,i)=>e.seq===i+1));
  }finally{await s.close();}
  const limited=await session([],{CLOVA_MAX_TURNS:'1'});try{limited.send({op:'prompt',text:'list'});const end=await limited.wait('turn_end');assert.equal(end.data.endReason,'max_turns');assert.equal(end.data.ok,false);}finally{await limited.close();}
});
test('Stop hooks block final text, retry once then fail closed; timeouts emit interrupted + idle',async()=>{
  const root=temp(),hook=join(root,'hook.cjs'),config=join(root,'config.json');
  try{
    writeFileSync(hook,`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({decision:'block',reason:'reject'})));`);
    writeFileSync(config,JSON.stringify({hooks:{Stop:{command:[process.execPath,hook]}}}));
    const s=await session(['--config',config]);try{s.send({op:'prompt',text:'list'});const end=await s.wait('turn_end');assert.equal(end.data.ok,false);assert.equal(s.events.filter(e=>e.t==='text').length,0);}finally{await s.close();}
    writeFileSync(hook,`process.stdin.resume();setTimeout(()=>{},10000);`);
    writeFileSync(config,JSON.stringify({timeoutMs:50,hooks:{UserPromptSubmit:{command:[process.execPath,hook]}}}));
    const timed=await session(['--config',config]);try{timed.send({op:'prompt',text:'wait'});await timed.wait('idle');assert.ok(timed.events.some(e=>e.t==='error'&&e.data.code==='interrupted'));assert.ok(!timed.events.some(e=>e.t==='turn_end'));}finally{await timed.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('real adapter loop retries only before tools; charges usage and stops at session budget',async()=>{
  const root=temp(),key=join(root,'key');writeFileSync(key,'local-test-key',{mode:0o600});
  let count=0,mode='retry';
  const server=createServer(async(req,res)=>{
    for await(const _ of req){}count++;
    if((mode==='retry'&&count===1)||(mode==='after-tool'&&count>1)){res.writeHead(529);res.end();return;}
    const tool=mode==='after-tool';
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:{code:'20000'},result:{message:{role:'assistant',content:tool?'':'ok',...(tool?{toolCalls:[{id:'c1',type:'function',function:{name:'clova__artifact_list',arguments:{}}}]}:{})},finishReason:tool?'tool_calls':'stop',usage:{promptTokens:10,completionTokens:10}}}));
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  async function run(config:object={}){
    const cfg=join(root,'config.json');writeFileSync(cfg,JSON.stringify(config));
    const proc=spawn(process.execPath,[resolve('runtime/clova/harness.ts'),'--events','--workspace',root,'--model','clova:HCX-005','--config',cfg],{env:{...process.env,CLOVA_API_KEY_FILE:key,CLOVA_BASE_URL:`http://127.0.0.1:${(server.address() as any).port}`},stdio:'pipe'});
    const events:any[]=[];proc.stderr.resume();
    createInterface({input:proc.stdout}).on('line',line=>{const e=JSON.parse(line);events.push(e);if(e.t==='ready')proc.stdin.write(JSON.stringify({op:'prompt',text:'test'})+'\n');if(e.t==='idle')proc.stdin.end();});
    const timer=setTimeout(()=>proc.kill('SIGKILL'),10000);
    await new Promise(r=>proc.on('close',r));clearTimeout(timer);return events;
  }
  try{
    let events=await run();assert.equal(count,2);assert.equal(events.find(e=>e.t==='turn_end').data.ok,true);
    count=0;mode='after-tool';events=await run();assert.equal(count,2);assert.equal(events.find(e=>e.t==='turn_end').data.apiErrorStatus,529);assert.equal(events.find(e=>e.t==='idle').data.requiresRestart,true);
    count=0;mode='budget';events=await run({maxBudgetUsd:0.000001,prices:{input:1,output:1,cacheRead:0,cacheWrite:0}});assert.equal(count,1);assert.ok(events.some(e=>e.t==='error'&&e.data.code==='budget_exceeded'));assert.equal(events.some(e=>e.t==='text'),false);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}
});

 test('redaction preserves boolean pass results and masks credential strings',()=>{
  assert.deepEqual(clean({pass:true,password:'sensitive',api_key:'hidden',usage:{input:10,output:5},bypass:false}),{pass:true,password:'***',api_key:'***',usage:{input:10,output:5},bypass:false});
 });
test('per-turn tool execution limit denies repeated side effects',async()=>{
  const root=temp(),cfg=join(root,'profile.json');
  writeFileSync(cfg,JSON.stringify({toolCallLimits:{clova__artifact_list:0}}));
  const s=await session(['--config',cfg]);
  try{s.send({op:'prompt',text:'list'});const end=await s.wait('turn_end');assert.equal(end.data.toolCalls,0);const result=s.events.find(e=>e.t==='tool_result');assert.equal(result.data.ok,false);assert.match(result.data.output,/execution limit/);}
  finally{await s.close();rmSync(root,{recursive:true,force:true});}
});

test('live HCX null arguments become repairable empty arguments, invalid structures stay rejected',()=>{
  const call=(id:string,args:unknown)=>({id,type:'function',function:{name:'artifact_write',arguments:args}});
  const calls=normalizeToolCalls([call('one',{path:'hello.txt',text:'test'}),call('two',null),call('three','{"path":"hello.txt"}')]);
  assert.deepEqual(calls[1].function.arguments,{});
  assert.deepEqual(calls[2].function.arguments,{path:'hello.txt'});
  assert.throws(()=>normalizeToolCalls([call('one',[])]),/object/);
  assert.throws(()=>normalizeToolCalls([call('one',{}),call('one',{})]),/identity/);
});
