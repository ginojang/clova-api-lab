// Transparent JSONL transport + deterministic local provider for the official kit.
// No events are renamed/suppressed/generated. Default phase supplies an operator
// approval; explicit --approve ask leaves all answers to the official kit.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,appendFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(import.meta.dirname,'../../..');
const opt=n=>{const i=process.argv.indexOf(n);return i<0?undefined:process.argv[i+1];};
const harness=opt('--harness'), workspace=resolve(opt('--workspace')??'');
const rel=relative(root,workspace);
if(!['elda','langgraph','pi'].includes(harness)||rel.startsWith('..')||isAbsolute(rel)||!rel)throw Error('kit workspace must be inside own repo');
const traceBase=resolve(process.env.KIT_TRACE_ROOT??join(root,'.local/h31-kit-traces'));
if(relative(root,traceBase).startsWith('..'))throw Error('trace must stay inside own repo');
mkdirSync(traceBase,{recursive:true});
const trace=mkdtempSync(join(traceBase,`${harness}-`)), profile=join(trace,'profile.json'), key=join(trace,'synthetic.key');
writeFileSync(key,'synthetic-official-kit-key',{mode:0o600});
const ask=opt('--approve')==='ask', batch=process.env.H31_KIT_BATCH==='1';
const maxTurns=Number(process.env.H31_KIT_MAX_TURNS??6);
const model='clova:HCX-005', cli='/home/gino/apps/elda-cli';
const report={harness,ask,batch,maxTurns,externalCalls:0,requests:[],automaticApprovals:0,workspace,trace,sourceHashes:{}};
for(const name of ['runtime/clova/langgraph.ts','runtime/clova/provider.ts','runtime/clova/mcp.ts','runtime/clova/tool-schema.ts','runtime/memory-lab/pi/cli.mjs','runtime/clova/h31/kit-driver.mjs','package.json','package-lock.json'])report.sourceHashes[name]=createHash('sha256').update(readFileSync(join(root,name))).digest('hex');
if(harness==='elda')for(const name of ['events.py','adapters/loop.py','providers/clova.py'])report.sourceHashes['installed/'+name]=createHash('sha256').update(readFileSync(join(cli,name))).digest('hex');
let seq=0;
const mock=createServer(async(req,res)=>{
 try{
  let raw='';for await(const c of req)raw+=c;
  const body=JSON.parse(raw);report.requests.push({path:req.url,body});
  const needsTool=body.messages.at(-1)?.role!=='tool';
  const calls=needsTool?[{id:`kit-${++seq}-a`,type:'function',function:{name:'artifact_write',arguments:{path:'kit-a.txt',text:'ALPHA'}}},...(batch?[{id:`kit-${seq}-b`,type:'function',function:{name:'artifact_write',arguments:{path:'kit-b.txt',text:'BETA'}}}]:[])]:[];
  const response={status:{code:'20000'},result:{message:{role:'assistant',content:calls.length?'':'파일 작업을 확인했습니다.',...(calls.length?{toolCalls:calls}:{})},finishReason:calls.length?'tool_calls':'stop',usage:{promptTokens:100,completionTokens:20}}};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
 }catch{res.writeHead(400);res.end('{}');}
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const server={name:'clova',command:[process.execPath,join(root,'runtime/clova/mcp.ts'),'mcp','--workspace',workspace],env:{CLOVA_MCP_ALLOWED_TOOLS:'artifact_list,artifact_read,artifact_write,artifact_undo'},instructions:false};
const system='Use artifact tools and report observed results.';
const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',CLOVA_API_KEY_FILE:key,CLOVA_BASE_URL:`http://127.0.0.1:${mock.address().port}`,ELDA_MAX_TURNS:String(maxTurns),ELDA_TOKEN_LIMIT:'20000',ELDA_CLOVA_MAX_TOKENS:'2048',ELDA_EVENTS_EOF_WAIT:'3',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'};
let cmd;
if(harness==='elda'){
 writeFileSync(profile,JSON.stringify({model,system,servers:[server],max_turns:maxTurns,token_limit:20000,approve:'always'}));
 cmd=['python3',join(root,'runtime/clova/h31/kit-native.py'),'--profile',profile,'--workspace',workspace,'--cli-dir',cli];
}else if(harness==='langgraph'){
 writeFileSync(profile,JSON.stringify({system,servers:[server],maxTurns,timeoutMs:15000,tokenLimit:20000,rawToolNames:true,includeMcpInstructions:false,plainToolResults:true}));
 cmd=[process.execPath,join(root,'runtime/clova/langgraph.ts'),'--events','--workspace',workspace,'--config',profile,'--model',model,'--approve','ask'];
}else{
 writeFileSync(profile,JSON.stringify({system,workspace,tokenLimit:20000}));
 cmd=[process.execPath,join(root,'runtime/memory-lab/pi/cli.mjs'),'--store',join(trace,'memory.sqlite'),'--persona',join(root,'runtime/memory-lab/fixtures/live-calm.json'),'--principal','official-kit','--conversation','official-kit','--comparison-profile',profile,'--model',model,'--tools','artifacts','--max-tokens','2048','--max-turns',String(maxTurns),'--timeout-ms','15000'];
}
const child=spawn(cmd[0],cmd.slice(1),{cwd:root,env,stdio:'pipe',detached:true});let closed=false;
const done=new Promise(r=>child.once('close',(code,signal)=>{closed=true;report.exitCode=code;report.signal=signal;r();}));
child.on('error',()=>{report.spawnError=true;});child.stdin.on('error',()=>{});
child.stderr.on('data',c=>appendFileSync(join(trace,'stderr.txt'),c));
const send=line=>{if(!closed)child.stdin.write(line+'\n');};
createInterface({input:child.stdout}).on('line',line=>{
 appendFileSync(join(trace,'stdout.jsonl'),line+'\n');process.stdout.write(line+'\n');
 try{const e=JSON.parse(line);if(!ask&&e.t==='approval'){report.automaticApprovals++;send(JSON.stringify({op:'approve',approvalId:e.data.approvalId,allow:true}));}}catch{}
});
const input=createInterface({input:process.stdin});
input.on('line',line=>{appendFileSync(join(trace,'stdin.jsonl'),line+'\n');send(line);});
await new Promise(r=>input.once('close',r));child.stdin.end();
await Promise.race([done,delay(5000)]);
if(!closed){report.forcedKill=true;try{process.kill(-child.pid,'SIGKILL');}catch{}await done;}
try{process.kill(-child.pid,0);report.processGroupClean=false;process.kill(-child.pid,'SIGKILL');}catch{report.processGroupClean=true;}
mock.closeAllConnections();await new Promise(r=>mock.close(r));
report.artifacts=Object.fromEntries(readdirSync(workspace,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>[x.name,readFileSync(join(workspace,x.name),'utf8')]));
writeFileSync(join(trace,'report.json'),JSON.stringify(report,null,2)+'\n');
process.exitCode=report.exitCode??1;
