#!/usr/bin/env node
// Explicitly invoked live smoke test: one MCP generation + three bounded harness turns.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Mcp} from './client.ts';
import {clean,usageZero} from './common.ts';

const args=process.argv.slice(2);
if(!args.includes('--live'))throw new Error('Pass --live to explicitly enable billable CLOVA calls');
const dir=resolve(args[args.indexOf('--out')+1]??'');
if(!args.includes('--out'))throw new Error('--out DIR is required');
const runtime=dirname(fileURLToPath(import.meta.url));
const ext=import.meta.url.endsWith('.mjs')?'.mjs':'.ts';
mkdirSync(dir,{recursive:true,mode:0o700});
const workspace=join(dir,'workspace');mkdirSync(workspace,{mode:0o700});
const model=process.env.CLOVA_MODEL??'clova:HCX-005';
const report:any={at:new Date().toISOString(),model,limits:{tasks:4,maxTurnsPerTask:3,maxTokensPerCall:2048,timeoutMsPerTurn:120000},tests:[],usage:usageZero(),cost:null,costNote:'Provider billing/credit consumption must be checked in NAVER console; no price assumed.'};
const addUsage=(u:any)=>{for(const k of Object.keys(report.usage))report.usage[k]+=u?.[k]??0;};
const save=()=>writeFileSync(join(dir,'report.json'),JSON.stringify(clean(report),null,2)+'\n',{mode:0o600});
let child:ReturnType<typeof spawn>|undefined;
let mcp:Mcp|undefined;
try{
  mcp=new Mcp([process.execPath,join(runtime,`mcp${ext}`),'mcp','--workspace',workspace],workspace,{CLOVA_API_KEY_FILE:process.env.CLOVA_API_KEY_FILE,CLOVA_BASE_URL:process.env.CLOVA_BASE_URL,CLOVA_MODEL:model});
  await mcp.initialize();
  const raw=await mcp.request('tools/call',{name:'clova_chat',arguments:{prompt:'정확히 네이버 연동 확인 이라는 문구만 답하세요.'}});
  if(raw.isError)throw new Error(`clova_chat failed: ${raw.content?.[0]?.text}`);
  const generated=JSON.parse(raw.content[0].text);addUsage(generated.usage);
  report.tests.push({name:'MCP live generation',pass:generated.text.includes('네이버 연동 확인'),text:generated.text,usage:generated.usage});save();
  await mcp.close();mcp=undefined;
  const cfg=join(dir,'profile.json');writeFileSync(cfg,JSON.stringify({maxTurns:3,timeoutMs:120000,toolCallLimits:{clova__artifact_undo:1},system:'한국어로 답하세요. 요청한 파일 작업은 도구로 수행하고, 파일을 읽어 확인하세요. 완료한 뒤 추가 도구 호출 없이 짧게 보고하세요.'}));
  child=spawn(process.execPath,[join(runtime,`harness${ext}`),'--events','--workspace',workspace,'--model',model,'--config',cfg,'--records',join(dir,'records')],{stdio:'pipe',env:process.env});
  child.stderr!.resume();
  const events:any[]=[];let closed=false;
  const exited=new Promise<void>(r=>child!.once('close',()=>{closed=true;r();}));
  createInterface({input:child.stdout!}).on('line',line=>{events.push(JSON.parse(line));});
  const wait=async(type:string,mark=0)=>{
    const start=Date.now();
    while(Date.now()-start<140000){const e=events.slice(mark).find(e=>e.t===type);if(e)return e;if(closed)throw new Error('harness exited before '+type);await new Promise(r=>setTimeout(r,50));}
    throw new Error('timed out waiting for '+type);
  };
  await wait('ready');
  for(const task of [
    {name:'create + read',prompt:'hello.txt 파일에 정확히 "네이버 연동 확인"을 저장하고 읽어서 확인해 주세요.',expected:'네이버 연동 확인'},
    {name:'follow-up edit',prompt:'같은 hello.txt 파일을 정확히 "네이버 연동 확인\n두 번째 턴" 내용으로 수정하고 읽어서 확인해 주세요.',expected:'네이버 연동 확인\n두 번째 턴'},
    {name:'undo + read',prompt:'다음 두 도구를 반드시 순서대로 각각 호출하세요: 1. artifact_undo로 방금 수정을 되돌리기. 2. artifact_read로 hello.txt 읽기. 두 도구 결과를 받은 뒤 완료 보고하세요. 파일을 다시 쓰지 마세요.',expected:'네이버 연동 확인'},
  ]){
    const mark=events.length;
    child.stdin!.write(JSON.stringify({op:'prompt',text:task.prompt})+'\n');
    await wait('idle',mark);
    const turn=events.slice(mark),end=turn.find(e=>e.t==='turn_end')?.data;
    let actual:string|null=null;try{actual=readFileSync(join(workspace,'hello.txt'),'utf8');}catch{}
    const called=turn.filter(e=>e.t==='tool_call').map(e=>e.data.tool);
    const required=task.name==='undo + read'?['clova__artifact_undo','clova__artifact_read']:['clova__artifact_write','clova__artifact_read'];
    const undoExecutions=turn.filter(e=>e.t==='tool_result'&&e.data.tool==='clova__artifact_undo'&&e.data.ok).length;
    const pass=(task.name!=='undo + read'||undoExecutions===1)&&end?.ok===true&&actual?.trim()===task.expected&&required.every(t=>called.includes(t));
    report.tests.push({name:task.name,pass,actual,end,errors:turn.filter(e=>e.t==='error').map(e=>e.data),tools:turn.filter(e=>e.t==='tool_call').map(e=>e.data.tool)});
    addUsage(end?.usage);save();
    if(!pass)break;
  }
  child.stdin!.end();await exited;child=undefined;
  report.pass=report.tests.length===4&&report.tests.every((t:any)=>t.pass);
}catch(e){report.pass=false;report.error=e instanceof Error?e.message:'live test failed';}
finally{await mcp?.close();child?.kill('SIGTERM');save();}
console.log(JSON.stringify(clean(report),null,2));
process.exitCode=report.pass?0:1;
