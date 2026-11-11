import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createServer, type Server} from 'node:http';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir, homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createWrapper} from '../http.ts';

const cliDir = process.env.ELDA_CLI_DIR ?? join(homedir(), 'apps/elda-cli');
const cliPresent = existsSync(join(cliDir, 'events.py'));
const bootstrap = resolve('runtime/clova/test/elda-session.py');
type Event = {v:number; seq:number; ts:string; t:string; data:Record<string, any>};
const pause = (ms:number) => new Promise<void>(r => setTimeout(r, ms));
const sourceFiles = ['events.py', 'adapters/loop.py', 'providers/__init__.py', 'providers/openai_compat.py', 'mcp_client.py'];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(join(cliDir, file))).digest('hex')]));

async function listen(server:Server) {
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return `http://127.0.0.1:${(server.address() as {port:number}).port}`;
}
async function closeServer(server:Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

class EldaSession {
  events:Event[] = [];
  proc:ChildProcessWithoutNullStreams;
  stderr = '';
  invalidLines:string[] = [];
  exit:Promise<number|null>;
  constructor(root:string, mode:'2'|'3', base:string, tokenFile:string) {
    const profile = join(root, 'profile.json');
    writeFileSync(profile, JSON.stringify({
      model: `openai-compat:HCX-005@${base}/v1`, max_turns: 8,
      system: 'Use only artifact_write, artifact_read and artifact_undo. Never call clova_chat. Follow the requested exact filename and text.',
      servers: [{name:'clova', command:[process.execPath, resolve('runtime/clova/mcp.ts'), 'mcp', '--workspace', root]}],
    }), {mode:0o600});
    this.proc = spawn(process.env.PYTHON ?? 'python3', [bootstrap, '--cli-dir', cliDir, '--profile', profile,
      '--workspace', root, '--mode', mode, '--token-file', tokenFile], {
      cwd: root, env: {PATH:process.env.PATH, HOME:process.env.HOME, LANG:'C.UTF-8', PYTHONDONTWRITEBYTECODE:'1', ELDA_EVENTS_EOF_WAIT:'10'}, stdio:'pipe',
    });
    this.proc.stderr.on('data', value => {this.stderr += value;});
    this.proc.stdin.on('error', () => {});
    createInterface({input:this.proc.stdout}).on('line', line => {
      try {this.events.push(JSON.parse(line) as Event);} catch {this.invalidLines.push(line);}
    });
    this.exit = new Promise((resolve, reject) => {this.proc.once('error', reject); this.proc.once('close', resolve);});
  }
  send(op:object) {this.proc.stdin.write(JSON.stringify(op)+'\n');}
  async wait(type:string, from=0, timeoutMs=10000):Promise<Event> {
    const until = Date.now()+timeoutMs;
    while(Date.now()<until) {
      const found = this.events.slice(from).find(event => event.t===type);
      if(found) return found;
      if(this.proc.exitCode !== null) break;
      await pause(10);
    }
    throw new Error(`Elda CLI did not emit ${type}; events=${JSON.stringify(this.events)} stderr=${this.stderr}`);
  }
  async turn(text:string) {
    const from=this.events.length;this.send({op:'prompt', text});await this.wait('idle',from);
    return this.events.slice(from);
  }
  async close() {
    this.proc.stdin.end();
    const timer=setTimeout(()=>this.proc.kill('SIGKILL'),12000);
    try {return await this.exit;} finally {clearTimeout(timer);}
  }
}

async function fixture(mode:'2'|'3', delayMs=0) {
  const original=sourceHashes(), root=mkdtempSync(join(tmpdir(),'clova-elda-modes-'));
  const workspace=join(root,'workspace');mkdirSync(workspace);
  const key=join(root,'upstream.key'), token=join(root,'wrapper.key');
  writeFileSync(key,'mode-test-upstream-secret',{mode:0o600});
  writeFileSync(token,'mode-test-wrapper-secret',{mode:0o600});
  const oldKey=process.env.CLOVA_API_KEY_FILE, oldBase=process.env.CLOVA_BASE_URL;
  const requests:any[]=[];
  const upstream=createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      assert.equal(req.url,'/v3/chat-completions/HCX-005');
      assert.equal(req.headers.authorization,'Bearer mode-test-upstream-secret');
      const last=body.messages.at(-1);
      let message:Record<string,unknown>={role:'assistant',content:'done'}, finishReason='stop';
      if(last.role!=='tool') {
        const text=String(last.content);
        const name=text.startsWith('read')?'artifact_read':text.startsWith('undo')?'artifact_undo':'artifact_write';
        const args=name==='artifact_undo'?{}:name==='artifact_read'?{path:'note.txt'}:{path:'note.txt',text:text.startsWith('edit')?'second':'first'};
        assert.ok(body.tools.some((tool:any)=>tool.function.name===name));
        message={role:'assistant',content:'',toolCalls:[{id:`call-${requests.length}`,type:'function',function:{name,arguments:args}}]};
        finishReason='tool_calls';
      } else {
        assert.equal(typeof last.toolCallId,'string');
        assert.equal(typeof last.content,'string');
      }
      if(delayMs)await pause(delayMs);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({status:{code:'20000'},result:{message,finishReason,usage:{promptTokens:13,completionTokens:7}}}));
    } catch(error) {res.writeHead(500);res.end(JSON.stringify({error:String(error)}));}
  });
  const upstreamUrl=await listen(upstream);
  process.env.CLOVA_API_KEY_FILE=key;process.env.CLOVA_BASE_URL=upstreamUrl;
  const wrapper=createWrapper({tokenFile:token,allowedModels:['HCX-005']});
  const wrapperUrl=await listen(wrapper);
  const session=new EldaSession(workspace,mode,wrapperUrl,token);
  const cleanup=async()=>{
    await session.close();await closeServer(wrapper);await closeServer(upstream);
    if(oldKey===undefined)delete process.env.CLOVA_API_KEY_FILE;else process.env.CLOVA_API_KEY_FILE=oldKey;
    if(oldBase===undefined)delete process.env.CLOVA_BASE_URL;else process.env.CLOVA_BASE_URL=oldBase;
    assert.deepEqual(sourceHashes(),original,'installed Elda CLI must remain unchanged');
    rmSync(root,{recursive:true,force:true});
  };
  try {await session.wait('ready');} catch(error) {await cleanup();throw error;}
  return {session,workspace,requests,cleanup};
}

