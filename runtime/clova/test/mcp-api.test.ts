import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Mcp} from '../client.ts';

test('direct MCP artifact boundary rejects invalid schema before any file effect',async()=>{
  const root=mkdtempSync(join(tmpdir(),'clova-schema-api-'));
  const mcp=new Mcp([process.execPath,resolve('runtime/clova/mcp.ts'),'mcp','--workspace',root],root,{CLOVA_MCP_ALLOWED_TOOLS:'artifact_write,artifact_read'});
  try{
    await mcp.initialize();
    for(const args of [{path:'bad.txt'},{path:'bad.txt',text:42},{path:'bad.txt',text:'bad',extra:true}]){
      const result=await mcp.request('tools/call',{name:'artifact_write',arguments:args});
      assert.equal(result.isError,true);assert.equal(JSON.parse(result.content[0].text).sideEffect,'not_started');
      assert.equal(existsSync(join(root,'bad.txt')),false);
    }
    assert.equal((await mcp.request('tools/call',{name:'artifact_write',arguments:{path:'good.txt',text:'GOOD'}})).isError,false);
    assert.equal(existsSync(join(root,'good.txt')),true);
  }finally{await mcp.close();rmSync(root,{recursive:true,force:true});}
});

test('CLOVA MCP crosses real stdio and HTTP; rejects invalid input and survives provider failures', async () => {
  const root=mkdtempSync(join(tmpdir(),'clova-mcp-api-'));
  const key=join(root,'credential');
  writeFileSync(key,'fixture-clova-secret',{mode:0o600});
  let mode='ok';
  const requests:any[]=[];
  const api=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    requests.push({path:req.url,auth:req.headers.authorization,body:JSON.parse(raw)});
    if(mode==='slow'){await new Promise(r=>setTimeout(r,180));}
    if(mode==='429'){res.writeHead(429);res.end('fixture-clova-secret');return;}
    if(mode==='json'){res.end('not-json fixture-clova-secret');return;}
    const result:any={message:{role:'assistant',content:'CLOVA MCP 확인'},finishReason:mode==='length'?'length':'stop',usage:{promptTokens:9,completionTokens:4}};
    if(mode==='usage')delete result.usage;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({status:{code:'20000'},result}));
  });
  await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));
  const mcp=new Mcp([process.execPath,resolve('runtime/clova/mcp.ts'),'mcp','--workspace',root],root,{
    CLOVA_API_KEY_FILE:key,CLOVA_MODEL:'clova:HCX-005',CLOVA_BASE_URL:`http://127.0.0.1:${(api.address() as any).port}`,
  });
  const call=(name:string,args:object)=>mcp.request('tools/call',{name,arguments:args});
  const value=(r:any)=>JSON.parse(r.content[0].text);
  try{
    const info=await mcp.initialize();
    assert.ok(info.tools.some(t=>t.name==='clova_chat'));
    const success=await call('clova_chat',{prompt:'확인',system:'짧게 답한다.'});
    assert.equal(success.isError,false);
    assert.equal(value(success).text,'CLOVA MCP 확인');
    assert.deepEqual(value(success).usage,{input:9,output:4,cacheRead:0,cacheWrite:0});
    assert.equal(requests[0].path,'/v3/chat-completions/HCX-005');
    assert.equal(requests[0].auth,'Bearer fixture-clova-secret');
    assert.equal(requests[0].body.messages[0].role,'system');
    assert.equal(requests[0].body.tools,undefined);
    for(const args of [{prompt:''},{prompt:'x',timeoutMs:100.5}]){
      const failure=await call('clova_chat',args);
      assert.equal(failure.isError,true);assert.match(failure.content[0].text,/^invalid_argument:/);
    }
    assert.equal(requests.length,1,'invalid arguments must not incur an API request');
    for(const [failureMode,code] of [['429','api_error'],['json','api_error'],['length','engine'],['usage','api_error'],['slow','timeout']]){
      mode=failureMode;
      const failure=await call('clova_chat',{prompt:'확인',timeoutMs:100});
      assert.equal(failure.isError,true,failureMode);
      assert.match(failure.content[0].text,new RegExp(`^${code}:`));
      assert.ok(!JSON.stringify(failure).includes('fixture-clova-secret'));
      assert.deepEqual(await mcp.request('ping'),{});
    }
    mode='429';
    const batch=await call('batch',{steps:[{tool:'clova_chat',args:{prompt:'실패'}},{tool:'artifact_write',args:{path:'must-not-exist',text:'bad'}}]});
    assert.equal(value(batch).completed,0);assert.equal(value(batch).failed.step,0);
    assert.equal(existsSync(join(root,'must-not-exist')),false);
    const textBatch=await call('batch',{steps:JSON.stringify([{tool:'api_version'}])});
    assert.equal(value(textBatch).completed,1);
  }finally{
    await mcp.close();api.closeAllConnections();await new Promise<void>(r=>api.close(()=>r()));
    rmSync(root,{recursive:true,force:true});
  }
});
