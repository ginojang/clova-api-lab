#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { inside } from '../../clova/common.ts';
import { projectRoot } from './session.mjs';

const argv = process.argv.slice(2); assert.equal(argv.length, 5, 'Usage: SOURCE PACKET MAPPING REVIEW OUTPUT');
const files = argv.map(p => inside(projectRoot, relative(projectRoot, resolve(p))));
assert.ok(!existsSync(files[4]), 'Preserve prior summaries');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const [report, packet, mapping, review] = files.slice(0, 4).map(f => JSON.parse(readFileSync(f, 'utf8')));
assert.equal(mapping.sha256, hash(files[0])); assert.equal(review.packetSha256, hash(files[1]));
assert.equal(report.executionCompleted, true, 'Source experiment is not complete');
assert.equal(mapping.source, relative(projectRoot, files[0]), 'Mapping source path differs');
assert.ok(Array.isArray(mapping.items) && Array.isArray(packet.items), 'Mapping and packet items must be arrays');
const salt = mapping.salt;
assert.ok(salt === undefined || (typeof salt === 'string' && salt.length > 0), 'Invalid mapping salt');
const sourceItems = new Map();
for (const group of report.groups) {
  const personas = report.plan.personas.filter(item => item.key === group.personaKey);
  assert.equal(personas.length, 1, 'Source persona must be unique');
  assert.ok(report.plan.variants.includes(group.variant), 'Unknown source variant');
  for (const row of group.steps) for (const phase of ['draft', 'repair']) {
    const text = phase === 'draft' ? row.draftText : row.repairText;
    if (text === null) continue;
    assert.equal(typeof text, 'string', 'Source phase text must be a string or null');
    const key = `${group.personaKey}/${group.variant}/${row.scenarioId}/${phase}`;
    assert.ok(!sourceItems.has(key), 'Duplicate source row phase');
    const id = createHash('sha256').update((salt ?? 'blind-policy-2026-11-11') + '\0' + key).digest('hex').slice(0, 14);
    sourceItems.set(key, {
      id, personaKey: group.personaKey, variant: group.variant, scenarioId: row.scenarioId, phase,
      delivered: row.deliveredText === text, persona: personas[0].persona, prompt: row.prompt,
      scoredAxes: row.scoredAxes, activeMemories: row.activeMemorySnapshot, text,
    });
  }
}
assert.equal(mapping.items.length, sourceItems.size, 'Mapping does not cover every source phase');
assert.equal(packet.items.length, sourceItems.size, 'Packet does not cover every source phase');
const packetItems = new Map(packet.items.map(item => [item.id, item]));
assert.equal(packetItems.size, packet.items.length, 'Duplicate packet id');
const seenMappingIds = new Set(), seenSourceKeys = new Set();
for (const item of mapping.items) {
  const key = `${item.personaKey}/${item.variant}/${item.scenarioId}/${item.phase}`;
  const source = sourceItems.get(key);
  assert.ok(source, 'Mapping refers to an unknown source phase');
  assert.ok(!seenSourceKeys.has(key) && !seenMappingIds.has(item.id), 'Duplicate mapping source or id');
  seenSourceKeys.add(key); seenMappingIds.add(item.id);
  assert.equal(item.id, source.id, 'Mapping id does not match source identity and salt');
  assert.equal(item.delivered, source.delivered, 'Mapping delivery metadata differs');
  const evidence = packetItems.get(item.id);
  assert.ok(evidence, 'Missing packet item for source phase');
  for (const field of ['persona', 'prompt', 'scoredAxes', 'activeMemories', 'text']) {
    assert.deepEqual(evidence[field], source[field], `Packet ${field} differs from source phase`);
  }
}
assert.equal(review.items.length, packet.items.length);
const scores = new Map(review.items.map(item => [item.id, item]));
assert.equal(scores.size, packet.items.length);
for (const item of packet.items) {
  const rating = scores.get(item.id); assert.ok(rating, 'Missing rating ' + item.id);
  assert.deepEqual(Object.keys(rating.scores).sort(), [...item.scoredAxes].sort());
  for (const axis of item.scoredAxes) {
    assert.ok([0, 1, 2].includes(rating.scores[axis]));
    const evidence = rating.evidence[axis]; assert.ok(evidence && typeof evidence.reason === 'string' && evidence.reason.trim(), 'Missing rating evidence reason');
    assert.ok(evidence.quote === null || (evidence.quote.length > 0 && item.text.includes(evidence.quote)), 'Non-verbatim evidence ' + item.id + '/' + axis);
  }
  assert.ok(Array.isArray(rating.criticalFailures), 'Critical failures must be an array');
  for (const failure of rating.criticalFailures) {
    assert.ok(failure && typeof failure.quote === 'string' && failure.quote.trim() && item.text.includes(failure.quote), 'Empty or non-verbatim critical evidence');
    assert.ok(typeof failure.reason === 'string' && failure.reason.trim(), 'Missing critical evidence reason');
  }
}
const lookup = (group, row, phase) => {
  const m = mapping.items.find(m => m.personaKey === group.personaKey && m.variant === group.variant && m.scenarioId === row.scenarioId && m.phase === phase);
  return m ? scores.get(m.id) : null;
};
const axes = Object.keys(report.plan.rubric.axes);
const summary = { schemaVersion: 1, sourceSha256: hash(files[0]), reviewSha256: hash(files[3]), evaluation: 'Independent AI review, variant labels and repair status hidden in packet; not human ratings', execution: report.summary, calls: report.modelRequests, knownUsage: report.knownUsage, usageComplete: report.usageComplete, variants: {}, repairChanges: [], compiledGate: {}, limitations: report.plan.limitations };
for (const variant of report.plan.variants) {
  const totals = Object.fromEntries(axes.map(axis => [axis, { eligible: 0, sufficient: 0, partial: 0, failed: 0, unscorable: 0 }]));
  let criticalFailures = 0;
  for (const group of report.groups.filter(g => g.variant === variant)) for (const row of group.steps) {
    const final = row.deliveredText ? lookup(group, row, row.repairText !== null ? 'repair' : 'draft') : null;
    criticalFailures += final?.criticalFailures.length ?? 0;
    for (const axis of row.scoredAxes) {
      totals[axis].eligible++;
      totals[axis][!final ? 'unscorable' : ['failed', 'partial', 'sufficient'][final.scores[axis]]]++;
    }
    if (row.repairText !== null) {
      const draft = lookup(group, row, 'draft'), repair = lookup(group, row, 'repair');
      summary.repairChanges.push({ persona: group.personaKey, scenario: row.scenarioId, delivered: Boolean(row.deliveredText), draft: draft.scores, repaired: repair.scores, draftCritical: draft.criticalFailures, repairCritical: repair.criticalFailures });
    }
  }
  summary.variants[variant] = { axes: totals, criticalFailures };
}
const candidate = report.plan.variants.includes('compiled') ? 'compiled' : report.plan.variants.find(v => v !== 'baseline');
const b = summary.variants.baseline, c = summary.variants[candidate];
summary.candidate = candidate;
const paired = Object.fromEntries(axes.map(axis => [axis, { pairs: 0, baselineSufficient: 0, candidateSufficient: 0, improved: 0, unchanged: 0, worsened: 0 }]));
let validPairs = 0;
for (const group of report.groups.filter(g => g.variant === candidate)) for (const row of group.steps) {
  const baseGroup = report.groups.find(g => g.variant === 'baseline' && g.personaKey === group.personaKey);
  const baseRow = baseGroup.steps.find(r => r.scenarioId === row.scenarioId);
  if (!row.deliveredText || !baseRow.deliveredText) continue;
  const candidateRating = lookup(group, row, row.repairText !== null ? 'repair' : 'draft');
  const baseRating = lookup(baseGroup, baseRow, baseRow.repairText !== null ? 'repair' : 'draft');
  validPairs++;
  for (const axis of row.scoredAxes) {
    const p = paired[axis], before = baseRating.scores[axis], after = candidateRating.scores[axis];
    p.pairs++; p.baselineSufficient += Number(before === 2); p.candidateSufficient += Number(after === 2);
    p[after > before ? 'improved' : after < before ? 'worsened' : 'unchanged']++;
  }
}
summary.matchedValidPairs = validPairs; summary.pairedAxes = paired;
summary.compiledGate = {
  complete: report.summary.attemptedPrompts === report.plan.budget.draftCalls && report.summary.errors === 0,
  registerGain: paired.register.candidateSufficient - paired.register.baselineSufficient,
  personalityGain: paired.personality.candidateSufficient - paired.personality.baselineSufficient,
  noDecreaseInProtectedAxes: ['name', 'eventMeaning', 'currentness', 'capabilityHonesty'].every(a => paired[a].candidateSufficient >= paired[a].baselineSufficient),
  noMoreCriticalFailures: c.criticalFailures <= b.criticalFailures,
  meaningfulHelpGainRequiresReview: true,
};
summary.compiledGate.candidateDelivery = report.groups.filter(g => g.variant === candidate).flatMap(g => g.steps).filter(r => r.deliveryStatus === 'delivered').length;
summary.compiledGate.minimumDelivery = ['hcx007', 'structured'].includes(candidate) ? 8 : candidate === 'compiled' ? 12 : 7;
summary.compiledGate.numericGateMet = validPairs >= summary.compiledGate.minimumDelivery && summary.compiledGate.candidateDelivery >= summary.compiledGate.minimumDelivery && summary.compiledGate.complete && summary.compiledGate.registerGain >= 2 && summary.compiledGate.personalityGain >= (candidate === 'compiled' ? 2 : 1) && summary.compiledGate.noDecreaseInProtectedAxes && summary.compiledGate.noMoreCriticalFailures;
writeFileSync(files[4], JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify({ output: relative(projectRoot, files[4]), compiledGate: summary.compiledGate, repairs: summary.repairChanges.length }) + '\n');
