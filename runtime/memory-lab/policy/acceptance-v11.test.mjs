import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { evaluateV11, evaluateEvidenceV11, NUMERIC_ACCEPTANCE_V11 } from './acceptance-v11.mjs';
import { validateMemory } from '../pi/store.mjs';
import { clean } from '../../clova/common.ts';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const plan = JSON.parse(readFileSync(join(here, 'eval-plan-anchored.json'), 'utf8'));
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
      const metadata = {};
      const native = { ...metadata, reply: parts }, raw = JSON.stringify(native), text = `${parts.identity}\n\n${parts.answer}`;
      const replySchema = { type: 'object', properties: Object.fromEntries(PARTS.map(key => [key, { type: 'string' }])), required: [...PARTS] };
      const schema = { type: 'object', properties: { ...Object.fromEntries(Object.keys(metadata).map(key => [key, {}])), reply: replySchema }, required: Object.keys(native) };
      const usage = { input: candidate ? 80 : 100, output: candidate ? 40 : 50, cacheRead: 0, cacheWrite: 0 };
      group.steps.push({ scenarioId: step.id, prompt: step.text, scoredAxes: [...step.scoredAxes], activeMemorySnapshot: [],
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

function targetGain(value, axisName = 'name') {
  for (const review of value.summaries) {
    const p = review.pairedAxes[axisName];
    axis(review, axisName, { baselineSufficient: p.pairs - 1, candidateSufficient: p.pairs, improved: 1, unchanged: p.pairs - 1 });
    review.variants.baseline.axes[axisName].partial = 1;
  }
  return value;
}
const raw = value => Buffer.from(encode(value));
function evidenceFixture() {
  const value = targetGain(fixture()), planRaw = readFileSync(join(here, 'eval-plan-anchored.json'));
  const gateRaw = readFileSync(join(here, 'acceptance-v11.mjs'));
  value.source.rawArtifacts = '.local/policy-live/100-200';
  value.source.planSha256 = hash(planRaw);
  value.source.sourceSnapshots = Object.fromEntries([
    ['policy/eval-plan-anchored.json', planRaw], ['policy/acceptance-v11.mjs', gateRaw],
  ].map(([name, bytes]) => [name, { sha256: hash(bytes), path: `${value.source.rawArtifacts}/source/${name}` }]));
  const sourcePath = 'runtime/memory-lab/results/synthetic-cycle3-source.json';
  const packet = { schemaVersion: 1, rubric: { scale: plan.rubric.scale, axes: plan.rubric.axes, criticalFailures: plan.rubric.criticalFailures }, items: [] };
  const mapping = { salt: 'unit-test-fixed-salt', source: sourcePath, sha256: hash(raw(value.source)), items: [] };
  for (const group of value.source.groups) for (const row of group.steps) {
    const key = `${group.personaKey}/${group.variant}/${row.scenarioId}/draft`, id = hash(mapping.salt + '\0' + key).slice(0, 14);
    packet.items.push({ id, persona: plan.personas.find(p => p.key === group.personaKey).persona,
      prompt: row.prompt, scoredAxes: row.scoredAxes, activeMemories: row.activeMemorySnapshot, text: row.draftText });
    mapping.items.push({ id, personaKey: group.personaKey, variant: group.variant, scenarioId: row.scenarioId, phase: 'draft', delivered: true });
  }
  const target = mapping.items.find(item => item.personaKey === 'calm' && item.variant === 'baseline').id;
  const reviewRaws = ['one', 'two'].map(reviewer => raw({ schemaVersion: 1, reviewer, packetSha256: hash(raw(packet)), items: packet.items.map(item => ({
    id: item.id, scores: Object.fromEntries(item.scoredAxes.map(axis => [axis, axis === 'name' && item.id === target ? 1 : 2])),
    evidence: Object.fromEntries(item.scoredAxes.map(axis => [axis, { quote: item.text, reason: `Synthetic fixture ${axis}` }])), criticalFailures: [],
  })) }));
  value.summaries.forEach((summary, i) => { summary.sourceSha256 = mapping.sha256; summary.reviewSha256 = hash(reviewRaws[i]); });
  return { sourceRaw: raw(value.source), frozenPlanRaw: planRaw, planSnapshotRaw: planRaw, gateSnapshotRaw: gateRaw,
    packetRaw: raw(packet), mappingRaw: raw(mapping), reviewRaws, summaryRaws: value.summaries.map(raw), sourcePath };
}
function mutateRaw(value, key, fn) { const json = JSON.parse(value[key]); fn(json); value[key] = raw(json); }

test('frozen plan targets identity/empathy with same-model reply-only conditions and fresh material', () => {
  assert.deepEqual(plan.numericAcceptance, NUMERIC_ACCEPTANCE_V11);
  assert.equal(plan.steps.filter(s => s.op === 'prompt').length, 8);
  assert.equal(plan.steps.filter(s => s.op === 'restart').length, 2);
  const memories = plan.steps.filter(s => s.op === 'remember').map(s => validateMemory(s.memory));
  assert.equal(memories.length, 4); assert.equal(new Set(memories.map(m => m.slot)).size, 2);
  assert.deepEqual(plan.personas.map(p => p.persona.name), ['민결', '라솔']);
  assert.deepEqual(NUMERIC_ACCEPTANCE_V11.qualityGainAxes, ['name', 'empathy']);
  assert.equal(NUMERIC_ACCEPTANCE_V11.maximumCandidateCriticalFailures, 0);
  for (const [axis, count] of Object.entries(plan.rubric.expectedDenominatorsPerVariant)) assert.equal(2 * plan.steps.filter(s => s.scoredAxes?.includes(axis)).length, count);
  const dev = JSON.parse(readFileSync(join(here, 'eval-plan-anchored-development.json')));
  assert.equal(dev.budget.draftCalls, 16); assert.equal(dev.steps.filter(s => s.op === 'prompt').length, 4);
  assert.equal(dev.evaluationStage, 'development'); assert.equal(Object.hasOwn(dev, 'numericAcceptance'), false);
});

test('efficiency or other quality gains cannot substitute for identity/empathy progress', () => {
  const value = fixture();
  assert.equal(evaluateV11(inputs(value)).disposition, 'target_progress_unmet');
  for (const name of ['register', 'personality', 'practicalHelp']) {
    const other = targetGain(fixture(), name), result = evaluateV11(inputs(other));
    assert.equal(result.qualityGain, false); assert.equal(result.overallPass, false);
  }
  const hugeSavings = fixture(); usage(hugeSavings, 1, 1);
  assert.equal(evaluateV11(inputs(hugeSavings)).overallPass, false);
});

test('both complete reviewers must see a target gain; their improving target may differ', () => {
  for (const axis of ['name', 'empathy']) {
    const result = evaluateV11(inputs(targetGain(fixture(), axis)));
    assert.equal(result.disposition, 'target_quality_gain'); assert.equal(result.overallPass, true);
    assert.equal(result.efficiencyCanSubstituteForQuality, false);
  }
  const one = fixture(); one.summaries[0] = targetGain(fixture()).summaries[0];
  assert.equal(evaluateV11(inputs(one)).overallPass, false);
  const different = targetGain(fixture()); different.summaries[1] = targetGain(fixture(), 'empathy').summaries[1];
  assert.equal(evaluateV11(inputs(different)).overallPass, true);
});

test('every protected axis forbids paired regressions even when net totals improve elsewhere', () => {
  for (const name of NUMERIC_ACCEPTANCE_V11.protectedAxes) {
    const value = targetGain(fixture()), p = value.summaries[0].pairedAxes[name];
    axis(value.summaries[0], name, { baselineSufficient: p.pairs - 1, candidateSufficient: p.pairs - 1, improved: 1, worsened: 1, unchanged: p.pairs - 2 });
    assert.equal(evaluateV11(inputs(value)).disposition, 'quality_protection_failed');
  }
});

test('zero candidate critical failures is required even if the baseline has as many or more', () => {
  for (const baselineCritical of [0, 1, 2]) {
    const value = targetGain(fixture());
    value.summaries[1].variants.baseline.criticalFailures = baselineCritical;
    value.summaries[1].variants.structured.criticalFailures = 1;
    assert.equal(evaluateV11(inputs(value)).overallPass, false);
  }
});

test('the raw model parts and both native reply-only schemas must match displayed wording', () => {
  for (const variant of ['baseline', 'structured']) for (const change of [
    row => { row.rawDraftContent = JSON.stringify({ ...JSON.parse(row.rawDraftContent), self_name: 'injected' }); },
    row => { row.structuredMetadata = { self_name: 'invented' }; },
    row => { row.apiAttemptLog[0].context.responseFormat.schema.properties.reply.properties.identity.const = 'fixed'; },
    row => { row.apiAttemptLog[0].context.responseFormat.schema.properties.reply.properties.answer.enum = ['fixed']; },
    row => { row.rendering.parts.answer = 'different'; },
    row => { row.apiAttemptLog[0].response.content = 'different'; },
  ]) {
    const value = targetGain(fixture()); change(value.source.groups.find(g => g.variant === variant).steps[0]);
    assert.throws(() => evaluateV11(inputs(value)));
  }
});

test('incomplete coverage, extra calls, repairs and truncation cannot pass', () => {
  for (const change of [
    v => { candidateRow(v).deliveredText = null; candidateRow(v).deliveryStatus = 'blocked'; },
    v => { v.source.modelRequests = 33; },
    v => { candidateRow(v).turnEnd.externalModelCalls = 2; },
    v => { candidateRow(v).turnEnd.correctionAttempts = 1; },
    v => { candidateRow(v).turnEnd.finishReason = 'length'; },
    v => { candidateRow(v).deliveredText = 'replaced'; },
    v => { v.source.executionCompleted = false; },
  ]) { const value = targetGain(fixture()); change(value); assert.equal(evaluateV11(inputs(value)).disposition, 'incomplete'); }
});

test('wrong plan/model/profile/thresholds and reused reviews are rejected', () => {
  for (const change of [
    v => { v.source.plan.evaluationStage = 'development'; },
    v => { v.source.plan.model = 'clova:HCX-005'; },
    v => { candidateRow(v).apiAttemptLog[0].context.policy = 'slim-v10'; },
    v => { v.source.plan.numericAcceptance.maximumCandidateCriticalFailures = 1; },
    v => { v.source.plan.numericAcceptance.qualityGainAxes.push('register'); },
    v => { v.source.groups[0].nativeGeneration.thinking.effort = 'low'; },
  ]) { const value = targetGain(fixture()); change(value); assert.throws(() => evaluateV11(inputs(value))); }
  const repeated = inputs(targetGain(fixture())); repeated.summaries[1].reviewSha256 = repeated.summaries[0].reviewSha256;
  assert.throws(() => evaluateV11(repeated));
});

test('unknown or unreconciled usage remains explicit without false monetary or efficiency conclusions', () => {
  const value = targetGain(fixture()); delete candidateRow(value).apiAttemptLog[0].response.usage;
  const result = evaluateV11(inputs(value)); assert.equal(result.overallPass, true);
  assert.equal(result.accounting.completeUsage, false); assert.equal(result.accounting.reconciledUsage, false);
  assert.equal(result.accounting.cost, null); assert.equal(result.accounting.efficiencyDescriptiveOnly, true);
});

test('full evidence wrapper binds frozen plan/gate bytes, packet rubric and every original review score', () => {
  const value = evidenceFixture(), before = JSON.stringify(value), result = evaluateEvidenceV11(value);
  assert.equal(result.overallPass, true); assert.equal(result.evidenceBinding.snapshotBytesVerified, true);
  assert.equal(result.evidenceBinding.rubricMatchesFrozenPlan, true);
  assert.match(result.trustBoundary, /independently revalidates/);
  assert.doesNotMatch(result.trustBoundary, /does not independently revalidate/);
  assert.deepEqual(result.evidenceBinding.reviews.map(r => [r.items, r.axisRatings]), [[32, 184], [32, 184]]);
  assert.equal(JSON.stringify(value), before);
});

test('snapshot drift, detached original plans, changed embedded plans and source links are rejected', () => {
  for (const change of [
    v => { v.planSnapshotRaw = Buffer.from('different'); },
    v => { v.gateSnapshotRaw = Buffer.from('different'); },
    v => { v.frozenPlanRaw = Buffer.from('{}'); },
    v => mutateRaw(v, 'sourceRaw', s => { s.plan.purpose += ' changed'; }),
    v => mutateRaw(v, 'mappingRaw', m => { m.sha256 = hash('other'); }),
    v => mutateRaw(v, 'mappingRaw', m => { m.source = 'other.json'; }),
    v => mutateRaw(v, 'sourceRaw', s => { s.sourceSnapshots['policy/eval-plan-anchored.json'].path = '../elsewhere'; }),
  ]) { const value = evidenceFixture(); change(value); assert.throws(() => evaluateEvidenceV11(value)); }
});

test('modified rubric or packet evidence cannot be accepted even with a recomputed packet digest', () => {
  for (const change of [
    p => { p.rubric.axes.empathy = 'Always sufficient'; },
    p => { p.items[0].text += ' invented'; },
    p => { p.items[0].prompt = 'easier'; },
    p => { p.items[0].activeMemories = ['fabricated']; },
    p => { p.items.push(p.items[0]); },
  ]) {
    const value = evidenceFixture(); mutateRaw(value, 'packetRaw', change);
    value.reviewRaws = value.reviewRaws.map(bytes => { const r = JSON.parse(bytes); r.packetSha256 = hash(value.packetRaw); return raw(r); });
    assert.throws(() => evaluateEvidenceV11(value));
  }
});

test('review quotes, eligibility and recomputed totals cannot be replaced by forged summaries', () => {
  for (const change of [
    v => { const r = JSON.parse(v.reviewRaws[0]); r.items[0].evidence.name.quote = 'not present'; v.reviewRaws[0] = raw(r); },
    v => { const r = JSON.parse(v.reviewRaws[0]); r.items[0].scores.extra = 2; v.reviewRaws[0] = raw(r); },
    v => { const s = JSON.parse(v.summaryRaws[0]); s.variants.structured.axes.name.sufficient--; v.summaryRaws[0] = raw(s); },
    v => { const s = JSON.parse(v.summaryRaws[0]); s.pairedAxes.name.improved++; v.summaryRaws[0] = raw(s); },
    v => { const s = JSON.parse(v.summaryRaws[0]); s.reviewSha256 = hash('unrelated'); v.summaryRaws[0] = raw(s); },
  ]) {
    const value = evidenceFixture(); change(value);
    // Keep a changed review's hash attached so semantic evidence validation, not just hashing, is tested.
    const first = JSON.parse(value.summaryRaws[0]);
    if (first.reviewSha256 !== hash('unrelated')) { first.reviewSha256 = hash(value.reviewRaws[0]); value.summaryRaws[0] = raw(first); }
    assert.throws(() => evaluateEvidenceV11(value));
  }
});

test('CLI reads explicit evidence paths and frozen snapshots, writes exclusively, and preserves all originals', () => {
  const parent = join(root, '.local', 'acceptance-v11-tests'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-')), snapshotRoot = `.local/policy-live/${Date.now()}-${process.pid}`;
  const snapshotDir = join(root, snapshotRoot);
  try {
    const value = evidenceFixture(), source = JSON.parse(value.sourceRaw);
    source.rawArtifacts = snapshotRoot;
    for (const [name, record] of Object.entries(source.sourceSnapshots)) record.path = `${snapshotRoot}/source/${name}`;
    value.sourceRaw = raw(source);
    const names = ['source.json', 'plan.json', 'packet.json', 'map.json', 'review1.json', 'summary1.json', 'review2.json', 'summary2.json', 'acceptance.json'];
    const paths = names.map(name => join(dir, name));
    const map = JSON.parse(value.mappingRaw); map.source = paths[0].slice(root.length + 1); map.sha256 = hash(value.sourceRaw); value.mappingRaw = raw(map);
    value.summaryRaws = value.summaryRaws.map(bytes => { const s = JSON.parse(bytes); s.sourceSha256 = hash(value.sourceRaw); return raw(s); });
    const raws = [value.sourceRaw, value.frozenPlanRaw, value.packetRaw, value.mappingRaw, value.reviewRaws[0], value.summaryRaws[0], value.reviewRaws[1], value.summaryRaws[1]];
    raws.forEach((bytes, i) => writeFileSync(paths[i], bytes, { mode: 0o600 }));
    mkdirSync(join(snapshotDir, 'source/policy'), { recursive: true });
    writeFileSync(join(snapshotDir, 'source/policy/eval-plan-anchored.json'), value.planSnapshotRaw);
    writeFileSync(join(snapshotDir, 'source/policy/acceptance-v11.mjs'), value.gateSnapshotRaw);
    const run = () => spawnSync(process.execPath, [join(here, 'acceptance-v11.mjs'), ...paths], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const result = readFileSync(paths[8]); assert.equal(JSON.parse(result).overallPass, true);
    raws.forEach((bytes, i) => assert.deepEqual(readFileSync(paths[i]), bytes));
    const second = run(); assert.notEqual(second.status, 0); assert.match(second.stderr, /Preserve prior acceptance/);
    assert.deepEqual(readFileSync(paths[8]), result);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(snapshotDir, { recursive: true, force: true }); }
});

test('the complete frozen plan survives normal secret-redaction serialization unchanged', () => {
  assert.deepEqual(clean(plan), plan);
  const dev = JSON.parse(readFileSync(join(here, 'eval-plan-anchored-development.json')));
  assert.deepEqual(clean(dev), dev);
});
