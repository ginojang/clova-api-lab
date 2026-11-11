import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { evaluateV9, NUMERIC_ACCEPTANCE_V9 } from './acceptance-v9.mjs';
import { validateMemory } from '../pi/store.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const plan = JSON.parse(readFileSync(join(here, 'eval-plan-enacted.json'), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';

function fixture() {
  const source = {
    schemaVersion: 1, model: 'clova:HCX-007', framework: 'pi', synthetic: false,
    plan: structuredClone(plan), executionProfiles: structuredClone(plan.executionProfiles),
    callLimit: 16, modelRequests: 16, responses: 16, executionCompleted: true,
    summary: { attemptedPrompts: 16, delivered: 16, errors: 0, blocked: 0, repairs: 0 },
    knownUsage: { input: 160, output: 80, cacheRead: 0, cacheWrite: 0 }, usageComplete: true, cost: null,
    groups: [],
  };
  for (const persona of plan.personas) for (const variant of plan.executionOrder[persona.key]) {
    const profile = plan.executionProfiles[variant];
    const group = { personaKey: persona.key, variant, ...profile, completed: true,
      nativeGeneration: { maxCompletionTokens: 2048, temperature: 0, thinking: { effort: 'none' } }, steps: [] };
    for (const step of plan.steps.filter(step => step.op === 'prompt')) {
      group.steps.push({ scenarioId: step.id, prompt: step.text, scoredAxes: [...step.scoredAxes],
        draftText: 'Synthetic displayed response', deliveredText: 'Synthetic displayed response', deliveryStatus: 'delivered', repairText: null, errors: [],
        turnEnd: { ...profile, synthetic: false, providerTransport: 'remote', ok: true, endReason: 'completed', finishReason: 'stop',
          turns: 1, correctionAttempts: 0, correctionModelCalls: 0, toolCalls: 0, providerCallAttempts: 1, externalModelCalls: 1, modelResponses: 1 },
        apiAttemptLog: [{ context: { ...profile, phase: 'initial', synthetic: false, providerTransport: 'remote', toolNames: [] },
          response: { model: profile.model, synthetic: false, providerTransport: 'remote', ok: true, finishReason: 'stop' } }],
      });
    }
    source.groups.push(group);
  }
  const summary = review => {
    const pairedAxes = {}, variants = { baseline: { axes: {}, criticalFailures: 0 }, structured: { axes: {}, criticalFailures: 0 } };
    for (const [axis, pairs] of Object.entries(plan.rubric.expectedDenominatorsPerVariant)) {
      const primary = ['personality', 'practicalHelp'].includes(axis);
      const baselineSufficient = primary ? pairs - 2 : pairs, candidateSufficient = primary ? pairs - 1 : pairs;
      pairedAxes[axis] = { pairs, baselineSufficient, candidateSufficient, improved: Number(primary), unchanged: pairs - Number(primary), worsened: 0 };
      for (const variant of ['baseline', 'structured']) {
        const sufficient = variant === 'baseline' ? baselineSufficient : candidateSufficient;
        variants[variant].axes[axis] = { eligible: pairs, sufficient, partial: pairs - sufficient, failed: 0, unscorable: 0 };
      }
    }
    return { schemaVersion: 1, candidate: 'structured', reviewSha256: sha(review), matchedValidPairs: 8,
      variants, pairedAxes, compiledGate: { registerGain: 0, numericGateMet: false } };
  };
  return { source, summaries: [summary('independent-review-one'), summary('independent-review-two')] };
}
function inputs(value = fixture()) {
  const sourceSha256 = sha(encode(value.source));
  const summaries = value.summaries.map(summary => ({ ...summary, sourceSha256 }));
  return { source: value.source, sourceSha256, summaries, summarySha256s: summaries.map(summary => sha(encode(summary))) };
}
function setAxis(summary, axis, patch) {
  Object.assign(summary.pairedAxes[axis], patch);
  const p = summary.pairedAxes[axis];
  summary.variants.baseline.axes[axis].sufficient = p.baselineSufficient;
  summary.variants.structured.axes[axis].sufficient = p.candidateSufficient;
}