const options={skip:cliPresent?false:'Set ELDA_CLI_DIR to an installed Elda CLI checkout; no replacement loop is used',timeout:30000};

test('Elda mode 2 uses the original approval callback before any MCP side effect', options, async()=>{
  const f=await fixture('2');
  try {
    const {session:s}=f;s.send({op:'prompt',text:'create note.txt'});
    const approval=await s.wait('approval');
    assert.equal(existsSync(join(f.workspace,'note.txt')),false);
    assert.equal(s.events.filter(event=>event.t==='tool_result').length,0);
    assert.equal(f.requests.length,1);
    s.send({op:'approve',approvalId:approval.data.approvalId,allow:true});await s.wait('idle');
    assert.equal(readFileSync(join(f.workspace,'note.txt'),'utf8'),'first');
    assert.equal(s.events.find(event=>event.t==='turn_end')?.data.ok,true);
    const mark=s.events.length;s.send({op:'prompt',text:'edit note.txt'});
    const denied=await s.wait('approval',mark);s.send({op:'approve',approvalId:denied.data.approvalId,allow:false,reason:'test denial'});
    await s.wait('idle',mark);
    assert.equal(readFileSync(join(f.workspace,'note.txt'),'utf8'),'first');
    assert.equal(s.events.slice(mark).find(event=>event.t==='tool_result')?.data.ok,false);
  } finally {await f.cleanup();}
});

test('Elda mode 3 reuses its actual model/MCP session for create, edit, read and undo without approval', options, async()=>{
  const f=await fixture('3');
  try {
    const {session:s}=f;
    const created=await s.turn('create note.txt'), edited=await s.turn('edit note.txt'), read=await s.turn('read note.txt');
    assert.equal(readFileSync(join(f.workspace,'note.txt'),'utf8'),'second');
    assert.match(read.find(event=>event.t==='tool_result')?.data.output,/second/);
    await s.turn('undo note.txt');
    assert.equal(readFileSync(join(f.workspace,'note.txt'),'utf8'),'first','undo stack must survive between turns');
    const first=created.find(event=>event.t==='turn_end')!.data;
    assert.equal(edited.find(event=>event.t==='turn_end')?.data.sessionId,first.sessionId);
    assert.deepEqual(first.usage,{input:26,output:14,cacheRead:0,cacheWrite:0});
    assert.ok(f.requests[2].messages.length>f.requests[0].messages.length,'CLI must preserve conversation history');
    const mark=s.events.length;s.send({op:'notify',text:'read note.txt'});await s.wait('idle',mark);
    assert.ok(s.events.slice(mark).some(event=>event.t==='turn_start'),'idle notify starts a turn in the original CLI');
    assert.equal(s.events.filter(event=>event.t==='approval').length,0);
    assert.deepEqual(s.events.map(event=>event.seq),s.events.map((_,index)=>index+1));
    assert.deepEqual(s.invalidLines,[]);
  } finally {await f.cleanup();}
});

test('Elda mode 3 interrupt suppresses pending tool execution and emits interrupted plus idle', options, async()=>{
  const f=await fixture('3',300);
  try {
    const {session:s}=f;s.send({op:'prompt',text:'create note.txt'});
    await s.wait('turn_start');
    while(f.requests.length===0)await pause(10);
    s.send({op:'interrupt'});await s.wait('idle');
    assert.ok(s.events.some(event=>event.t==='error'&&event.data.code==='interrupted'));
    assert.equal(s.events.some(event=>event.t==='turn_end'),false);
    assert.equal(s.events.some(event=>event.t==='tool_result'),false);
    assert.equal(existsSync(join(f.workspace,'note.txt')),false);
  } finally {await f.cleanup();}
});

test('Elda mode 3 EOF lets the active turn finish and closes the real MCP child', options, async()=>{
  const f=await fixture('3',80);
  try {
    const {session:s}=f;s.send({op:'prompt',text:'create note.txt'});s.proc.stdin.end();
    assert.equal(await s.close(),0);
    assert.equal(readFileSync(join(f.workspace,'note.txt'),'utf8'),'first');
    assert.equal(s.events.find(event=>event.t==='turn_end')?.data.ok,true);
    assert.equal(s.events.at(-1)?.t,'idle');
    assert.equal(s.events.some(event=>event.data.code==='interrupted'),false);
    assert.deepEqual(s.invalidLines,[]);
  } finally {await f.cleanup();}
});
