/** Explicit paid smoke test. Credentials stay in the wrapper parent; native Claude sees only its loopback token. */
import {spawn} from 'node:child_process';
import {createServer, request, type Server} from 'node:http';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWrapper, type WrapperCallMetrics} from '../http.ts';
import {clean, usageZero, type Usage} from '../common.ts';

const here=dirname(fileURLToPath(import.meta.url));
async function listen(server:Server) {await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
async function close(server:Server) {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}

async function main() {
  if(!process.argv.includes('--live'))throw new Error('This paid test requires explicit --live');
  const tokenFile=process.env.CLOVA_WRAPPER_TOKEN_FILE;
  if(!tokenFile||!process.env.CLOVA_API_KEY_FILE)throw new Error('CLOVA_API_KEY_FILE and CLOVA_WRAPPER_TOKEN_FILE are required');
  const fixturePath=join(here,'../fixtures/comparison.json'), task=JSON.parse(readFileSync(fixturePath,'utf8'));
  const args=process.argv.slice(2), out=resolve(args.includes('--output')?args[args.indexOf('--output')+1]:join(here,'../comparison-attach-live.local'));
  const metrics:WrapperCallMetrics[]=[], gateCalls:{step:string;count:number;allowed:boolean}[]=[];
  const counts=new Map<string,{count:number;started:number}>();
  const wrapper=createWrapper({tokenFile,allowedModels:[task.model],onCall:m=>metrics.push(m)});
  let gate:Server|undefined;
  try {
    const base=await listen(wrapper);
    // Test-only budget gate preserves the body verbatim, but never forwards a fifth model request in one prompt.
    gate=createServer(async(req,res)=>{
      try {
        let raw='';for await(const chunk of req)raw+=chunk;
        const body=JSON.parse(raw);
        const texts=[...body.messages].reverse().filter((m:any)=>m.role==='user').flatMap((m:any)=>typeof m.content==='string'?[m.content]:m.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text));
        const step=task.steps.find((s:any)=>texts[0]?.includes(s.prompt));
        if(!step)throw new Error('unexpected model request');
        const state=counts.get(step.id)??{count:0,started:Date.now()};state.count++;counts.set(step.id,state);
        const allowed=state.count<=task.maxTurnsPerPrompt&&Date.now()-state.started<=task.timeoutMsPerPrompt;
        gateCalls.push({step:step.id,count:state.count,allowed});
        if(!allowed) {res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'Test request budget exhausted.'}}));return;}
        const upstream=request(base+(req.url??'/v1/messages'),{method:req.method,headers:req.headers},response=>{
          res.writeHead(response.statusCode??502,response.headers);response.pipe(res);
        });
        upstream.once('error',()=>{if(!res.writableEnded){res.writeHead(502);res.end('{}');}});
        res.once('close',()=>upstream.destroy());upstream.end(raw);
      }catch {res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Unexpected test request.'}}));}
    });
    const helper=spawn('python3',[join(here,'claude-attach-fixture.py'),'--base-url',await listen(gate),'--token-file',tokenFile,
      '--fixture',fixturePath,'--node',process.execPath,'--mcp',join(here,'../mcp.ts'),
      '--claude',join(homedir(),'.local/bin/claude'),'--elda',join(homedir(),'apps/elda-cli/elda'),
      '--inference','live','--turn-timeout',String(task.timeoutMsPerPrompt/1000)],
      {env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
    let output='',stderr='';helper.stdout.on('data',chunk=>{output+=chunk;});helper.stderr.on('data',chunk=>{stderr+=chunk;});
    await new Promise<void>((resolve,reject)=>{helper.once('error',reject);helper.once('close',()=>resolve());});
    let result:any;try{result=JSON.parse(output);}catch{throw new Error(`Attach helper did not return JSON: ${stderr}`);}
    const usage=usageZero();for(const metric of metrics)for(const key of Object.keys(usage) as (keyof Usage)[])usage[key]+=metric.usage?.[key]??0;
    const report=clean({...result,events:undefined,createdAt:new Date().toISOString(),task,model:task.model,usage,modelCalls:metrics.length,gateCalls,
      limits:{modelRequestsPerPrompt:task.maxTurnsPerPrompt,timeoutMsPerPrompt:task.timeoutMsPerPrompt},
      layers:{harness:'installed native Claude Code interactive',observer:'installed Elda CLI --attach',wrapper:'actual Anthropic-to-CLOVA HTTP adapter',tools:'actual artifact MCP server',inference:'live NAVER CLOVA Studio'},
      caveat:'One three-turn smoke task. This proves integration and task execution, not a general model-quality ranking.'}) as any;
    mkdirSync(out,{recursive:true,mode:0o700});
    writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    writeFileSync(join(out,'events.jsonl'),result.events.map((e:any)=>JSON.stringify(clean(e))).join('\n')+'\n',{mode:0o600});
    writeFileSync(join(out,'upstream-metrics.json'),JSON.stringify(metrics,null,2)+'\n',{mode:0o600});
    for(const turn of result.turns)if(turn.artifactText!==null)writeFileSync(join(out,`${turn.id}.txt`),turn.artifactText,{mode:0o600});
    process.stdout.write(JSON.stringify({pass:report.pass,inference:report.inference,model:report.model,usage,modelCalls:metrics.length,
      turns:report.turns.map((t:any)=>({id:t.id,pass:t.pass,durationMs:t.durationMs,checks:t.checks})),checks:report.checks,error:report.error,outputDir:out})+'\n');
    process.exitCode=report.pass?0:1;
  }finally{if(gate)await close(gate);await close(wrapper);}
}
try{await main();}catch(error){process.stderr.write(JSON.stringify(clean({error:error instanceof Error?error.message:'Live attach failed'}))+'\n');process.exitCode=2;}
