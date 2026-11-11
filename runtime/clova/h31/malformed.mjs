import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, realpathSync, rmSync} from 'node:fs';
import {resolve, join, dirname, relative, isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

/** Offline comparison only: no --live option or outbound HTTP implementation. */
const {values}=parseArgs({options:{output:{type:'string'},'cli-dir':{type:'string'}}});
const root=resolve(import.meta.dirname,'../../..');
if(!values.output)throw Error('Specify --output NEW_PROJECT_LOCAL_FILE');
const output=resolve(values.output),outputParent=realpathSync(dirname(output));
const outputRelative=relative(root,outputParent);
if(outputRelative==='..'||outputRelative.startsWith('../')||isAbsolute(outputRelative)||existsSync(output))throw Error('Output must be a new project-local file');
const cli=values['cli-dir']??'/home/gino/apps/elda-cli';
const labSources=['runtime/clova/h31/malformed.mjs','runtime/clova/h31/elda-native.py','runtime/clova/langgraph.ts','runtime/clova/mcp.ts','runtime/clova/provider.ts','runtime/clova/common.ts','runtime/clova/client.ts','runtime/clova/provider-errors.ts','runtime/clova/clova-model-config.ts','runtime/memory-lab/pi/cli.mjs','runtime/memory-lab/pi/provider-bridge.mjs','runtime/memory-lab/pi/store.mjs',...['runtime/clova/tool-schema.ts','package.json','package-lock.json'].filter(p=>existsSync(join(root,p)))];
const nativeSources=['elda','events.py','adapters/loop.py','providers/clova.py','providers/__init__.py','mcp_client.py'];
const hash=(base,names)=>Object.fromEntries(names.map(p=>[p,createHash('sha256').update(readFileSync(join(base,p))).digest('hex')]));
const sourceState=()=>({lab:hash(root,labSources),native:hash(cli,nativeSources)});
const system='Use only the supplied artifact tools. Treat invalid tool arguments as errors. Never claim a file was written without a successful tool result. Report the observed outcome briefly.';
const cases=[
  {id:'missing_required',arguments:{path:'artifact.txt'},expectWrite:false,invalid:true},
  {id:'additional_property',arguments:{path:'artifact.txt',text:'SAFE',unexpected:true},expectWrite:false,invalid:true},
  {id:'numeric_text',arguments:{path:'artifact.txt',text:42},expectWrite:false,invalid:true},
  {id:'malformed_json',arguments:'{"path":',expectWrite:false,invalid:true},
  {id:'valid_object',arguments:{path:'artifact.txt',text:'SAFE'},expectWrite:true,invalid:false},
  {id:'json_object_string',arguments:'{"path":"artifact.txt","text":"SAFE"}',expectWrite:true,invalid:false},
];
const initialCall=args=>({status:{code:'20000'},result:{message:{role:'assistant',content:'',toolCalls:[{id:'malformed-call-1',type:'function',function:{name:'artifact_write',arguments:args}}]},finishReason:'tool_calls',usage:{promptTokens:100,completionTokens:20}}});
const completion={status:{code:'20000'},result:{message:{role:'assistant',content:'진단을 종료합니다. 도구 결과에 없는 파일 생성 성공은 주장하지 않습니다.'},finishReason:'stop',usage:{promptTokens:100,completionTokens:20}}};
mkdirSync(join(root,'.local/h31'),{recursive:true});
const work=mkdtempSync(join(root,'.local/h31/malformed-'));
const syntheticKey=join(work,'synthetic.key');writeFileSync(syntheticKey,'synthetic-malformed-comparison-only',{mode:0o600});
const report={version:1,scope:'offline malformed native argument comparison; no real model calls',externalModelCalls:0,startedAt:new Date().toISOString(),settings:{model:'clova:HCX-005',temperature:0,maxTokens:2048,maxTurns:6,tokenLimit:20000,approval:'allow each approval request; count when validation occurs',system},cases,runs:[]};
const fileState=dir=>Object.fromEntries(readdirSync(dir,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>[x.name,readFileSync(join(dir,x.name),'utf8')]));
let outputWritten=false;
try{
 for(const task of cases){
  for(const harness of ['elda','langgraph','pi']){
   const dir=join(work,task.id,harness),workspace=join(dir,'workspace');mkdirSync(workspace,{recursive:true});
   const run={harness,case:task.id,sourcesBefore:sourceState(),requests:[],events:[],errors:[],invalidLines:[],stderr:''};report.runs.push(run);
   const upstream=createServer(async(req,res)=>{
    try{
     let raw='';for await(const c of req)raw+=c;
     if(req.url!=='/v3/chat-completions/HCX-005')throw Error('unexpected_endpoint');
     if(req.headers.authorization!=='Bearer synthetic-malformed-comparison-only')throw Error('unexpected_authentication');
     const response=run.requests.length===0?initialCall(task.arguments):completion;
     run.requests.push({at:new Date().toISOString(),body:JSON.parse(raw),response});
     if(run.requests.length>6){res.writeHead(400);res.end('{}');run.errors.push('mock_call_cap');return;}
     res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));
    }catch(e){run.errors.push(e.message);res.writeHead(400);res.end('{}');}
   });
   await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
   const base=`http://127.0.0.1:${upstream.address().port}`;
   const command=[process.execPath,join(root,'runtime/clova/mcp.ts'),'mcp','--workspace',workspace];
   const server={name:'clova',command,env:{CLOVA_MCP_ALLOWED_TOOLS:'artifact_list,artifact_read,artifact_write,artifact_undo'},instructions:false};
   const profile=join(dir,'profile.json');let args;
   const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',CLOVA_API_KEY_FILE:syntheticKey,CLOVA_BASE_URL:base,ELDA_CLOVA_MAX_TOKENS:'2048',ELDA_MAX_TURNS:'6',ELDA_TOKEN_LIMIT:'20000',ELDA_EVENTS_EOF_WAIT:'5',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'};
   if(harness==='elda'){
    writeFileSync(profile,JSON.stringify({model:'clova:HCX-005',system,servers:[server],max_turns:6,token_limit:20000,tools:{}}));
    args=['python3',join(root,'runtime/clova/h31/elda-native.py'),'--cli-dir',cli,'--profile',profile,'--workspace',workspace];
   }else if(harness==='langgraph'){
    writeFileSync(profile,JSON.stringify({system,servers:[server],maxTurns:6,timeoutMs:20000,tokenLimit:20000,rawToolNames:true,includeMcpInstructions:false,plainToolResults:true}));
    args=[process.execPath,join(root,'runtime/clova/langgraph.ts'),'--events','--workspace',workspace,'--config',profile,'--model','clova:HCX-005','--approve','ask'];
   }else{
    writeFileSync(profile,JSON.stringify({system,workspace,tokenLimit:20000}));
    args=[process.execPath,join(root,'runtime/memory-lab/pi/cli.mjs'),'--store',join(dir,'memory.sqlite'),'--persona',join(root,'runtime/memory-lab/fixtures/live-calm.json'),'--principal','malformed','--conversation',task.id,'--comparison-profile',profile,'--model','clova:HCX-005','--tools','artifacts','--max-tokens','2048','--max-turns','6','--timeout-ms','20000'];
   }
   const proc=spawn(args[0],args.slice(1),{cwd:root,env,stdio:'pipe',detached:true});let closed=false;
   const done=new Promise(r=>proc.once('close',(code,signal)=>{closed=true;run.exitCode=code;run.signal=signal;r();}));
   proc.on('error',()=>run.errors.push('spawn_error'));proc.stdin.on('error',()=>{});
   const send=v=>{if(!closed)proc.stdin.write(JSON.stringify(v)+'\n');};
   proc.stderr.on('data',c=>{run.stderr+=String(c).slice(0,10000-run.stderr.length);});
   createInterface({input:proc.stdout}).on('line',line=>{
    try{const event=JSON.parse(line);run.events.push(event);if(event.t==='approval')send({op:'approve',approvalId:event.data.approvalId,allow:true});}
    catch{run.invalidLines.push(line.slice(0,300));}
   });
   const wait=async(type,mark=0)=>{const end=Date.now()+25000;while(Date.now()<end){if(run.events.slice(mark).some(e=>e.t===type))return;if(closed)throw Error('worker_exit');await delay(10);}throw Error('worker_timeout');};
   try{
    await wait('ready');await delay(30);const mark=run.events.length;
    send({op:'prompt',text:'artifact_write로 artifact.txt에 SAFE를 저장해 주세요.'});await wait('idle',mark);
    run.turnEvents=run.events.slice(mark);run.artifacts=fileState(workspace);
   }catch(e){run.errors.push(e.message);run.artifacts=fileState(workspace);}
   finally{
    proc.stdin.end();await Promise.race([done,delay(5000)]);
    if(!closed){run.forcedKill=true;try{process.kill(-proc.pid,'SIGKILL');}catch{}await done;}
    try{process.kill(-proc.pid,0);run.processGroupClean=false;process.kill(-proc.pid,'SIGKILL');}catch{run.processGroupClean=true;}
    upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
   }
   run.sourcesAfter=sourceState();run.sourceStable=JSON.stringify(run.sourcesBefore)===JSON.stringify(run.sourcesAfter);
   const events=run.turnEvents??[];
   run.observation={approvals:events.filter(e=>e.t==='approval').map(e=>e.data),toolCalls:events.filter(e=>e.t==='tool_call').map(e=>e.data),toolResults:events.filter(e=>e.t==='tool_result').map(e=>e.data),turnEnd:events.find(e=>e.t==='turn_end')?.data??null,text:events.filter(e=>e.t==='text').map(e=>e.data),runtimeErrors:events.filter(e=>e.t==='error').map(e=>e.data)};
   run.observation.noWrite=Object.keys(run.artifacts).length===0;
   run.observation.validationBeforeApproval=task.invalid?run.observation.approvals.length===0:null;
   run.observation.expectedFileState=task.expectWrite?JSON.stringify(run.artifacts)===JSON.stringify({'artifact.txt':'SAFE'}):run.observation.noWrite;
   run.observation.reportedSuccessfulCalls=run.observation.toolResults.filter(r=>r.ok===true).length;
   run.executionValid=run.exitCode===0&&run.processGroupClean&&!run.forcedKill&&!run.errors.length&&!run.invalidLines.length&&run.sourceStable;
   console.log(JSON.stringify({case:task.id,harness,executionValid:run.executionValid,approvals:run.observation.approvals.length,files:run.artifacts,requests:run.requests.length,endReason:run.observation.turnEnd?.endReason??null}));
  }
 }
 report.finishedAt=new Date().toISOString();report.workDirectory=work;report.fixtureRequests=report.runs.reduce((n,r)=>n+r.requests.length,0);
 report.executionValid=report.runs.every(r=>r.executionValid);
 report.strictInvalidNoWrite=report.runs.filter(r=>cases.find(c=>c.id===r.case).invalid).every(r=>r.observation.noWrite);
 report.strictInvalidBeforeApproval=report.runs.filter(r=>cases.find(c=>c.id===r.case).invalid).every(r=>r.observation.validationBeforeApproval);
 report.controlWritesValid=report.runs.filter(r=>!cases.find(c=>c.id===r.case).invalid).every(r=>r.observation.expectedFileState);
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});outputWritten=true;
 console.log(JSON.stringify({executionValid:report.executionValid,strictInvalidNoWrite:report.strictInvalidNoWrite,strictInvalidBeforeApproval:report.strictInvalidBeforeApproval,controlWritesValid:report.controlWritesValid,fixtureRequests:report.fixtureRequests,externalModelCalls:0}));
 if(!report.executionValid)process.exitCode=1;
}finally{
 rmSync(syntheticKey,{force:true});
 if(!outputWritten)process.stderr.write('Comparison did not finish; no final report written.\n');
}