test('new plan fixes same-model profiles, budgets, denominators and valid correction memory before outputs', () => {
  assert.deepEqual(plan.numericAcceptance, NUMERIC_ACCEPTANCE_V9);
  assert.deepEqual(plan.personas.map(persona => persona.persona.name), ['해담', '온결']);
  const prompts = plan.steps.filter(step => step.op === 'prompt');
  assert.equal(prompts.length, 4);
  for (const [axis, denominator] of Object.entries(plan.rubric.expectedDenominatorsPerVariant)) assert.equal(prompts.filter(step => step.scoredAxes.includes(axis)).length * 2, denominator);
  const memories = plan.steps.filter(step => step.op === 'remember').map(step => validateMemory(step.memory));
  assert.equal(memories.length, 2);
  assert.equal(memories[0].thing, memories[1].thing);
  assert.notEqual(memories[0].value, memories[1].value);
  assert.ok(memories.every(memory => memory.value.includes('2028년')));
  assert.equal(plan.steps.filter(step => step.op === 'restart').length, 1);
  assert.deepEqual(plan.executionOrder.calm, ['baseline', 'structured']);
  assert.deepEqual(plan.executionOrder.playful, ['structured', 'baseline']);
});

test('both new behavioral gates can pass at the register ceiling while legacy +2 gate stays false', () => {
  const value = inputs(), original = structuredClone(value);
  const result = evaluateV9(value);
  assert.equal(result.overallPass, true);
  assert.equal(result.disposition, 'passed_prospective_pilot_gate');
  assert.equal(result.reviewDecisions[0].protectedAxes.register.sufficientGain, 0);
  assert.equal(result.reviewDecisions[0].primary.personality.sufficientGain, 1);
  assert.equal(result.reviewDecisions[0].primary.practicalHelp.sufficientGain, 1);
  assert.equal(value.summaries[0].compiledGate.numericGateMet, false);
  assert.deepEqual(value, original);
});

test('incorrect model/policy or weakened acceptance profile is rejected before scoring', () => {
  for (const change of [
    value => { value.source.plan.model = 'clova:HCX-005'; },
    value => { value.source.executionProfiles.baseline.policy = 'baseline'; },
    value => { value.source.groups[0].policy = 'enacted-v9'; },
    value => { value.source.groups[0].steps[0].apiAttemptLog[0].context.model = 'clova:HCX-005'; },
    value => { value.source.plan.numericAcceptance.primarySufficientGains.personality = 0; },
    value => { value.source.groups[0].nativeGeneration.thinking.effort = 'low'; },
  ]) {
    const value = fixture(); change(value); assert.throws(() => evaluateV9(inputs(value)));
  }
});

test('missing delivery, incomplete execution, extra calls and repairs cannot pass', () => {
  for (const change of [
    value => { value.source.groups[0].steps[0].deliveredText = null; value.source.groups[0].steps[0].deliveryStatus = 'blocked'; },
    value => { value.source.executionCompleted = false; },
    value => { value.source.modelRequests = 17; },
    value => { value.source.groups[0].steps[0].turnEnd.externalModelCalls = 2; },
    value => { value.source.groups[0].steps[0].turnEnd.correctionAttempts = 1; },
    value => { value.source.groups[0].steps[0].repairText = 'replacement'; },
    value => { value.source.groups[0].steps[0].turnEnd.finishReason = 'length'; },
    value => { value.source.groups[0].steps[0].deliveredText = 'changed by renderer'; },
  ]) {
    const value = fixture(); change(value);
    const result = evaluateV9(inputs(value));
    assert.equal(result.overallPass, false); assert.equal(result.disposition, 'incomplete');
  }
});

test('one successful full review cannot substitute for two independently passing reviews', () => {
  const value = fixture();
  setAxis(value.summaries[1], 'practicalHelp', { candidateSufficient: 2, improved: 0, unchanged: 4 });
  const result = evaluateV9(inputs(value));
  assert.deepEqual(result.reviewDecisions.map(review => review.pass), [true, false]);
  assert.equal(result.overallPass, false); assert.equal(result.disposition, 'mixed_reviews');
});

