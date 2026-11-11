import {judgeRun} from './verdict-r2.mjs';
import {isDeepStrictEqual} from 'node:util';

/** Follow-up only: artifact/effect evidence AND usable final output after recovery. */
export function judgeRecovery(run, live) {
  const base = judgeRun(run, live);
  const ends = (run.events ?? []).filter(e => e.t === 'turn_end');
  const end = ends[0]?.data;
  const events = run.events ?? [];
  const lastResult = events.findLastIndex(e => e.t === 'tool_result');
  const endIndex = events.findIndex(e => e.t === 'turn_end');
  const finalOutputPass = lastResult >= 0 && events.some((e,i) => i > lastResult && i < endIndex
    && e.t === 'text' && typeof e.data?.text === 'string' && e.data.text.trim());
  const results = events.filter(e => e.t === 'tool_result');
  const approvals = events.filter(e => e.t === 'approval');
  const calls = (run.requests ?? []).flatMap(r => r.response?.result?.message?.toolCalls ?? []);
  const approvalPass = approvals.length === results.length && approvals.length > 0
    && new Set(approvals.map(e => e.data?.approvalId)).size === approvals.length
    && results.every(result => {
      const matches = approvals.filter(e => e.data?.callId === result.data?.callId && e.data?.tool === result.data?.tool);
      const call = calls.find(call => call.id === result.data?.callId);
      return matches.length === 1 && typeof matches[0].data.approvalId === 'string' && matches[0].data.approvalId.length > 0
        && call && isDeepStrictEqual(matches[0].data.input,call.function?.arguments)
        && events.indexOf(matches[0]) < events.indexOf(result);
    });
  const completionPass = ends.length === 1 && end?.ok === true && end.runCompleted === true
    && end.toolFailed === true && end.policyRejected === false && end.endReason === 'completed'
    && !Object.hasOwn(end, 'taskSucceeded') && !(run.events ?? []).some(e => e.t === 'error');
  return {...base, recoveryVerdictVersion: 2, finalOutputPass, completionPass, approvalPass,
    pass: run.case === 'recovery' && base.pass && finalOutputPass && completionPass && approvalPass};
}

/** Whole-report gate; raw reports remain immutable when audited after measurement. */
export function judgeRecoveryReport(report) {
  const runs = (report.runs ?? []).map(run => ({harness:run.harness,...judgeRecovery(run,Boolean(report.live))}));
  const forwarded = (report.runs ?? []).flatMap(r => r.requests ?? []).filter(r => r.forwarded)
    .map(r => Date.parse(r.forwardedAt));
  const gaps = forwarded.slice(1).map((at,i) => at - forwarded[i]);
  const minimumObservedIntervalMs = gaps.length ? Math.min(...gaps) : null;
  const pacingPass = !report.live || (forwarded.length > 0 && forwarded.every(Number.isFinite)
    && gaps.every(gap => gap >= 6000));
  const budgetPass = forwarded.length <= 18 && report.externalModelCalls === forwarded.length;
  const parityPass = report.parity?.pass === true && report.parity.checks?.length === 3
    && report.parity.checks.every(check => check.first === true && (report.live || check.second === true));
  const executionPass = runs.length === 3 && new Set(runs.map(r => r.harness)).size === 3
    && ['elda','langgraph','pi'].every(name => runs.some(r => r.harness === name && r.pass));
  return {version:2,runs,executionPass,parityPass,pacingPass,budgetPass,minimumObservedIntervalMs,
    sourceStable:report.sourceStable === true,
    protocolPass:executionPass && parityPass && pacingPass && budgetPass && report.sourceStable === true};
}
