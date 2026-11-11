import {test} from 'node:test';
import assert from 'node:assert/strict';
import {judgeRun} from './verdict-r2.mjs';

const call = (name, args = {}) => ({function:{name, arguments:args}});
const write = (path, text) => call('artifact_write', {path, text});
const read = path => call('artifact_read', {path});
function fixture(kind, calls, outcomes = calls.map(() => true)) {
  calls = structuredClone(calls).map((c,i) => ({...c,id:String(i)}));
  const snapshots = kind === 'lifecycle' ? [{'a.txt':'ALPHA'},{'a.txt':'BETA'},{'a.txt':'ALPHA'}]
    : kind === 'recovery' ? [{'recovered.txt':'RECOVERED'}]
    : kind === 'deny_batch' ? [{}] : [{'b.txt':'BRAVO','c.txt':'CHARLIE'}];
  return {case:kind,exitCode:0,processGroupClean:true,errors:[],invalidLines:[],
    turns:snapshots.map(x=>({artifactExpected:x,artifactActual:structuredClone(x),turnEnd:{ok:true}})),
    requests:[{at:'2026-11-11T10:00:00.000Z',response:{result:{message:{toolCalls:calls}}}}],
    events:calls.map((c,i)=>({t:'tool_result',data:{tool:c.function.name,callId:c.id,ok:outcomes[i],sideEffect:'completed'}}))};
}
const lifecycle = () => [write('a.txt','ALPHA'),write('a.txt','BETA'),call('artifact_undo'),read('a.txt')];
test('prospective lifecycle allows repeated final reads but rejects missing read, extra mutations and wrong order',()=>{
  for(const calls of [lifecycle(),[...lifecycle(),read('a.txt'),read('a.txt')]])assert.equal(judgeRun(fixture('lifecycle',calls),true).pass,true);
  for(const calls of [lifecycle().slice(0,3),[...lifecycle(),write('a.txt','ALPHA')],[...lifecycle(),call('artifact_undo')],
    [lifecycle()[0],lifecycle()[1],read('a.txt'),call('artifact_undo')],[...lifecycle(),read('other.txt')]])
    assert.equal(judgeRun(fixture('lifecycle',calls),true).pass,false);
});
test('all model calls need matching result IDs and effects; artifact claims cannot mask changed bytes',()=>{
  for(const mutate of [r=>r.events[3].data.callId='invented',r=>r.events.push(structuredClone(r.events[3])),
    r=>r.events.pop(),r=>r.events[0].data.sideEffect='not_started',r=>r.turns[2].artifactActual['a.txt']='BETA',
    r=>r.invalidLines.push('bad JSONL'),r=>r.forcedKill=true]){
    const r=fixture('lifecycle',lifecycle());mutate(r);assert.equal(judgeRun(r,true).pass,false);
  }
});
test('recovery requires executed failed read then exact write and successful read; extra final reads permitted',()=>{
  const seq=[read('recovered.txt'),write('recovered.txt','RECOVERED'),read('recovered.txt'),read('recovered.txt')];
  const r=fixture('recovery',seq,[false,true,true,true]);assert.equal(judgeRun(r,true).pass,true);
  r.events[0].data.ok=true;assert.equal(judgeRun(r,true).pass,false);
  r.events[0].data.ok=false;r.events[0].data.sideEffect='not_started';assert.equal(judgeRun(r,true).pass,false);
  assert.equal(judgeRun(fixture('recovery',seq.slice(0,2),[false,true]),true).pass,false);
});
function denial(){
  const r=fixture('deny_batch',[write('b.txt','BRAVO'),write('c.txt','CHARLIE')],[false,false]);
  r.events.forEach(e=>e.data.sideEffect='not_started');
  r.events.unshift({t:'approval',ts:'2026-11-11T10:00:02.000Z',data:{approvalId:'approved-id'}});
  r.turns[0].turnEnd={ok:false,policyRejected:true,endReason:'denied'};
  return r;
}
test('denial permits preapproval failed request but rejects any postapproval request or ambiguous timing',()=>{
  const r=denial();r.requests.unshift({at:'2026-11-11T09:59:59.000Z',errorCode:'42901'});
  r.pass=false;assert.equal(judgeRun(r,true).pass,true,'do not reuse r1 count-based run.pass');
  for(const at of ['2026-11-11T10:00:03.000Z','2026-11-11T10:00:02.000Z','invalid',undefined]){
    const bad=denial();bad.requests.push({at});assert.equal(judgeRun(bad,true).pass,false);
  }
  const missing=denial();delete missing.events[0].ts;assert.equal(judgeRun(missing,true).pass,false);
});
test('denial requires one real approval and no effects; rate failure without approval is not denial coverage',()=>{
  for(const mutate of [r=>r.events.shift(),r=>r.events.unshift(structuredClone(r.events[0])),
    r=>r.events[1].data.sideEffect='completed',r=>r.turns[0].turnEnd.ok=true,r=>r.requests=[]]){
    const r=denial();mutate(r);assert.equal(judgeRun(r,true).pass,false);
  }
});
test('mock H56 needs multi-call response; live separate writes retain unobserved H56',()=>{
  const r=fixture('allow_batch',[write('b.txt','BRAVO'),write('c.txt','CHARLIE')]);
  const calls=r.requests[0].response.result.message.toolCalls;
  r.requests=calls.map(c=>({response:{result:{message:{toolCalls:[c]}}}}));
  assert.equal(judgeRun(r,false).pass,false);assert.equal(judgeRun(r,true).pass,true);
  assert.equal(judgeRun(r,true).h56,'not_assessed');
});
