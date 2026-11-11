import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {createServer, type Server} from 'node:http';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWrapper} from '../http.ts';
import {runClaudeProbe} from '../claude-probe.ts';

const self=fileURLToPath(import.meta.url), here=dirname(self);
const native=join(homedir(),'.local/bin/claude');
const reportDir=resolve(here,'../fixtures.local/native-claude');
async function listen(server:Server) {
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return `http://127.0.0.1:${(server.address() as {port:number}).port}`;
}
async function close(server:Server) {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}

async function isolatedFixture() {
  execFileSync('/usr/sbin/ip',['link','set','lo','up']);
  const interfaces=execFileSync('/usr/sbin/ip',['-j','link','show'],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(interfaces).map((x:any)=>x.ifname),['lo'],'fixture must have no external network interface');
  const fixture=JSON.parse(readFileSync(join(here,'../fixtures/comparison.json'),'utf8'));
  const scratch=mkdtempSync(join(tmpdir(),'clova-native-fixture-'));
  const key=join(scratch,'clova.key'), token=join(scratch,'wrapper.key');
  writeFileSync(key,'mock-clova-provider-key',{mode:0o600});writeFileSync(token,'mock-wrapper-client-key',{mode:0o600});
  const requests:any[]=[], shapes:any[]=[], mockErrors:string[]=[];
  const upstream=createServer(async(req,res)=>{
    try {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);requests.push(body);
      assert.equal(req.url,'/v3/chat-completions/HCX-005');
      assert.equal(req.headers.authorization,'Bearer mock-clova-provider-key');
      assert.deepEqual(body.tools.map((t:any)=>t.function.name).sort(),fixture.tools.map((name:string)=>`mcp__clova__${name}`).sort());
      const user=[...body.messages].reverse().find((m:any)=>m.role==='user');
      const step=fixture.steps.find((s:any)=>String(user?.content).includes(s.prompt));
      assert.ok(step,'mock must receive the exact comparison prompt');
      const last=body.messages.at(-1);
      const tool=(suffix:string,args:object)=>({role:'assistant',content:'',toolCalls:[{id:`mock_call_${requests.length}`,type:'function',function:{name:`mcp__clova__${suffix}`,arguments:args}}]});
      let message:any={role:'assistant',content:'완료했습니다.'}, finishReason='stop';
      if(last.role!=='tool') {
        message=step.id==='undo'?tool('artifact_undo',{}):tool('artifact_write',{path:fixture.file,text:step.expectedText});
        finishReason='tool_calls';
      } else {
        assert.equal(typeof last.toolCallId,'string');
        const previous=body.messages.find((m:any)=>m.toolCalls?.some((c:any)=>c.id===last.toolCallId));
        const lastCall=previous?.toolCalls.find((c:any)=>c.id===last.toolCallId);
        assert.ok(lastCall,'tool result must refer to an earlier model tool call');
        if(lastCall.function.name.endsWith('artifact_undo')) {message=tool('artifact_read',{path:fixture.file});finishReason='tool_calls';}
        if(lastCall.function.name.endsWith('artifact_read'))assert.ok(last.content.includes(fixture.steps[0].expectedText));
      }
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({status:{code:'20000'},result:{message,finishReason,usage:{promptTokens:13,completionTokens:7}}}));
    } catch(error) {mockErrors.push(String(error));res.writeHead(500);res.end(JSON.stringify({error:'mock assertion failed'}));}
  });
  let wrapper:Server|undefined;
  try {
    process.env.CLOVA_API_KEY_FILE=key;process.env.CLOVA_BASE_URL=await listen(upstream);
    wrapper=createWrapper({tokenFile:token,allowedModels:['HCX-005']});
    // Capture schema only. Never preserve authentication headers or complete model prompts.
    wrapper.on('request',(req,res)=>{
      let raw='';req.on('data',chunk=>{raw+=chunk;});req.on('end',()=>{
        try {const body=JSON.parse(raw);const entry={path:req.url,keys:Object.keys(body),outputConfig:body.output_config,
          toolKeys:body.tools?.map((t:any)=>Object.keys(t)),systemKeys:body.system?.map((b:any)=>Object.keys(b)),
          contentKeys:body.messages?.flatMap((m:any)=>Array.isArray(m.content)?m.content.map((b:any)=>Object.keys(b)):[]),status:0};
          shapes.push(entry);res.on('finish',()=>{entry.status=res.statusCode;});
        } catch {/* e.g. health request */}
      });
    });
    const baseUrl=await listen(wrapper);
    const attach=process.argv.includes('--attach');
    let result:any;
    if(attach) {
      const child=spawn('python3',[join(here,'claude-attach-fixture.py'),'--base-url',baseUrl,'--token-file',token,
        '--fixture',join(here,'../fixtures/comparison.json'),'--node',process.execPath,'--mcp',join(here,'../mcp.ts'),
        '--claude',native,'--elda',join(homedir(),'apps/elda-cli/elda')],{env:{PATH:process.env.PATH,HOME:process.env.HOME,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
      let output='',stderr='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
      await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('close',()=>resolve());});
      try {result=JSON.parse(output);}catch {throw new Error(`attach fixture did not return JSON: ${stderr}`);}
    } else result=await runClaudeProbe({baseUrl,tokenFile:token,steps:fixture.steps,artifactPath:fixture.file,
      model:fixture.model,inference:'mock',timeoutMsPerPrompt:45000,outputDir:reportDir,systemPrompt:fixture.systemPrompt,maxTurnsPerPrompt:fixture.maxTurnsPerPrompt});
    const report={...result,events:undefined,layers:{harness:'installed native Claude Code',...(attach?{observer:'installed Elda CLI --attach'}:{}),wrapper:'actual Anthropic-to-CLOVA HTTP adapter',
      tools:'actual artifact MCP server',inference:'deterministic local CLOVA mock'},externalNetworkIsolated:true,
      requests:requests.length,toolResultRequests:requests.filter(body=>body.messages.at(-1)?.role==='tool').length,requestShapes:shapes,mockErrors};
    const destination=attach?resolve(here,'../fixtures.local/native-claude-attach'):reportDir;
    mkdirSync(destination,{recursive:true,mode:0o700});writeFileSync(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
    if(attach) {
      writeFileSync(join(destination,'events.jsonl'),result.events.map((e:any)=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
      for(const turn of result.turns)if(turn.artifactText!==null)writeFileSync(join(destination,`${turn.id}.txt`),turn.artifactText,{mode:0o600});
    }
    return report;
  } finally {if(wrapper)await close(wrapper);await close(upstream);rmSync(scratch,{recursive:true,force:true});}
}

if(process.argv.includes('--isolated-fixture')) {
  try {const report=await isolatedFixture();process.stdout.write(JSON.stringify(report)+'\n');process.exitCode=report.pass?0:1;}
  catch(error) {process.stdout.write(JSON.stringify({pass:false,error:String(error)})+'\n');process.exitCode=1;}
} else {
  test('installed native Claude uses the CLOVA wrapper and one MCP session for create/edit/undo with local model fixtures',{
    skip:existsSync(native)&&existsSync('/usr/bin/unshare')?false:'requires installed native Claude and Linux user/network namespaces',timeout:180000,
  },async()=>{
    const child=spawn('/usr/bin/unshare',['-Urn',process.execPath,self,'--isolated-fixture'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_NO_WARNINGS:'1'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const report=JSON.parse(stdout.trim());
    assert.equal(code,0,JSON.stringify({error:report.error,checks:report.checks,turns:report.turns,shapes:report.requestShapes,mockErrors:report.mockErrors,stderr:report.stderr??stderr}));
    assert.equal(report.pass,true);assert.equal(report.externalNetworkIsolated,true);assert.equal(report.harness,'Claude Code');
    assert.equal(report.inference,'mock');assert.equal(report.checks.processGroupStopped,true);assert.equal(report.turns.length,3);
    assert.equal(report.requests,7);assert.equal(report.toolResultRequests,4);assert.deepEqual(report.mockErrors,[]);
  });
  test('installed Elda --attach observes real native Claude TUI tool round trips through the CLOVA wrapper with local model fixtures',{
    skip:existsSync(native)&&existsSync('/usr/bin/unshare')&&existsSync('/usr/bin/tmux')&&existsSync(join(homedir(),'apps/elda-cli/elda'))?false:'requires installed native Claude/Elda, tmux and Linux namespaces',timeout:180000,
  },async()=>{
    const child=spawn('/usr/bin/unshare',['-Urn',process.execPath,self,'--isolated-fixture','--attach'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_NO_WARNINGS:'1'},stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    const report=JSON.parse(stdout.trim());
    assert.equal(code,0,JSON.stringify({error:report.error,checks:report.checks,screen:report.screen,shapes:report.requestShapes,mockErrors:report.mockErrors,stderr}));
    assert.equal(report.pass,true);assert.equal(report.externalNetworkIsolated,true);assert.equal(report.inference,'mock');
    assert.equal(report.turns.length,3);assert.equal(report.requests,7);assert.equal(report.toolResultRequests,4);
    assert.deepEqual(report.mockErrors,[]);assert.deepEqual(report.leftoverPids,[]);
    assert.equal(report.checks.apiApprovalViaTty,true);assert.equal(report.checks.observerEofLeavesEngineAlive,true);
  });
}
