import {test} from 'node:test';
import assert from 'node:assert/strict';
import {judgeRun} from './verdict.mjs';
function fixture(names){return {pass:true,case:'lifecycle',events:names.map((tool,i)=>({t:'tool_result',data:{tool,callId:String(i),ok:true}})),requests:[{response:{result:{message:{toolCalls:names.map((name,i)=>({id:String(i),function:{name}}))}}}}]};}
test('correct artifact alone cannot hide missing read or unmatched tool result',()=>{
  const good=fixture(['artifact_write','artifact_write','artifact_undo','artifact_read']);assert.equal(judgeRun(good,false).pass,true);
  assert.equal(judgeRun(fixture(['artifact_write','artifact_write','artifact_undo']),false).pass,false);
  good.events[3].data.callId='invented';assert.equal(judgeRun(good,false).pass,false);
});
test('mock H56 requires actual multi-call batch; live unobserved batch remains visible',()=>{
  const r=fixture(['artifact_write','artifact_write']);r.case='allow_batch';
  const calls=r.requests[0].response.result.message.toolCalls;
  r.requests=calls.map(c=>({response:{result:{message:{toolCalls:[c]}}}}));
  assert.equal(judgeRun(r,false).pass,false);assert.equal(judgeRun(r,true).h56,'not_assessed');
});
