import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { evaluateV10, NUMERIC_ACCEPTANCE_V10 } from './acceptance-v10.mjs';
import { validateMemory } from '../pi/store.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const plan = JSON.parse(readFileSync(join(here, 'eval-plan-slim.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';
const PARTS = ['identity', 'acknowledgement', 'answer', 'next_step'];

function fixture() {
  const source = { schemaVersion: 1, model: 'clova:HCX-007', framework: 'pi', synthetic: false,
    plan: structuredClone(plan), executionProfiles: structuredClone(plan.executionProfiles),
    callLimit: 32, modelRequests: 32, responses: 32, executionCompleted: true,
    summary: { attemptedPrompts: 32, delivered: 32, errors: 0, blocked: 0, repairs: 0 },
    knownUsage: { input: 2880, output: 1440, cacheRead: 0, cacheWrite: 0 }, usageComplete: true, cost: null, groups: [] };
  for (const persona of plan.personas) for (const variant of plan.executionOrder[persona.key]) {
    const profile = plan.executionProfiles[variant], candidate = variant === 'structured';
    const group = { personaKey: persona.key, variant, ...profile, completed: true,
      nativeGeneration: { maxCompletionTokens: 2048, temperature: 0, thinking: { effort: 'none' } }, steps: [] };
    for (const step of plan.steps.filter(step => step.op === 'prompt')) {
      const parts = { identity: persona.persona.name, acknowledgement: '', answer: 'Synthetic answer', next_step: '' };
      const metadata = candidate ? {} : { self_name: persona.persona.name, speaking_style: persona.key === 'calm' ? '해요체' : '반말',
        can_web_search: false, can_schedule_notifications: false, can_attend_in_person: false, approved_facts: [], uncertainties: [], next_action: '' };
      const native = { ...metadata, reply: parts }, raw = JSON.stringify(native), text = `${parts.identity}\n\n${parts.answer}`;
      const replySchema = { type: 'object', properties: Object.fromEntries(PARTS.map(key => [key, { type: 'string' }])), required: [...PARTS] };
      const schema = { type: 'object', properties: { ...Object.fromEntries(Object.keys(metadata).map(key => [key, {}])), reply: replySchema }, required: Object.keys(native) };
      const usage = { input: candidate ? 80 : 100, output: candidate ? 40 : 50, cacheRead: 0, cacheWrite: 0 };
      group.steps.push({ scenarioId: step.id, prompt: step.text, scoredAxes: [...step.scoredAxes],
        rawDraftContent: raw, structuredMetadata: metadata, rendering: { parts, separator: '\n\n' },
        draftText: text, deliveredText: text, deliveryStatus: 'delivered', repairText: null, errors: [],
        turnEnd: { ...profile, synthetic: false, providerTransport: 'remote', ok: true, endReason: 'completed', finishReason: 'stop',
          turns: 1, correctionAttempts: 0, correctionModelCalls: 0, toolCalls: 0, providerCallAttempts: 1, externalModelCalls: 1,
          modelResponses: 1, usage: structuredClone(usage), usageComplete: true },
        apiAttemptLog: [{ context: { ...profile, phase: 'initial', synthetic: false, providerTransport: 'remote', toolNames: [], responseFormat: { type: 'json', schema } },
          response: { model: profile.model, synthetic: false, providerTransport: 'remote', ok: true, finishReason: 'stop', content: raw, usage: structuredClone(usage) } }],
      });
    }
    source.groups.push(group);
  }
  const summary = reviewer => {
    const pairedAxes = {}, variants = { baseline: { axes: {}, criticalFailures: 0 }, structured: { axes: {}, criticalFailures: 0 } };
    for (const [axis, pairs] of Object.entries(plan.rubric.expectedDenominatorsPerVariant)) {
      pairedAxes[axis] = { pairs, baselineSufficient: pairs, candidateSufficient: pairs, improved: 0, unchanged: pairs, worsened: 0 };
      for (const variant of ['baseline', 'structured']) variants[variant].axes[axis] = { eligible: pairs, sufficient: pairs, partial: 0, failed: 0, unscorable: 0 };
    }
    return { schemaVersion: 1, candidate: 'structured', reviewSha256: hash(reviewer), matchedValidPairs: 16,
      variants, pairedAxes, compiledGate: { numericGateMet: false } };
  };
  return { source, summaries: [summary('independent-one'), summary('independent-two')] };
}
function inputs(value = fixture()) {
  const sourceSha256 = hash(encode(value.source));
  const summaries = value.summaries.map(summary => ({ ...summary, sourceSha256 }));
  return { source: value.source, sourceSha256, summaries, summarySha256s: summaries.map(summary => hash(encode(summary))) };
}
function axis(summary, name, changes) {
  Object.assign(summary.pairedAxes[name], changes);
  const p = summary.pairedAxes[name];
  summary.variants.baseline.axes[name].sufficient = p.baselineSufficient;
  summary.variants.structured.axes[name].sufficient = p.candidateSufficient;
}
function usage(value, candidateInput, candidateOutput) {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const g of value.source.groups) for (const row of g.steps) {
    const u = { input: g.variant === 'structured' ? candidateInput : 100, output: g.variant === 'structured' ? candidateOutput : 50, cacheRead: 0, cacheWrite: 0 };
    row.turnEnd.usage = structuredClone(u); row.apiAttemptLog[0].response.usage = structuredClone(u);
    for (const key of Object.keys(sum)) sum[key] += u[key];
  }
  value.source.knownUsage = sum;
}
const candidateRow = value => value.source.groups.find(g => g.variant === 'structured').steps[0];

