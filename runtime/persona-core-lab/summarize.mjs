import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarize(report) {
  const attempts = report.calls ?? [];
  const turnEnds = (report.sessions ?? []).flatMap(s => (s.events ?? []).filter(e => e.t === 'turn_end'));
  const fixtureErrorsObservable = !!report.sessions?.length && report.sessions.every(s => Array.isArray(s.handlerErrors));
  const groups = {};
  for (const c of attempts) {
    const g = groups[c.variant] ??= { attempts: 0, responses: 0, nonemptyStop: 0, errors: 0, input: 0, output: 0, usageKnown: 0 };
    g.attempts++;
    if (c.status === 'response') g.responses++;
    if (c.status === 'error') g.errors++;
    if (c.status === 'response' && c.finishReason === 'stop' && c.reply?.trim()) g.nonemptyStop++;
    if (c.usage) { g.usageKnown++; g.input += c.usage.input; g.output += c.usage.output; }
  }
  return { live: report.live, plannedCalls: report.plan.maxCalls, attempts: attempts.length,
    notAttempted: report.plan.maxCalls - attempts.length, groups,
    executorTurns: turnEnds.length, executorOk: turnEnds.filter(e => e.data.ok).length,
    executorFailed: turnEnds.filter(e => !e.data.ok).length,
    fixtureErrors: fixtureErrorsObservable ? report.sessions.reduce((n,s) => n + s.handlerErrors.length, 0) : null,
    fixtureErrorsObservable,
    usageComplete: attempts.every(c => !!c.usage),
    executionCompleted: report.executionCompleted,
    semanticPassRate: null,
    note: 'Counts describe execution only. Original pilot did not expose fixture exceptions; do not infer zero from absent fields. Synthetic and live must remain separate.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(summarize(JSON.parse(readFileSync(process.argv[2]))), null, 2));
}
