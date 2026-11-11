import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {cpSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';

const originalCli=process.env.ELDA_CLI_DIR??join(homedir(),'apps/elda-cli');
const present=existsSync(join(originalCli,'elda'));
const options={skip:present?false:'ELDA_CLI_DIR is required to verify the real CLI registration',timeout:40000};
const hashSources=()=>Object.fromEntries(['elda','events.py','adapters/loop.py','providers/__init__.py','mcp_client.py'].map(file=>[file,createHash('sha256').update(readFileSync(join(originalCli,file))).digest('hex')]));
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
type Event={v:number;seq:number;t:string;data:Record<string,any>};

async function registered(mode:'ask'|'auto') {
  const originalHashes=hashSources();
  const root=mkdtempSync(join(tmpdir(),'elda-clova-registered-')),cli=join(root,'elda-cli'),workspace=join(root,'workspace');
  cpSync(originalCli,cli,{recursive:true,filter:path=>!relative(originalCli,path).split(sep).some(part=>['.git','__pycache__'].includes(part))});
  cpSync(resolve('runtime/clova/integration/elda_clova.py'),join(cli,'adapters/clova.py'));
  const patch=resolve('runtime/clova/integration/elda-cli-register.patch');
  // An in-repository TMPDIR must not let git discover the enclosing lab repo
  // and silently skip the isolated copy's registration patch.
  const patchOptions={cwd:cli,env:{...process.env,GIT_CEILING_DIRECTORIES:root}};
  try {
    execFileSync('git',['apply','--check',patch],patchOptions);
    execFileSync('git',['apply',patch],patchOptions);
    execFileSync('git',['apply','--reverse','--check',patch],patchOptions);
    assert.notEqual(createHash('sha256').update(readFileSync(join(cli,'elda'))).digest('hex'),originalHashes.elda,'CLI registration patch must change the isolated entry');
  } catch(error) {rmSync(root,{recursive:true,force:true});throw error;}
  mkdirSync(workspace);
  const key=join(root,'clova.key');writeFileSync(key,'registered-cli-test-private-key',{mode:0o600});
  const requests:any[]=[];
  const upstream=createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      assert.equal(req.headers.authorization,'Bearer registered-cli-test-private-key');
      const last=body.messages.at(-1);
      let name:string|undefined,args:object={};
      if(last.role==='user') {
        if(last.content.startsWith('undo'))name='artifact_undo';
        else if(last.content.startsWith('read')){name='artifact_read';args={path:'note.txt'};}
        else {name='artifact_write';args={path:'note.txt',text:last.content.startsWith('edit')?'second':'first'};}
      } else if(last.role==='tool'&&last.toolCallId.includes('undo')){name='artifact_read';args={path:'note.txt'};}
      const message=name?{role:'assistant',content:'',toolCalls:[{id:`${name}-${requests.length}`,type:'function',function:{name:`clova__${name}`,arguments:args}}]}:{role:'assistant',content:'done'};
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:{code:'20000'},result:{message,finishReason:name?'tool_calls':'stop',usage:{promptTokens:9,completionTokens:4}}}));
    } catch(error) {res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const proc=spawn(process.env.PYTHON??'python3',[join(cli,'elda'),'clova','--events','--approve',mode,'--cwd',workspace],{
    cwd:workspace,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1',ELDA_CLOVA_ENTRY:resolve('runtime/clova/langgraph.ts'),ELDA_CLOVA_NODE:process.execPath,
      CLOVA_API_KEY_FILE:key,CLOVA_BASE_URL:`http://127.0.0.1:${(upstream.address() as {port:number}).port}`,CLOVA_MODEL:'clova:HCX-005',ELDA_EVENTS_EOF_WAIT:'15'},stdio:'pipe',
  });
  const events:Event[]=[],raw:string[]=[];let stderr='';
  proc.stderr.on('data',chunk=>stderr+=chunk);proc.stdin.on('error',()=>{});
  const closed=new Promise<number|null>((resolve,reject)=>{proc.once('error',reject);proc.once('close',resolve);});
  createInterface({input:proc.stdout}).on('line',line=>{raw.push(line);try{events.push(JSON.parse(line));}catch{}});
  const send=(value:object)=>proc.stdin.write(JSON.stringify(value)+'\n');
  const wait=async(type:string,from=0)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const found=events.slice(from).find(event=>event.t===type);if(found)return found;if(proc.exitCode!==null)break;await pause(10);}throw new Error(`missing ${type}: ${JSON.stringify(events)} stderr=${stderr}`);};
  const turn=async(text:string)=>{const mark=events.length;send({op:'prompt',text});await wait('idle',mark);return events.slice(mark);};
  const close=async()=>{proc.stdin.end();const timer=setTimeout(()=>proc.kill('SIGKILL'),15000);try{return await closed;}finally{clearTimeout(timer);}};
  const cleanup=async()=>{
    try {
      try {await close();}
      finally {upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
      assert.deepEqual(hashSources(),originalHashes,'installed Elda CLI must not change');
      assert.equal(raw.length,events.length,'CLI stdout must be JSONL only');
      assert.equal((raw.join('\n')+stderr).includes('registered-cli-test-private-key'),false);
    } finally {rmSync(root,{recursive:true,force:true});}
  };
  try {await wait('ready');}catch(error){await cleanup();throw error;}
  return {events,requests,workspace,proc,send,wait,turn,close,cleanup};
}

