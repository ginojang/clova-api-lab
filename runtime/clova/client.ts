import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {Fault, type Tool} from './common.ts';
export class Mcp {
  proc:ChildProcessWithoutNullStreams;
  private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
  private seq=0;
  private dead=false;
  constructor(command:string[],cwd:string,env:NodeJS.ProcessEnv={}) {
    // Credentials are not inherited by tool subprocesses. Explicit env is operator configuration.
    this.proc=spawn(command[0],command.slice(1),{cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:process.env.LANG,...env},stdio:'pipe',detached:process.platform!=='win32'});
    const fail=()=>{this.dead=true;for(const p of this.pending.values())p.reject(new Fault('mcp_error','MCP process closed'));this.pending.clear();};
    this.proc.on('error',fail);this.proc.on('close',fail);this.proc.stdin.on('error',()=>{});
    this.proc.stderr.resume();
    createInterface({input:this.proc.stdout}).on('line',line=>{
      try {const m=JSON.parse(line);const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);m.error?p.reject(new Fault('mcp_error','MCP protocol error')):p.resolve(m.result);}}
      catch {fail();void this.close();}
    });
  }
  request(method:string,params:object={},signal?:AbortSignal,timeoutMs=60000):Promise<any> {
    if(this.dead)return Promise.reject(new Fault('mcp_error','MCP is unavailable'));
    const id=++this.seq;
    return new Promise((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);};
      const abort=()=>{cleanup();reject(new Fault('interrupted','request interrupted'));};
      timer=setTimeout(()=>{cleanup();reject(new Fault('mcp_error','MCP request timed out'));},timeoutMs);
      this.pending.set(id,{resolve:v=>{cleanup();resolve(v);},reject:e=>{cleanup();reject(e);}});
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      this.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }
  async initialize():Promise<{tools:Tool[];instructions:string}> {
    const init=await this.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'clova-harness',version:'1.0.0'}},undefined,10000);
    this.proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const list=await this.request('tools/list');
    if(!Array.isArray(list.tools))throw new Fault('mcp_error','invalid tools/list');
    return {tools:list.tools,instructions:init.instructions??''};
  }
  async close() {
    const kill=(s:NodeJS.Signals)=>{try{if(this.proc.pid&&process.platform!=='win32')process.kill(-this.proc.pid,s);else this.proc.kill(s);}catch{}};
    this.proc.stdin.end();
    if(!this.dead) await Promise.race([new Promise<void>(r=>this.proc.once('close',()=>r())),new Promise<void>(r=>setTimeout(r,300))]);
    // Kill the process group even when the wrapper exited, to collect orphan children.
    kill('SIGTERM');
    if(!this.dead)await new Promise(r=>setTimeout(r,100));
    kill('SIGKILL');
  }
}
