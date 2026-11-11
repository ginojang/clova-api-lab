import {test} from 'node:test';
import assert from 'node:assert/strict';
import {judgeRecovery, judgeRecoveryReport} from './recovery-next-verdict.mjs';
import {waitForRequestSlot} from './pacing.mjs';

const fixture = () => ({case:'recovery',exitCode:0,processGroupClean:true,errors:[],invalidLines:[],
  requests:[{response:{result:{message:{toolCalls:[
    {id:'1',function:{name:'artifact_read',arguments:{path:'recovered.txt'}}},
    {id:'2',function:{name:'artifact_write',arguments:{path:'recovered.txt',text:'RECOVERED'}}},
    {id:'3',function:{name:'artifact_read',arguments:{path:'recovered.txt'}}},
  ]}}}}],
  turns:[{artifactActual:{'recovered.txt':'RECOVERED'},artifactExpected:{'recovered.txt':'RECOVERED'}}],
  events:[...['artifact_read','artifact_write','artifact_read'].flatMap((tool,i)=>[
    {t:'approval',data:{tool,callId:String(i+1),approvalId:`approval-${i+1}`,input:{path:'recovered.txt',...(i===1?{text:'RECOVERED'}:{})}}},
    {t:'tool_result',data:{tool,callId:String(i+1),ok:i>0,sideEffect:'completed'}},
  ]),
    {t:'text',data:{text:'복구했습니다.'}},
    {t:'turn_end',data:{ok:true,runCompleted:true,toolFailed:true,policyRejected:false,endReason:'completed'}}],
});
test('recovery verdict requires both verified effects and honest final completion',()=>{
  assert.equal(judgeRecovery(fixture(),true).pass,true);
  for(const mutate of [
    r=>{r.events=r.events.filter(e=>e.t!=='text');},
    r=>{const text=r.events.splice(-2,1)[0];r.events.unshift(text);},
    r=>{r.events=r.events.filter(e=>e.t!=='approval');},
    r=>{r.events[2].data.approvalId=r.events[0].data.approvalId;},
    r=>{r.events[0].data.input={path:'wrong.txt'};},
    r=>{r.events.at(-1).data.toolFailed=false;},
    r=>{r.events.at(-1).data.ok=false;},
    r=>{r.events.at(-1).data.taskSucceeded=true;},
    r=>{r.turns[0].artifactActual={};},
    r=>{r.events.splice(1,1);},
    r=>{r.events.push({t:'error',data:{code:'timeout'}});},
    r=>{r.processGroupClean=false;},
  ]){const run=fixture();mutate(run);assert.equal(judgeRecovery(run,true).pass,false);}
});
test('whole-report gate rejects live wire mismatch and even a 1ms pacing miss',()=>{
  const report={live:true,sourceStable:true,externalModelCalls:3,parity:{pass:true,checks:['elda','langgraph','pi'].map(harness=>({harness,first:true}))},
    runs:['elda','langgraph','pi'].map((harness,i)=>({...fixture(),harness,requests:fixture().requests.map(r=>({...r,forwarded:true,forwardedAt:new Date(6000*i).toISOString()}))}))};
  assert.equal(judgeRecoveryReport(report).protocolPass,true);
  const mismatch=structuredClone(report);mismatch.parity.checks[1].first=false;
  assert.equal(judgeRecoveryReport(mismatch).protocolPass,false);
  const short=structuredClone(report);short.runs[1].requests[0].forwardedAt=new Date(5999).toISOString();
  assert.equal(judgeRecoveryReport(short).pacingPass,false);
  assert.equal(judgeRecoveryReport(short).executionPass,true);
});
test('early-waking timer cannot bypass the minimum request interval',async()=>{
  let clock=0;const waits=[];
  await waitForRequestSlot(0,6000,()=>clock,async duration=>{waits.push(duration);clock+=waits.length===1?duration-1:duration;});
  assert.equal(clock,6000);assert.deepEqual(waits,[6000,1]);
});
