import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './summarize.mjs';
test('partial and length outcomes cannot become semantic or execution passes', () => {
  const result = summarize({ live: true, plan: { maxCalls: 24 }, executionCompleted: false,
    calls: [{ variant: 'context', status: 'response', finishReason: 'length', reply: '', usage: { input: 9, output: 10 } },
      { variant: 'system', status: 'error' }], sessions: [{ events: [{ t: 'turn_end', data: { ok: false } }] }] });
  assert.equal(result.notAttempted, 22); assert.equal(result.groups.context.nonemptyStop, 0);
  assert.equal(result.usageComplete, false); assert.equal(result.semanticPassRate, null);
  assert.equal(result.fixtureErrorsObservable, false); assert.equal(result.fixtureErrors, null); assert.equal(result.executorFailed, 1);
});