test('prospective confirmation fixes two topics, separate corrections, 32 calls and every denominator', () => {
  assert.deepEqual(plan.numericAcceptance, NUMERIC_ACCEPTANCE_V10);
  assert.equal(plan.evaluationStage, 'confirmation');
  assert.deepEqual(plan.personas.map(p => p.persona.name), ['은솔', '해온']);
  assert.equal(plan.steps.filter(s => s.op === 'prompt').length, 8);
  assert.equal(plan.steps.filter(s => s.op === 'restart').length, 2);
  const memories = plan.steps.filter(s => s.op === 'remember').map(s => validateMemory(s.memory));
  assert.equal(memories.length, 4); assert.equal(new Set(memories.map(m => m.slot)).size, 2);
  assert.equal(memories[0].slot, memories[1].slot); assert.equal(memories[2].slot, memories[3].slot);
  assert.notEqual(memories[0].value, memories[1].value); assert.notEqual(memories[2].value, memories[3].value);
  for (const [name, denominator] of Object.entries(plan.rubric.expectedDenominatorsPerVariant)) assert.equal(2 * plan.steps.filter(s => s.scoredAxes?.includes(name)).length, denominator);
});

test('exactly 20 percent input AND output reduction passes efficiency only at a quality ceiling', () => {
  const value = inputs(), original = structuredClone(value), result = evaluateV10(value);
  assert.equal(result.overallPass, true); assert.equal(result.disposition, 'efficiency_gain_only');
  assert.equal(result.qualityGain, false); assert.equal(result.efficiencyGain, true);
  assert.equal(result.accounting.tokenReductions.input.reductionPercent, 20);
  assert.equal(result.accounting.tokenReductions.output.reductionPercent, 20);
  assert.equal(value.summaries[0].compiledGate.numericGateMet, false);
  assert.deepEqual(value, original);
});

test('both token reductions are required and the threshold cannot be rounded up', () => {
  for (const [input, output] of [[81, 40], [80, 41], [100, 1], [1, 50]]) {
    const value = fixture(); usage(value, input, output);
    const result = evaluateV10(inputs(value));
    assert.equal(result.overallPass, false); assert.equal(result.disposition, 'progress_unmet');
  }
});

test('quality gain is an independent route and both routes can pass together', () => {
  const value = fixture();
  for (const review of value.summaries) axis(review, 'personality', { baselineSufficient: 15, candidateSufficient: 16, improved: 1, unchanged: 15 });
  assert.equal(evaluateV10(inputs(value)).disposition, 'quality_and_efficiency_gain');
  usage(value, 100, 50);
  const result = evaluateV10(inputs(value));
  assert.equal(result.disposition, 'quality_gain'); assert.equal(result.qualityGain, true); assert.equal(result.efficiencyGain, false);
});

test('every axis including personality and help forbids offsetting paired regression', () => {
  for (const name of NUMERIC_ACCEPTANCE_V10.protectedAxes) {
    const value = fixture(), p = value.summaries[0].pairedAxes[name];
    axis(value.summaries[0], name, { baselineSufficient: p.pairs - 1, candidateSufficient: p.pairs - 1, improved: 1, worsened: 1, unchanged: p.pairs - 2 });
    const result = evaluateV10(inputs(value));
    assert.equal(result.overallPass, false); assert.equal(result.disposition, 'quality_protection_failed');
  }
});

test('one review cannot substitute for two protected reviews, and critical increases fail', () => {
  const value = fixture(); value.summaries[1].variants.structured.criticalFailures = 1;
  assert.equal(evaluateV10(inputs(value)).overallPass, false);
  const quality = fixture(); usage(quality, 100, 50);
  axis(quality.summaries[0], 'register', { baselineSufficient: 15, candidateSufficient: 16, improved: 1, unchanged: 15 });
  assert.equal(evaluateV10(inputs(quality)).overallPass, false);
});

