#!/usr/bin/env node
// Research-only generation. Reuses the existing provider; no tools or training.
import {readFileSync,writeFileSync,mkdirSync,existsSync,openSync,closeSync,unlinkSync,renameSync} from 'node:fs';
import {resolve,dirname,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {Brain} from '../clova/provider.ts';
import {clean} from '../clova/common.ts';

const here=dirname(fileURLToPath(import.meta.url)),repo=resolve(here,'../..');
const argv=process.argv.slice(2),live=argv.includes('--live');
const outFlag=argv.indexOf('--out');
if(outFlag<0||!argv[outFlag+1])throw Error('--out NEW_DIRECTORY is required; default mode is dry run');
const out=resolve(argv[outFlag+1]);
if(relative(repo,out).startsWith('..')||out===repo||existsSync(out))throw Error('Output must be a new directory inside this repository');
mkdirSync(out,{recursive:true,mode:0o700});
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const save=(name:string,value:unknown)=>writeFileSync(join(out,name),JSON.stringify(clean(value),null,2)+'\n',{mode:0o600});
const fixturePath=join(here,'fixtures.json'),fixtureBytes=readFileSync(fixturePath),fixture=JSON.parse(fixtureBytes.toString());
if(fixture.plan.length!==120||fixture.skeletons.length!==20||new Set(fixture.plan.map((x:any)=>x.id)).size!==120)throw Error('Expected frozen 20 x 3 x 2 plan');
const model='clova:HCX-005',batchSize=12;
const system=[
  '너는 한국어 문장 표면 실현 자료를 만드는 편집자다. 뜻은 입력이 이미 정했으므로 표현만 다듬는다.',
  fixture.globalInstruction,
  '각 요청 id마다 정확히 한 문장을 만들고 JSON 객체 {"outputs":[{"id":"요청 id","text":"문장"}]} 하나만 출력한다.',
  '코드 블록, 설명, 머리말, 생략된 항목을 넣지 않는다. id와 text 외 필드는 넣지 않는다.',
  'variant 2는 가능하면 조사나 어순만 달리하되 뜻 보존이 우선이다. 다양성을 위해 새 사실을 만들지 않는다.',
].join('\n');
const requests:any[]=[];
for(let i=0;i<fixture.plan.length;i+=batchSize){
  const jobs=fixture.plan.slice(i,i+batchSize),ids=new Set(jobs.map((x:any)=>x.skeletonId));
  const skeletons=fixture.skeletons.filter((x:any)=>ids.has(x.id)).map(({templates,...x}:any)=>x);
  const user=JSON.stringify({styles:fixture.styles,skeletons,requests:jobs});
  requests.push({batch:requests.length+1,jobs,messages:[{role:'system',content:system},{role:'user',content:user}]});
}
const report:any={schema:'realizer-teacher-v1',at:new Date().toISOString(),mode:live?'live':'dry-run',model,
  fixtureSha256:hash(fixtureBytes),runnerSha256:hash(readFileSync(fileURLToPath(import.meta.url))),
  plannedPairs:120,batches:10,batchSize,limits:{hardProjectAttemptLimit:50,maxAttemptsPerBatch:2,maxTokensPerCall:2048,temperature:0,tools:0},
  scope:'Explicit meaning sentence plus typed slots -> style realization. Templates are excluded; not keyword-only role reconstruction.',
  providerFileSha256:hash(readFileSync(join(here,'../clova/provider.ts'))),attempts:[],usage:{input:0,output:0},
  outputs:0,cost:null,usageUnreported:['cacheRead','cacheWrite'],semanticRetries:0};
save('requests.json',requests);save('report.json',report);
if(!live){console.log(JSON.stringify({mode:'dry-run',plannedPairs:120,batches:10,out}));process.exit(0);}

const budgetPath=join(repo,'.local/realizer-teacher-budget.json'),lockPath=budgetPath+'.lock';
mkdirSync(dirname(budgetPath),{recursive:true});
const lock=openSync(lockPath,'wx',0o600);closeSync(lock);
const samples:any[]=[];
let fatal:unknown;
function parse(text:string,jobs:any[]){
  let body=text.trim(),fenceRemoved=false;
  const fence=body.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if(fence){body=fence[1];fenceRemoved=true;}
  const value=JSON.parse(body),rows=value?.outputs;
  if(!Array.isArray(rows)||rows.length!==jobs.length)throw Error('Output count differs from requested batch');
  const byId=new Map(jobs.map((j:any)=>[j.id,j])),seen=new Set();
  const normalized=rows.map((r:any)=>{
    if(!r||typeof r.id!=='string'||!byId.has(r.id)||seen.has(r.id)||typeof r.text!=='string'||!r.text.trim())throw Error('Invalid, duplicated, missing or empty output');
    if(Object.keys(r).some(k=>!['id','text'].includes(k)))throw Error('Unexpected model output fields');
    seen.add(r.id);return {...byId.get(r.id),text:r.text};
  });
  return {normalized,fenceRemoved};
}
try{
  if(!process.env.CLOVA_API_KEY_FILE)process.env.CLOVA_API_KEY_FILE=join(homedir(),'.config/elda/clova.key');
  const brain=new Brain(model);
  const budget=existsSync(budgetPath)?JSON.parse(readFileSync(budgetPath,'utf8')):{limit:50,attempts:0,reservations:[]};
  if(budget.limit!==50||!Number.isInteger(budget.attempts)||budget.attempts<0)throw Error('Invalid project budget ledger');
  report.projectAttemptsBefore=budget.attempts;
  for(const req of requests){
    let completed=false;
    for(let attempt=1;attempt<=2&&!completed;attempt++){
      if(budget.attempts>=50)throw Error('Project request limit reached');
      budget.attempts++;
      budget.reservations.push({at:new Date().toISOString(),run:relative(repo,out),batch:req.batch,attempt,ordinal:budget.attempts});
      writeFileSync(budgetPath+'.tmp',JSON.stringify(budget,null,2)+'\n',{mode:0o600});renameSync(budgetPath+'.tmp',budgetPath);
      const record:any={batch:req.batch,attempt,ordinal:budget.attempts,requestSha256:hash(JSON.stringify(req.messages)),startedAt:new Date().toISOString()};
      const started=performance.now();
      let retryable=false;
      try{
        const answer=await brain.call(req.messages,[],AbortSignal.timeout(65000),{maxTokens:2048});
        record.answer=answer;
        report.usage.input+=answer.usage.input;report.usage.output+=answer.usage.output;
        if(answer.finishReason!=='stop')throw Error('Generation did not stop normally: '+answer.finishReason);
        try{
          const parsed=parse(answer.message.content,req.jobs);
          record.fenceRemoved=parsed.fenceRemoved;record.acceptedIds=parsed.normalized.map((x:any)=>x.id);
          samples.push(...parsed.normalized);completed=true;
        }catch(e){retryable=true;throw e;}
      }catch(error:any){
        record.error={name:error?.name,message:error?.message,code:error?.code,status:error?.status,providerCode:error?.providerCode};
        retryable ||= error?.retryable===true||[429,500,502,503,504].includes(error?.status);
        record.retryable=retryable;
        if(!retryable)fatal=error;
      }finally{
        record.elapsedMs=Math.round(performance.now()-started);report.attempts.push(record);
        report.outputs=samples.length;report.projectAttemptsAfter=budget.attempts;
        save(`batch-${String(req.batch).padStart(2,'0')}-attempt-${attempt}.json`,record);
        save('samples.json',{schemaVersion:'1.0',model,fixtureSha256:report.fixtureSha256,outputs:samples});save('report.json',report);
      }
      if(fatal)throw fatal;
      if(!completed&&attempt<2)await new Promise(r=>setTimeout(r,2000));
    }
  }
}catch(error:any){report.failure={name:error?.name,message:error?.message,code:error?.code};}
finally{
  report.outputs=samples.length;report.missingIds=fixture.plan.filter((j:any)=>!samples.some(x=>x.id===j.id)).map((j:any)=>j.id);
  report.complete=!report.failure&&report.missingIds.length===0;report.clientCallAttempts=report.attempts.length;
  save('samples.json',{schemaVersion:'1.0',model,fixtureSha256:report.fixtureSha256,outputs:samples});save('report.json',report);
  unlinkSync(lockPath);
}
console.log(JSON.stringify({complete:report.complete,outputs:report.outputs,clientCallAttempts:report.clientCallAttempts,usage:report.usage,out,failure:clean(report.failure)}));
process.exitCode=report.complete?0:1;