test('registered Elda clova mode 2 forwards the outer approval callback once before a LangGraph tool effect',options,async()=>{
  const s=await registered('ask');
  try {
    assert.equal(s.events[0].data.agent,'clova');
    s.send({op:'prompt',text:'create note.txt'});const approval=await s.wait('approval');
    assert.equal(existsSync(join(s.workspace,'note.txt')),false);
    assert.equal(s.events.some(event=>event.t==='tool_result'),false);
    s.send({op:'approve',approvalId:approval.data.approvalId,allow:true});await s.wait('idle');
    assert.equal(readFileSync(join(s.workspace,'note.txt'),'utf8'),'first');
    assert.equal(s.events.filter(event=>event.t==='approval').length,1);
    assert.equal(s.events.filter(event=>event.t==='text').length,1);
    assert.equal(s.events.filter(event=>event.t==='turn_end').length,1);
    assert.equal(s.events.filter(event=>event.t==='idle').length,1);
    assert.equal(s.events.find(event=>event.t==='turn_end')?.data.harness,'langgraph');
  } finally {await s.cleanup();}
});

test('registered Elda clova mode 3 uses one persistent LangGraph/MCP session without approval',options,async()=>{
  const s=await registered('auto');
  try {
    const first=await s.turn('create note.txt'),second=await s.turn('edit note.txt'),third=await s.turn('undo and read');
    assert.equal(readFileSync(join(s.workspace,'note.txt'),'utf8'),'first');
    const end1=first.find(event=>event.t==='turn_end')!.data,end2=second.find(event=>event.t==='turn_end')!.data,end3=third.find(event=>event.t==='turn_end')!.data;
    assert.equal(end1.sessionId,end2.sessionId);assert.equal(end2.sessionId,end3.sessionId);
    assert.equal(end3.toolCalls,2);assert.deepEqual(end3.usage,{input:27,output:12,cacheRead:0,cacheWrite:0});
    assert.equal(s.events.some(event=>event.t==='approval'),false);
    assert.equal(s.events.filter(event=>event.t==='idle').length,3);
    assert.ok(s.requests[2].messages.length>s.requests[0].messages.length);
    assert.deepEqual(s.events.map(event=>event.seq),s.events.map((_,index)=>index+1));
    const mark=s.events.length;s.send({op:'new'});await s.wait('idle',mark);const renewed=await s.turn('read note.txt');
    assert.notEqual(renewed.find(event=>event.t==='turn_end')?.data.sessionId,end1.sessionId);
  } finally {await s.cleanup();}
});

test('registered Elda clova interrupt produces one interrupted event and no pending tool effect',options,async()=>{
  const s=await registered('ask');
  try {
    s.send({op:'prompt',text:'create note.txt'});await s.wait('approval');s.send({op:'interrupt'});await s.wait('idle');
    assert.equal(existsSync(join(s.workspace,'note.txt')),false);
    assert.equal(s.events.filter(event=>event.t==='error'&&event.data.code==='interrupted').length,1);
    assert.equal(s.events.filter(event=>event.t==='idle').length,1);
    assert.equal(s.events.some(event=>event.t==='turn_end'),false);
    const mark=s.events.length;s.send({op:'prompt',text:'create note.txt'});
    const approval=await s.wait('approval',mark);s.send({op:'approve',approvalId:approval.data.approvalId,allow:true});await s.wait('idle',mark);
    assert.equal(s.events.slice(mark).some(event=>event.t==='error'),false,'cancelled approval must not leave a stale response in the event queue');
    assert.equal(readFileSync(join(s.workspace,'note.txt'),'utf8'),'first');
  } finally {await s.cleanup();}
});

test('registered Elda clova EOF completes the serving turn and closes the graph child',options,async()=>{
  const s=await registered('auto');
  try {
    s.send({op:'prompt',text:'create note.txt'});assert.equal(await s.close(),0);
    assert.equal(readFileSync(join(s.workspace,'note.txt'),'utf8'),'first');
    assert.equal(s.events.filter(event=>event.t==='turn_end').length,1);
    assert.equal(s.events.filter(event=>event.t==='idle').length,1);
  } finally {await s.cleanup();}
});
