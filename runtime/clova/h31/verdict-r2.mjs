/** Prospective second-run adjudicator. Never apply this to relabel first-run results.
 * Required effects stay exact; only repeated final reads of the expected file are allowed.
 * Raw runtime flags are kept separately from this independent artifact/effect verdict.
 */
const same = (a, b) => {
  const normalize = x => Array.isArray(x) ? x.map(normalize) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, normalize(x[k])])) : x;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
};

export function judgeRun(run, live) {
  const events = run.events ?? [];
  const requests = run.requests ?? [];
  const results = events.filter(e => e.t === 'tool_result').map(e => e.data);
  const calls = requests.flatMap(r => r.response?.result?.message?.toolCalls ?? []);
  // One result per model call, in original call order. No invented, omitted or duplicate results.
  const callResultPairsPass = calls.length === results.length && calls.every((call, i) =>
    typeof call.id === 'string' && call.id.length > 0 && results[i]?.callId === call.id
      && results[i]?.tool === call.function?.name);
  const batchObserved = requests.some(r => (r.response?.result?.message?.toolCalls?.length ?? 0) >= 2);
  const isCall = (i, name, path, text) => calls[i]?.function?.name === name
    && (path === undefined || calls[i].function.arguments?.path === path)
    && (text === undefined || calls[i].function.arguments?.text === text);
  const succeeded = i => results[i]?.ok === true && results[i]?.sideEffect === 'completed';
  const finalReads = (start, path) => calls.length > start && calls.slice(start).every((_, j) =>
    isCall(start + j, 'artifact_read', path) && succeeded(start + j));
  let requiredToolsPass = false;
  let noRequestsAfterDenial = null;
  if (run.case === 'lifecycle') {
    requiredToolsPass = isCall(0, 'artifact_write', 'a.txt', 'ALPHA') && succeeded(0)
      && isCall(1, 'artifact_write', 'a.txt', 'BETA') && succeeded(1)
      && isCall(2, 'artifact_undo') && succeeded(2) && finalReads(3, 'a.txt');
  } else if (run.case === 'recovery') {
    requiredToolsPass = isCall(0, 'artifact_read', 'recovered.txt') && results[0]?.ok === false
      && results[0]?.sideEffect === 'completed'
      && isCall(1, 'artifact_write', 'recovered.txt', 'RECOVERED') && succeeded(1)
      && finalReads(2, 'recovered.txt');
  } else if (run.case === 'allow_batch') {
    const expected = {'b.txt': 'BRAVO', 'c.txt': 'CHARLIE'};
    requiredToolsPass = calls.length === 2 && calls.every((c, i) => succeeded(i)
      && c.function?.name === 'artifact_write' && Object.hasOwn(expected, c.function.arguments?.path)
      && c.function.arguments.text === expected[c.function.arguments.path])
      && new Set(calls.map(c => c.function.arguments.path)).size === 2;
  } else if (run.case === 'deny_batch') {
    const approvals = events.filter(e => e.t === 'approval');
    const denialTime = Date.parse(approvals[0]?.ts);
    // Runner answers this sole approval false immediately. Strict < avoids claiming
    // an ordering proof when wall-clock timestamps have equal millisecond precision.
    noRequestsAfterDenial = approvals.length === 1 && Number.isFinite(denialTime)
      && requests.length > 0 && requests.every(r => Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) < denialTime);
    const end = run.turns?.[0]?.turnEnd;
    requiredToolsPass = calls.length > 0 && calls.every(c => c.function?.name === 'artifact_write')
      && results.every(r => r.ok === false && r.sideEffect === 'not_started')
      && end?.policyRejected === true && end?.endReason === 'denied' && end?.ok === false
      && noRequestsAfterDenial;
  }
  requiredToolsPass = Boolean(requiredToolsPass && callResultPairsPass);
  const expectedTurns = run.case === 'lifecycle' ? 3 : ['recovery', 'deny_batch', 'allow_batch'].includes(run.case) ? 1 : 0;
  const artifactPass = expectedTurns > 0 && run.turns?.length === expectedTurns
    && run.turns.every(t => t.artifactActual && t.artifactExpected && same(t.artifactActual, t.artifactExpected));
  const processPass = run.exitCode === 0 && run.processGroupClean === true && !run.forcedKill
    && Array.isArray(run.errors) && run.errors.length === 0 && Array.isArray(run.invalidLines) && run.invalidLines.length === 0;
  const batchRequired = !live && ['deny_batch', 'allow_batch'].includes(run.case);
  return {verdictVersion: 2, artifactPass: Boolean(artifactPass), processPass, callResultPairsPass,
    requiredToolsPass, batchObserved, noRequestsAfterDenial,
    h56: batchObserved && ['deny_batch', 'allow_batch'].includes(run.case) ? 'observed' : 'not_assessed',
    pass: Boolean(artifactPass && processPass && requiredToolsPass && (!batchRequired || batchObserved))};
}
