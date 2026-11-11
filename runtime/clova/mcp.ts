#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Brain } from './provider.ts';
import { Fault, clean, inside, text, number, type Tool } from './common.ts';

export const API_VERSION = '1.0.0';
type Callable = Tool & { run: (args: Record<string, unknown>) => Promise<unknown> };
export function makeTools(workspace: string, brainName = process.env.CLOVA_MODEL ?? 'clova:HCX-005'): Callable[] {
  let brain: Brain | undefined;
  const names = new Map<string, unknown>();
  const undo: {path:string; id:unknown; content:Buffer|null}[]=[];
  const atomicWrite=(p:string,content:string|Buffer)=>{
    const tmp=`${p}.${randomUUID()}.tmp`;
    try{writeFileSync(tmp,content,{flag:'wx',mode:0o600});renameSync(tmp,p);}finally{rmSync(tmp,{force:true});}
  };
  const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
  const path = { type: 'string', description: '작업장 기준 상대 파일 경로' };
  const tools: Callable[] = [
    { name: 'api_version', description: 'CLOVA 래퍼의 안정 API 버전을 반환한다.', inputSchema: schema({}), run: async () => ({version: API_VERSION}) },
    { name: 'artifact_list', description: '작업장 바로 아래 파일과 폴더 이름을 조회한다. 링크는 열지 않는다.', inputSchema: schema({}), run: async () => ({ entries: readdirSync(workspace, {withFileTypes:true}).map(d => ({name:d.name, kind:d.isSymbolicLink()?'link':d.isDirectory()?'directory':'file'})) }) },
    { name: 'artifact_read', description: '작업장 UTF-8 파일을 읽는다. 최대 1 MiB.', inputSchema: schema({path}, ['path']), run: async a => {
      const p = inside(workspace, a.path);
      let s;
      try { s = statSync(p); } catch { throw new Fault('not_found', 'file does not exist; use artifact_list'); }
      if (!s.isFile() || s.size > 1048576) throw new Fault('invalid_argument', 'path must be a file no larger than 1 MiB');
      return { id:a.path, text:readFileSync(p,'utf8') };
    } },
    { name: 'artifact_write', description: '작업장 UTF-8 파일을 원자적으로 생성하거나 덮어쓴다. 최대 100000자.', inputSchema: schema({path, text:{type:'string',description:'저장할 UTF-8 글자'}}, ['path','text']), run: async a => {
      const p = inside(workspace,a.path), content = text(a.text,'text');
      // Parent must already exist: a failed write must not leave new directories behind.
      if (!statSync(dirname(p)).isDirectory()) throw new Fault('not_found','parent directory must exist');
      if(existsSync(p)&&(!statSync(p).isFile()||statSync(p).size>1048576))throw new Fault('invalid_argument','existing target must be a file no larger than 1 MiB');
      const previous=existsSync(p)?readFileSync(p):null;
      if(previous?.equals(Buffer.from(content)))return {id:a.path,bytes:Buffer.byteLength(content),unchanged:true};
      atomicWrite(p,content);undo.push({path:p,id:a.path,content:previous});
      if(undo.length>40)undo.shift();
      return {id:a.path, bytes:Buffer.byteLength(content)};
    } },
    { name:'artifact_undo',description:'최근 파일 쓰기 한 번을 되돌린다. 세션 안 최대 40단계를 보관한다.',inputSchema:schema({}),run:async()=>{
      const last=undo.at(-1);if(!last)throw new Fault('not_found','no write to undo; create an artifact first');
      const p=inside(workspace,last.id);if(p!==last.path)throw new Fault('denied','target path changed since write');
      if(last.content===null)rmSync(p,{force:true});else atomicWrite(p,last.content);
      undo.pop();return {id:last.id};
    } },
    { name:'clova_chat', description:'네이버 CLOVA Studio로 텍스트를 생성한다. 외부 API 비용이 발생하며 도구는 실행하지 않는다.', inputSchema:schema({prompt:{type:'string'}, system:{type:'string'}, timeoutMs:{type:'integer',description:'시간 상한 ms, 100–60000'}},['prompt']), run:async a => {
      const prompt=text(a.prompt,'prompt');
      const system=a.system === undefined ? undefined : text(a.system,'system');
      const timeout=number(a.timeoutMs,'timeoutMs',100,60000,60000);
      if (!Number.isInteger(timeout)) throw new Fault('invalid_argument',`timeoutMs received ${timeout}; use an integer number of milliseconds from 100 to 60000`);
      brain ??= new Brain(brainName);
      const result=await brain.call([...(system?[{role:'system' as const,content:system}]:[]),{role:'user',content:prompt}],[],AbortSignal.timeout(timeout));
      if (result.finishReason !== 'stop') throw new Fault('engine',`generation ended with ${result.finishReason}; shorten the request`);
      return {id:randomUUID(),text:result.message.content,model:brainName,usage:result.usage};
    } },
  ];
  const refs = (v:unknown):unknown => {
    if (typeof v === 'string' && v.startsWith('$')) {
      const [name,...keys]=v.slice(1).split('.');
      let value=names.get(name);
      for (const k of keys) value = value && typeof value === 'object' && Object.hasOwn(value,k) ? (value as Record<string,unknown>)[k] : undefined;
      if (value === undefined) throw new Fault('invalid_argument',`unknown reference ${v}; assign an earlier step with as`);
      return structuredClone(value);
    }
    if (Array.isArray(v)) return v.map(refs);
    if (v && typeof v==='object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,refs(x)]));
    return v;
  };
  tools.push({name:'batch',description:'여러 도구를 순서대로 실행한다. steps[{tool,args,as?}], $이름.id 참조. 실패 단계에서 멈추고 앞의 성공은 유지한다.',inputSchema:schema({steps:{type:'array',items:{type:'object'},description:'최대 40개 단계'}},['steps']),run:async a=>{
    let steps=a.steps;
    if (typeof steps==='string') {
      try { steps=JSON.parse(steps); }
      catch { throw new Fault('invalid_argument','steps is not valid JSON; use an array of {tool,args,as?} objects'); }
    }
    if (!Array.isArray(steps)||!steps.length||steps.length>40) throw new Fault('invalid_argument','steps must contain 1–40 steps');
    const results:unknown[]=[];
    for (const [i,s] of steps.entries()) {
      try {
        if (!s || typeof s!=='object' || (s.as !== undefined && (typeof s.as!=='string'||!/^[a-zA-Z_][\w-]*$/.test(s.as)))) throw new Fault('invalid_argument','step needs tool, args and optional valid as name');
        const tool=tools.find(t=>t.name===s.tool && t.name!=='batch');
        if (!tool) throw new Fault('invalid_argument',`unknown batch tool ${s.tool}`);
        const args=refs(s.args??{}) as Record<string,unknown>;
        if (!args || typeof args!=='object'||Array.isArray(args)) throw new Fault('invalid_argument','args must be an object');
        const result=await tool.run(args); results.push(result);
        if(s.as) names.set(s.as,structuredClone(result));
      } catch(e) { return {completed:i,results,failed:{step:i,tool:s?.tool,error:errorText(e)}}; }
    }
    return {completed:steps.length,results};
  }});
  return tools.map(t=>({...t,annotations:{readOnlyHint:['api_version','artifact_list','artifact_read'].includes(t.name),destructiveHint:['artifact_write','artifact_undo','batch'].includes(t.name),idempotentHint:['api_version','artifact_list','artifact_read','artifact_write'].includes(t.name),openWorldHint:['clova_chat','batch'].includes(t.name)}}));
}
export function errorText(e:unknown) { return e instanceof Fault ? `${e.code}: ${e.message}` : 'engine: operation failed; check workspace and service configuration'; }
export async function serve(workspace:string,lean=false) {
  let tools=makeTools(workspace);
  const allowed=process.env.CLOVA_MCP_ALLOWED_TOOLS?.split(',').map(x=>x.trim()).filter(Boolean);
  if (allowed) {
    if (!allowed.length || lean || allowed.includes('batch') || allowed.some(name=>!tools.some(t=>t.name===name))) throw new Fault('configuration','restricted tool profiles need known individual tools; batch and lean are unavailable');
    tools=tools.filter(t=>allowed.includes(t.name));
  }
  const byName=new Map(tools.map(t=>[t.name,t]));
  const send=(obj:object)=>{process.stdout.write(JSON.stringify(clean({jsonrpc:'2.0',...obj}))+'\n');};
  let queue=Promise.resolve();
  const lines=createInterface({input:process.stdin});
  lines.on('line',line=>{
    queue=queue.then(async()=>{
      let req;
      try {req=JSON.parse(line);} catch {send({id:null,error:{code:-32700,message:'invalid JSON'}});return;}
      if (!req || typeof req!=='object'||Array.isArray(req)||req.jsonrpc!=='2.0'||typeof req.method!=='string') {send({id:req?.id??null,error:{code:-32600,message:'invalid request'}});return;}
      if(req.id===undefined) return;
      const reply=(result:unknown)=>send({id:req.id,result});
      if(req.method==='initialize') {reply({protocolVersion:'2025-06-18',serverInfo:{name:'clova-mcp',version:API_VERSION},capabilities:{tools:{}},instructions:`파일은 작업장 상대 경로, 텍스트는 UTF-8, 제한 크기는 bytes/문자 단위. clova_chat은 유료 외부 호출. 오류: invalid_argument, not_found, denied, engine, api_error, timeout, interrupted, configuration. batch는 부분 성공을 failed로 알린다. ${process.env.CLOVA_MCP_NOTE??''}`});return;}
      if(req.method==='ping') {reply({});return;}
      if(req.method==='tools/list') {reply({tools:tools.filter(t=>!lean||t.name==='batch').map(({run:_,...t})=>lean?{...t,description:t.description+'\n'+tools.filter(x=>x.name!=='batch').map(x=>`${x.name}(${Object.keys((x.inputSchema.properties??{}) as object).join(',')}): ${x.description}`).join('\n')}:t)});return;}
      if(req.method==='tools/call') {
        try {
          const tool=byName.get(req.params?.name);
          if(!tool || (lean&&tool.name!=='batch')) throw new Fault('not_found','unknown tool; use tools/list');
          const args=req.params?.arguments??{};
          if(!args||typeof args!=='object'||Array.isArray(args)) throw new Fault('invalid_argument','arguments must be an object');
          const result=await tool.run(args);
          reply({content:[{type:'text',text:JSON.stringify(clean(result))}],isError:false});
        } catch(e) {reply({content:[{type:'text',text:errorText(e)}],isError:true});}
        return;
      }
      send({id:req.id,error:{code:-32601,message:'unknown method'}});
    }).catch(()=>send({id:null,error:{code:-32603,message:'internal error'}}));
  });
  await new Promise<void>(resolve=>lines.on('close',()=>void queue.then(resolve)));
}
if(process.argv[1] && import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  const args=process.argv.slice(2), workspace=args[args.indexOf('--workspace')+1];
  if(args[0]!=='mcp'||!args.includes('--workspace')||!workspace) {process.stderr.write('Usage: clova-mcp mcp --workspace DIR [--lean]\n');process.exitCode=2;}
  else {mkdirSync(workspace,{recursive:true,mode:0o700});await serve(workspace,args.includes('--lean'));}
}