test('incomplete or unreconciled actual usage cannot create efficiency progress', () => {
  for (const change of [
    v => { v.source.usageComplete = false; },
    v => { candidateRow(v).turnEnd.usageComplete = false; },
    v => { delete candidateRow(v).apiAttemptLog[0].response.usage; },
    v => { candidateRow(v).turnEnd.usage.output++; },
    v => { v.source.knownUsage.input++; },
    v => { candidateRow(v).apiAttemptLog[0].response.usage.input = -1; },
  ]) {
    const value = fixture(); change(value); const result = evaluateV10(inputs(value));
    assert.equal(result.efficiencyGain, false); assert.equal(result.overallPass, false);
    assert.equal(result.accounting.cost, null); assert.equal(result.accounting.costBasis, 'unknown');
  }
});

test('wrong source profile, stage, request model or weakened numeric gate is rejected', () => {
  for (const change of [
    v => { v.source.plan.evaluationStage = 'development'; },
    v => { v.source.plan.model = 'clova:HCX-005'; },
    v => { v.source.executionProfiles.structured.policy = 'enacted-v9'; },
    v => { candidateRow(v).apiAttemptLog[0].context.model = 'clova:HCX-005'; },
    v => { v.source.plan.numericAcceptance.minimumInputTokenReductionPercent = 19; },
    v => { v.source.groups[0].nativeGeneration.thinking.effort = 'low'; },
    v => { v.source.plan.steps.find(s => s.op === 'prompt').scoredAxes = ['register', 'personality', 'capabilityHonesty', 'empathy', 'practicalHelp']; v.source.plan.rubric.expectedDenominatorsPerVariant.name = 14; },
  ]) { const value = fixture(); change(value); assert.throws(() => evaluateV10(inputs(value))); }
});

test('raw output, schema and exact visible rendering must really use the reply-only contract', () => {
  for (const change of [
    row => { row.rawDraftContent = JSON.stringify({ ...JSON.parse(row.rawDraftContent), hidden_plan: 'x' }); },
    row => { row.structuredMetadata = { self_name: 'fabricated' }; },
    row => { row.apiAttemptLog[0].context.responseFormat.schema.properties.hidden_plan = { type: 'string' }; },
    row => { row.apiAttemptLog[0].context.responseFormat.schema.properties.reply.properties.answer.enum = ['Synthetic answer']; },
    row => { row.rendering.parts.answer = 'replaced'; },
    row => { row.rendering.separator = ' '; },
    row => { row.apiAttemptLog[0].response.content = 'other raw output'; },
  ]) { const value = fixture(); change(candidateRow(value)); assert.throws(() => evaluateV10(inputs(value))); }
});

test('missing delivery, extra calls, repairs, truncation or changed display fail coverage', () => {
  for (const change of [
    v => { candidateRow(v).deliveredText = null; candidateRow(v).deliveryStatus = 'blocked'; },
    v => { v.source.executionCompleted = false; },
    v => { v.source.modelRequests = 33; },
    v => { candidateRow(v).turnEnd.externalModelCalls = 2; },
    v => { candidateRow(v).turnEnd.correctionAttempts = 1; },
    v => { candidateRow(v).repairText = 'repaired'; },
    v => { candidateRow(v).turnEnd.finishReason = 'length'; },
    v => { candidateRow(v).deliveredText = 'different'; },
  ]) {
    const value = fixture(); change(value); const result = evaluateV10(inputs(value));
    assert.equal(result.overallPass, false); assert.equal(result.disposition, 'incomplete');
  }
});

test('source hash, duplicate review/summary and missing review cannot be accepted', () => {
  const mismatch = inputs(); mismatch.summaries[0].sourceSha256 = hash('wrong'); assert.throws(() => evaluateV10(mismatch));
  const sameSummary = inputs(); sameSummary.summarySha256s[1] = sameSummary.summarySha256s[0]; assert.throws(() => evaluateV10(sameSummary));
  const sameReview = inputs(); sameReview.summaries[1].reviewSha256 = sameReview.summaries[0].reviewSha256; assert.throws(() => evaluateV10(sameReview));
  const missing = inputs(); missing.summaries.pop(); assert.throws(() => evaluateV10(missing));
});

test('CLI binds file hashes and writes an exclusive immutable acceptance artifact', () => {
  const parent = join(root, '.local', 'acceptance-v10-tests'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-'));
  try {
    const value = inputs(), paths = ['source.json', 'one.json', 'two.json', 'acceptance.json'].map(name => join(dir, name));
    [value.source, ...value.summaries].forEach((item, i) => writeFileSync(paths[i], encode(item), { mode: 0o600 }));
    const run = () => spawnSync(process.execPath, [join(here, 'acceptance-v10.mjs'), ...paths], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const original = readFileSync(paths[3], 'utf8'); assert.equal(JSON.parse(original).disposition, 'efficiency_gain_only');
    const second = run(); assert.notEqual(second.status, 0); assert.match(second.stderr, /Preserve prior acceptance/);
    assert.equal(readFileSync(paths[3], 'utf8'), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
