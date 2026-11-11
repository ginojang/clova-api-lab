/** Independent artifact and required-tool checks; never use model completion prose. */
export function judgeRun(run, live) {
  const results=run.events.filter(e=>e.t==='tool_result').map(e=>e.data);
  const calls=run.requests.flatMap(r=>r.response?.result?.message?.toolCalls??[]);
  const successful=results.filter(r=>r.ok===true&&calls.some(c=>c.id===r.callId&&c.function.name===r.tool));
  const names=successful.map(r=>r.tool);
  const batchObserved=run.requests.some(r=>(r.response?.result?.message?.toolCalls?.length??0)>=2);
  let requiredToolsPass=false;
  if(run.case==='lifecycle')requiredToolsPass=JSON.stringify(names)===JSON.stringify(['artifact_write','artifact_write','artifact_undo','artifact_read']);
  if(run.case==='recovery')requiredToolsPass=results.some(r=>r.tool==='artifact_read'&&r.ok===false)&&JSON.stringify(names)===JSON.stringify(['artifact_write','artifact_read']);
  if(run.case==='allow_batch')requiredToolsPass=JSON.stringify(names)===JSON.stringify(['artifact_write','artifact_write']);
  if(run.case==='deny_batch')requiredToolsPass=names.length===0&&calls.length>0&&results.every(r=>r.ok===false&&r.sideEffect==='not_started');
  const batchRequired=!live&&['deny_batch','allow_batch'].includes(run.case);
  return {requiredToolsPass,batchObserved,h56:batchObserved&&['deny_batch','allow_batch'].includes(run.case)?'observed':'not_assessed',pass:Boolean(run.pass&&requiredToolsPass&&(!batchRequired||batchObserved))};
}