test('paired protected regressions fail even when sufficient-count losses are offset', () => {
  for (const axis of NUMERIC_ACCEPTANCE_V9.protectedAxes) {
    const value = fixture(), p = value.summaries[0].pairedAxes[axis];
    setAxis(value.summaries[0], axis, { baselineSufficient: p.pairs - 1, candidateSufficient: p.pairs - 1, improved: 1, worsened: 1, unchanged: p.pairs - 2 });
    const result = evaluateV9(inputs(value));
    assert.equal(result.reviewDecisions[0].protectedAxes[axis].sufficientGain, 0);
    assert.equal(result.reviewDecisions[0].protectedAxes[axis].pass, false);
    assert.equal(result.overallPass, false);
  }
});

test('primary-axis regressions are disclosed without adding a new zero-regression requirement', () => {
  const value = fixture();
  for (const summary of value.summaries) for (const axis of ['personality', 'practicalHelp']) {
    const p = summary.pairedAxes[axis]; setAxis(summary, axis, { improved: 2, worsened: 1, unchanged: p.pairs - 3 });
  }
  const result = evaluateV9(inputs(value));
  assert.equal(result.overallPass, true);
  assert.deepEqual(result.reviewDecisions[0].primaryPairedRegressions, { personality: 1, practicalHelp: 1 });
});

test('primary ceilings remain unmet and critical failures cannot increase', () => {
  const value = fixture();
  for (const summary of value.summaries) for (const axis of ['personality', 'practicalHelp']) {
    const p = summary.pairedAxes[axis]; setAxis(summary, axis, { baselineSufficient: p.pairs, candidateSufficient: p.pairs, improved: 0, worsened: 0, unchanged: p.pairs });
  }
  const result = evaluateV9(inputs(value));
  assert.equal(result.overallPass, false); assert.equal(result.disposition, 'gate_unmet');
  assert.equal(result.reviewDecisions[0].primary.personality.ceiling, true);
  const critical = fixture(); critical.summaries[0].variants.structured.criticalFailures = 1;
  assert.equal(evaluateV9(inputs(critical)).overallPass, false);
});

test('source mismatch, reused summary and reused raw-review hash are rejected', () => {
  const value = inputs();
  value.summaries[0].sourceSha256 = sha('wrong source');
  assert.throws(() => evaluateV9(value), /source SHA-256 differs/);
  const duplicateSummary = inputs(); duplicateSummary.summarySha256s[1] = duplicateSummary.summarySha256s[0];
  assert.throws(() => evaluateV9(duplicateSummary), /same summary/);
  const duplicateReview = fixture(); duplicateReview.summaries[1].reviewSha256 = duplicateReview.summaries[0].reviewSha256;
  // Distinct envelope hashes cannot disguise reuse of one review.
  const duplicated = inputs(duplicateReview); duplicated.summarySha256s[1] = sha('different summary envelope');
  assert.throws(() => evaluateV9(duplicated), /same review/);
  const one = inputs(); one.summaries.pop(); assert.throws(() => evaluateV9(one), /Two full review/);
});

test('unknown monetary cost and incomplete usage are preserved, never silently reported as zero cost', () => {
  const value = fixture(); value.source.usageComplete = false;
  const result = evaluateV9(inputs(value));
  assert.equal(result.overallPass, true);
  assert.equal(result.accounting.cost, null); assert.equal(result.accounting.costBasis, 'unknown');
  assert.equal(result.accounting.usageComplete, false); assert.equal(result.accounting.qualityGateUsesCost, false);
  assert.match(result.trustBoundary, /does not independently revalidate/);
});

test('CLI binds real file hashes and refuses to overwrite an acceptance artifact', () => {
  const parent = join(root, '.local', 'acceptance-v9-tests'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-'));
  try {
    const value = inputs(), files = ['source.json', 'summary-one.json', 'summary-two.json', 'acceptance.json'].map(name => join(dir, name));
    [value.source, ...value.summaries].forEach((item, index) => writeFileSync(files[index], encode(item), { mode: 0o600 }));
    const run = () => spawnSync(process.execPath, [join(here, 'acceptance-v9.mjs'), ...files], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const raw = readFileSync(files[3], 'utf8'); assert.equal(JSON.parse(raw).overallPass, true);
    const second = run(); assert.notEqual(second.status, 0); assert.match(second.stderr, /Preserve prior acceptance/);
    assert.equal(readFileSync(files[3], 'utf8'), raw);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
