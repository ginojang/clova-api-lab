import {judgeRecovery, judgeRecoveryReport} from './recovery-next-verdict.mjs';
import {waitForRequestSlot} from './pacing.mjs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const {values}=parseArgs({options:{live:{type:'boolean'},output:{type:'string'},'cli-dir':{type:'string'},preflight:{type:'string'}}});
if(!values.output||existsSync(values.output))throw Error('Specify a NEW --output file');
const root=resolve(import.meta.dirname,'../../..'),cli=values['cli-dir']??'/home/gino/apps/elda-cli';
const system='Use the supplied artifact tools to perform the user request exactly. Never claim an operation succeeded unless the tool result confirms it. Do not change filenames or file contents. Answer briefly in Korean.';
const sourceNames=['runtime/clova/langgraph.ts','runtime/memory-lab/pi/cli.mjs','runtime/memory-lab/pi/provider-bridge.mjs','runtime/clova/provider.ts','runtime/clova/mcp.ts','runtime/clova/h31/elda-native.py','runtime/clova/h31/recovery-next.mjs','runtime/clova/h31/recovery-next-verdict.mjs','runtime/clova/h31/pacing.mjs','runtime/clova/tool-schema.ts','package.json','package-lock.json','runtime/clova/h31/verdict-r2.mjs','runtime/clova/common.ts','runtime/clova/provider-errors.ts','runtime/clova/clova-model-config.ts','runtime/clova/client.ts','runtime/memory-lab/pi/store.mjs'];
const sourceHashes=Object.fromEntries(sourceNames.map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
const nativeHashes=Object.fromEntries(['elda','events.py','adapters/loop.py','profiles.py','providers/clova.py','providers/__init__.py','adapters/__init__.py','mcp_client.py'].map(p=>[p,createHash('sha256').update(readFileSync(join(cli,p))).digest('hex')]));
if(values.live){
  if(!values.preflight)throw Error('Live requires --preflight FILE');
  const pre=JSON.parse(readFileSync(values.preflight,'utf8'));
  if(pre.version!==4||pre.protocol?.protocolPass!==true||pre.experiment!=='recovery-next'||pre.sourceStable!==true||pre.runs?.length!==3||pre.live||!pre.parity?.pass||!pre.boundaryPass||JSON.stringify(pre.sourceHashes)!==JSON.stringify(sourceHashes)||JSON.stringify(pre.nativeHashes)!==JSON.stringify(nativeHashes))throw Error('Fresh matching preflight is required');
}
mkdirSync(join(root,'.local/h31'),{recursive:true});
const work=mkdtempSync(join(root,'.local/h31/run-'));
const key=values.live?process.env.CLOVA_API_KEY_FILE:join(work,'synthetic.key');
if(!key)throw Error('CLOVA_API_KEY_FILE required');
if(!values.live)writeFileSync(key,'synthetic-h31-key',{mode:0o600});
const report={version:4,experiment:'recovery-next',live:Boolean(values.live),startedAt:new Date().toISOString(),sourceHashes,nativeHashes,settings:{model:'clova:HCX-005',system,maxTokens:2048,temperature:0,maxTurns:6,tokenLimit:20000,outerDeadlineMs:120000,totalCallCap:18,minimumRequestIntervalMs:6000,approval:'ask every call',costBasis:'unknown'},runs:[]};
const tc=(id,name,args)=>({id,type:'function',function:{name,arguments:args}});
const answer=(calls=[],content='완료했습니다.')=>({status:{code:'20000'},result:{message:{role:'assistant',content:calls.length?'':content,...(calls.length?{toolCalls:calls}:{})},finishReason:calls.length?'tool_calls':'stop',usage:{promptTokens:100,completionTokens:20}}});
const write=(id,path,text)=>tc(id,'artifact_write',{path,text});
const cases=[
 {id:'recovery',prompts:['artifact_read로 recovered.txt를 읽어 주세요. 파일이 없다는 오류가 나오면 artifact_write로 정확히 RECOVERED를 저장한 뒤 artifact_read로 다시 확인해 주세요.'],expected:[{'recovered.txt':'RECOVERED'}],mock:[answer([tc('r1','artifact_read',{path:'recovered.txt'})]),answer([write('r2','recovered.txt','RECOVERED')]),answer([tc('r3','artifact_read',{path:'recovered.txt'})]),answer()]},
];
let totalCalls=0,forwardedCalls=0,lastForward=0;
function artifacts(dir){return Object.fromEntries(readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>[x.name,readFileSync(join(dir,x.name),'utf8')]));}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
for(const task of cases){
 for(const harness of ['elda','langgraph','pi']){
  const dir=join(work,task.id,harness),workspace=join(dir,'workspace');mkdirSync(workspace,{recursive:true});
  const run={harness,case:task.id,events:[],requests:[],turns:[],stderr:'',invalidLines:[],errors:[]};report.runs.push(run);
  let cursor=0,turnRequests=0;const inflight=new Set();
  const upstream=createServer(async(req,res)=>{
   try{
    let raw='';for await(const c of req)raw+=c;
    const body=JSON.parse(raw),entry={body,at:new Date().toISOString()};run.requests.push(entry);
    totalCalls++;turnRequests++;
    if(turnRequests>6||totalCalls>18){res.writeHead(400);res.end('{}');entry.blocked=true;return;}
    if(req.url!=='/v3/chat-completions/HCX-005')throw Error('Unexpected endpoint');
    const started=Date.now();let payload;
    if(values.live){
      await waitForRequestSlot(lastForward,6000);
      if(res.destroyed||res.writableEnded){entry.cancelledBeforeForward=true;return;}
      lastForward=Date.now();
      forwardedCalls++;entry.forwarded=true;entry.forwardedAt=new Date(lastForward).toISOString();
      const controller=new AbortController();inflight.add(controller);res.once('close',()=>{if(!res.writableEnded)controller.abort();});
      let response;try{response=await fetch('https://clovastudio.stream.ntruss.com'+req.url,{method:'POST',headers:{'content-type':'application/json',authorization:req.headers.authorization??''},body:raw,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
      payload=await response.json();}finally{inflight.delete(controller);}
      entry.httpStatus=response.status;
      entry.rateLimit=Object.fromEntries(['x-ratelimit-limit-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens','x-ratelimit-reset-requests','x-ratelimit-reset-tokens','retry-after'].map(k=>[k,response.headers.get(k)]).filter(([,v])=>typeof v==='string'&&/^[0-9.s-]{1,32}$/.test(v)));
      if(response.ok&&payload.status?.code==='20000')entry.response=payload;
      else entry.errorCode=typeof payload.status?.code==='string'&&/^\d{5}$/.test(payload.status.code)?payload.status.code:'unknown';
      res.writeHead(response.status,{'content-type':'application/json'});
    }else{payload=task.mock[cursor++]??answer();entry.response=payload;entry.httpStatus=200;res.setHeader('content-type','application/json');}
    entry.durationMs=Date.now()-started;res.end(JSON.stringify(payload));
   }catch{run.errors.push('upstream_error');res.writeHead(502);res.end('{}');}
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${upstream.address().port}`;
  const command=[process.execPath,join(root,'runtime/clova/mcp.ts'),'mcp','--workspace',workspace];
  const server={name:'clova',command,env:{CLOVA_MCP_ALLOWED_TOOLS:'artifact_list,artifact_read,artifact_write,artifact_undo'},instructions:false};
  const profile=join(dir,'profile.json');let args;
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',CLOVA_API_KEY_FILE:key,CLOVA_BASE_URL:base,ELDA_CLOVA_MAX_TOKENS:'2048',ELDA_MAX_TURNS:'6',ELDA_TOKEN_LIMIT:'20000',ELDA_EVENTS_EOF_WAIT:'5',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'};
  if(harness==='elda'){
    writeFileSync(profile,JSON.stringify({model:'clova:HCX-005',system,servers:[server],max_turns:6,token_limit:20000,tools:{}}));
    args=['python3',join(root,'runtime/clova/h31/elda-native.py'),'--cli-dir',cli,'--profile',profile,'--workspace',workspace];
  }else if(harness==='langgraph'){
    writeFileSync(profile,JSON.stringify({system,servers:[server],maxTurns:6,timeoutMs:120000,tokenLimit:20000,rawToolNames:true,includeMcpInstructions:false,plainToolResults:true}));
    args=[process.execPath,join(root,'runtime/clova/langgraph.ts'),'--events','--workspace',workspace,'--config',profile,'--model','clova:HCX-005','--approve','ask'];
  }else{
    writeFileSync(profile,JSON.stringify({system,workspace,tokenLimit:20000}));
    args=[process.execPath,join(root,'runtime/memory-lab/pi/cli.mjs'),'--store',join(dir,'memory.sqlite'),'--persona',join(root,'runtime/memory-lab/fixtures/live-calm.json'),'--principal','h31','--conversation',task.id,'--comparison-profile',profile,'--model','clova:HCX-005','--tools','artifacts','--max-tokens','2048','--max-turns','6','--timeout-ms','120000'];
  }
  const proc=spawn(args[0],args.slice(1),{cwd:root,env,stdio:'pipe',detached:true});let closed=false;
  const done=new Promise(r=>proc.once('close',(code,signal)=>{closed=true;run.exitCode=code;run.signal=signal;r();}));
  const send=x=>{if(!closed)proc.stdin.write(JSON.stringify(x)+'\n');};proc.stdin.on('error',()=>{});proc.on('error',()=>{run.errors.push('spawn_error');});
  proc.stderr.on('data',c=>{run.stderr+=String(c).slice(0,20000-run.stderr.length);});
  createInterface({input:proc.stdout}).on('line',line=>{try{const e=JSON.parse(line);run.events.push(e);if(e.t==='approval')send({op:'approve',approvalId:e.data.approvalId,allow:task.id!=='deny_batch'});}catch{run.invalidLines.push(line.slice(0,200));}});
  const deadline=Date.now()+120000;
  const wait=async(type,mark=0)=>{while(Date.now()<deadline){if(run.events.slice(mark).some(e=>e.t===type))return;if(closed)throw Error('worker_exit');await delay(20);}throw Error('worker_timeout');};
  try{
    await wait('ready');await delay(50);
    for(let i=0;i<task.prompts.length;i++){
      turnRequests=0;const mark=run.events.length,reqMark=run.requests.length,start=Date.now();send({op:'prompt',text:task.prompts[i]});await wait('idle',mark);
      const events=run.events.slice(mark),actual=artifacts(workspace);
      run.turns.push({prompt:task.prompts[i],durationMs:Date.now()-start,requests:run.requests.length-reqMark,artifactExpected:task.expected[i],artifactActual:actual,artifactPass:same(actual,task.expected[i]),approvals:events.filter(e=>e.t==='approval').length,turnEnd:events.find(e=>e.t==='turn_end')?.data??null});
    }
  }catch(e){run.errors.push(e.message);}
  finally{
    proc.stdin.end();await Promise.race([done,delay(5000)]);
    if(!closed){run.forcedKill=true;try{process.kill(-proc.pid,'SIGKILL');}catch{}await done;}
    try{process.kill(-proc.pid,0);run.processGroupClean=false;process.kill(-proc.pid,'SIGKILL');}catch{run.processGroupClean=true;}
    for(const c of inflight)c.abort();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
  }
  run.pass=run.turns.length===task.prompts.length&&run.turns.every(t=>t.artifactPass)&&run.exitCode===0&&run.processGroupClean&&!run.errors.length;
  if(task.id==='deny_batch')run.pass&&=run.turns[0]?.approvals===1&&run.turns[0]?.turnEnd?.policyRejected===true;
  Object.assign(run,judgeRecovery(run,Boolean(values.live)));
  console.log(JSON.stringify({harness,case:task.id,pass:run.pass,requests:run.requests.length}));
 }
}
report.parity={checks:cases.flatMap(task=>{const ref=report.runs.find(r=>r.harness==='elda'&&r.case===task.id);return report.runs.filter(r=>r.case===task.id).map(r=>({harness:r.harness,case:task.id,first:same(r.requests[0]?.body,ref.requests[0]?.body),second:values.live?'not_applicable':same(r.requests[1]?.body,ref.requests[1]?.body)}));})};
report.parity.pass=report.parity.checks.every(x=>x.first&&(values.live||x.second));
report.sourceStable=Object.entries(sourceHashes).every(([p,h])=>createHash('sha256').update(readFileSync(join(root,p))).digest('hex')===h)&&Object.entries(nativeHashes).every(([p,h])=>createHash('sha256').update(readFileSync(join(cli,p))).digest('hex')===h);
report.boundaryPass=report.sourceStable&&report.runs.every(r=>r.pass);
report.providerRequests=totalCalls;report.externalModelCalls=forwardedCalls;report.usageUnreportedCalls=report.runs.flatMap(r=>r.requests).filter(r=>!r.blocked&&(!r.response?.result?.usage||!Number.isFinite(r.response.result.usage.promptTokens)||!Number.isFinite(r.response.result.usage.completionTokens))).length;report.usage=report.runs.flatMap(r=>r.requests).reduce((a,r)=>({input:a.input+(r.response?.result?.usage?.promptTokens??0),output:a.output+(r.response?.result?.usage?.completionTokens??0)}),{input:0,output:0});
report.finishedAt=new Date().toISOString();report.workDirectory=work;
report.protocol=judgeRecoveryReport(report);report.boundaryPass=report.protocol.protocolPass;
writeFileSync(values.output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({boundaryPass:report.boundaryPass,parity:report.parity,modelCalls:totalCalls,usage:report.usage}));
if(!report.boundaryPass||(!values.live&&!report.parity.pass))process.exitCode=1;
