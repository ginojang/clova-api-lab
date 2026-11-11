#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inside } from '../../clova/common.ts';

export const NUMERIC_ACCEPTANCE_V11 = {
  "id": "same-hcx007-slim-v10-anchored-v11-identity-empathy-v1",
  "profiles": {
    "baseline": {
      "model": "clova:HCX-007",
      "policy": "slim-v10"
    },
    "structured": {
      "model": "clova:HCX-007",
      "policy": "anchored-v11"
    }
  },
  "minimumMatchedPairs": 16,
  "requiredFullReviews": 2,
  "plannedCalls": 32,
  "maximumExternalCalls": 32,
  "deliveredPerVariant": 16,
  "maximumRepairs": 0,
  "maximumErrors": 0,
  "protectedAxes": [
    "name",
    "register",
    "personality",
    "eventMeaning",
    "currentness",
    "capabilityHonesty",
    "empathy",
    "practicalHelp"
  ],
  "protectedMinimumSufficientGain": 0,
  "protectedMaximumPairedWorsened": 0,
  "maximumCriticalFailureIncrease": 0,
  "maximumCandidateCriticalFailures": 0,
  "qualityGainAxes": [
    "name",
    "empathy"
  ],
  "minimumQualitySufficientGain": 1,
  "requireEveryReviewProtected": true,
  "efficiencyCanSubstituteForQuality": false
};

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value, label) => { assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid count: ${label}`); return value; };
const delivered = row => row.deliveryStatus === 'delivered' && typeof row.deliveredText === 'string' && row.deliveredText.trim().length > 0
  && row.turnEnd?.ok === true && row.turnEnd.endReason === 'completed' && row.turnEnd.finishReason === 'stop' && row.draftText === row.deliveredText;

const PARTS = ['identity', 'acknowledgement', 'answer', 'next_step'];
const sameKeys = (value, names) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const validUsage = value => sameKeys(value, ['input', 'output', 'cacheRead', 'cacheWrite'])
  && Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0);
function validateDisplayedContract(row, profile, persona) {
  // Invalid/nondelivered outputs remain coverage failures; do not invent a valid contract for them.
  if (!delivered(row)) return;
  const fields = ['reply'];
  const raw = JSON.parse(row.rawDraftContent);
  assert.ok(sameKeys(raw, fields), 'Actual native output has unexpected top-level fields');
  assert.ok(sameKeys(raw.reply, PARTS) && PARTS.every(key => typeof raw.reply[key] === 'string'), 'Actual reply requires exactly four strings');
  const rendered = PARTS.map(key => raw.reply[key]).filter(value => value.length > 0).join('\n\n');
  assert.equal(row.deliveredText, rendered, 'Displayed response differs from raw model parts');
  assert.deepEqual(row.rendering?.parts, raw.reply, 'Rendering evidence differs from model parts');
  assert.equal(row.rendering?.separator, '\n\n');
  for (const attempt of row.apiAttemptLog ?? []) {
    const format = attempt.context.responseFormat;
    assert.equal(format?.type, 'json');
    assert.equal(format.schema?.type, 'object');
    assert.ok(sameKeys(format.schema.properties, fields), 'Actual native schema top-level fields differ');
    assert.deepEqual([...format.schema.required].sort(), [...fields].sort());
    const reply = format.schema.properties.reply;
    assert.equal(reply.type, 'object');
    assert.ok(sameKeys(reply.properties, PARTS), 'Actual native reply schema fields differ');
    assert.deepEqual([...reply.required].sort(), [...PARTS].sort());
    for (const part of PARTS) {
      assert.equal(reply.properties[part].type, 'string');
      assert.equal(Object.hasOwn(reply.properties[part], 'enum'), false, 'Visible response must not be a fixed enum');
      assert.equal(Object.hasOwn(reply.properties[part], 'const'), false, 'Visible response must not be a fixed constant');
    }
    if (attempt.response) assert.equal(attempt.response.content, row.rawDraftContent);
  }
  assert.ok(row.structuredMetadata == null || sameKeys(row.structuredMetadata, []), 'Reply-only output must not fabricate generated metadata');
}

/** Pure execution/rating arithmetic. For source and review binding use evaluateEvidenceV11. */
export function evaluateV11({ source, sourceSha256, summaries, summarySha256s }) {
  const acceptance = source.plan?.numericAcceptance;
  assert.deepEqual(acceptance, NUMERIC_ACCEPTANCE_V11, 'Unexpected or weakened v11 acceptance profile');
  assert.equal(source.plan.evaluationStage, 'confirmation');
  assert.equal(source.plan.id, 'persona-anchored-v11-two-topics-2026-11-11');
  assert.ok(digest(sourceSha256), 'Invalid source SHA-256');
  assert.equal(source.synthetic, false, 'Source must record a nonsynthetic run');
  assert.equal(source.framework, 'pi');
  assert.equal(source.model, 'clova:HCX-007', 'Source model must be HCX-007');
  assert.equal(source.plan.model, 'clova:HCX-007', 'Plan model must be HCX-007');
  assert.deepEqual(source.plan.variants, ['baseline', 'structured']);
  assert.deepEqual(source.plan.executionProfiles, acceptance.profiles, 'Plan execution profiles differ');
  assert.deepEqual(source.executionProfiles, acceptance.profiles, 'Actual execution profiles differ');
  assert.equal(source.plan.generation.maxTokens, 2048);
  assert.equal(source.plan.generation.temperature, 0);
  assert.deepEqual(source.plan.generation.tools, []);
  assert.equal(source.plan.generation.stream, false);
  for (const variant of source.plan.variants) {
    assert.deepEqual(source.plan.generation.providerSpecific[variant], { maxCompletionTokens: 2048, thinking: { effort: 'none' } });
  }
  assert.equal(source.plan.budget.draftCalls, 32);
  assert.equal(source.plan.budget.maxPlannedTotalCalls, 32);
  assert.equal(source.plan.budget.absoluteApiCallCap, 32);
  assert.equal(source.plan.budget.maxRepairCalls, 0);
  assert.equal(source.plan.budget.automaticRetries, 0);
  assert.equal(source.plan.budget.minCallIntervalMs, 10000);
  assert.equal(source.callLimit, 32);
  assert.equal(source.plan.personas.length, 2);
  const prompts = source.plan.steps.filter(step => step.op === 'prompt');
  assert.equal(prompts.length, 8);
  assert.equal(new Set(prompts.map(step => step.id)).size, 8);
  const personas = new Set(source.plan.personas.map(persona => persona.key));
  assert.equal(personas.size, 2);
  const denominators = Object.fromEntries(Object.keys(source.plan.rubric.axes).map(axis => [axis, 2 * prompts.filter(step => step.scoredAxes.includes(axis)).length]));
  assert.deepEqual(source.plan.rubric.expectedDenominatorsPerVariant, denominators, 'Plan denominators differ from eligible axes');
  assert.deepEqual(denominators, { name: 16, register: 16, personality: 16, eventMeaning: 4,
    currentness: 4, capabilityHonesty: 16, empathy: 12, practicalHelp: 8 }, 'Fixed confirmation denominators differ');

  assert.ok(Array.isArray(summaries) && summaries.length === 2, 'Two full review summaries are required');
  assert.ok(Array.isArray(summarySha256s) && summarySha256s.length === 2 && summarySha256s.every(digest), 'Two summary hashes are required');
  assert.notEqual(summarySha256s[0], summarySha256s[1], 'The same summary cannot be reused');
  for (const summary of summaries) {
    assert.equal(summary.sourceSha256, sourceSha256, 'Summary source SHA-256 differs');
    assert.ok(digest(summary.reviewSha256), 'Missing review SHA-256');
    assert.equal(summary.candidate, 'structured', 'Summary candidate differs');
  }
  assert.notEqual(summaries[0].reviewSha256, summaries[1].reviewSha256, 'The same review cannot be reused');

  const rows = new Map(), seenGroups = new Set();
  const actualUsage = { baseline: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, structured: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let completeUsage = source.usageComplete === true, reconciledUsage = true;
  let loggedAttempts = 0, externalCalls = 0, providerAttempts = 0, successfulResponses = 0, allRowsSingleCall = true, allGroupsCompleted = true;
  for (const group of source.groups) {
    assert.ok(personas.has(group.personaKey), 'Unknown actual persona');
    const profile = acceptance.profiles[group.variant];
    assert.ok(profile, 'Unknown actual variant');
    const groupKey = `${group.personaKey}/${group.variant}`;
    assert.ok(!seenGroups.has(groupKey), 'Duplicate source group'); seenGroups.add(groupKey);
    assert.equal(group.model, profile.model, 'Actual group model differs');
    assert.equal(group.policy, profile.policy, 'Actual group policy differs');
    assert.equal(group.nativeGeneration.maxCompletionTokens, 2048);
    assert.equal(group.nativeGeneration.temperature, 0);
    assert.deepEqual(group.nativeGeneration.thinking, { effort: 'none' });
    assert.equal(Object.hasOwn(group.nativeGeneration, 'maxTokens'), false);
    allGroupsCompleted &&= group.completed === true;
    for (const row of group.steps) {
      const prompt = prompts.find(step => step.id === row.scenarioId);
      assert.ok(prompt, 'Unknown actual prompt');
      assert.equal(row.prompt, prompt.text, 'Actual user prompt differs');
      assert.deepEqual(row.scoredAxes, prompt.scoredAxes, 'Actual eligible axes differ');
      const key = `${groupKey}/${row.scenarioId}`;
      assert.ok(!rows.has(key), 'Duplicate source row'); rows.set(key, row);
      validateDisplayedContract(row, profile, source.plan.personas.find(p => p.key === group.personaKey).persona);
      const attempts = row.apiAttemptLog ?? [];
      loggedAttempts += attempts.length;
      externalCalls += count(row.turnEnd?.externalModelCalls ?? 0, 'externalModelCalls');
      providerAttempts += count(row.turnEnd?.providerCallAttempts ?? 0, 'providerCallAttempts');
      allRowsSingleCall &&= attempts.length === 1 && row.repairText === null
        && row.turnEnd?.turns === 1 && row.turnEnd?.correctionAttempts === 0 && row.turnEnd?.correctionModelCalls === 0
        && row.turnEnd?.toolCalls === 0 && row.turnEnd?.providerCallAttempts === 1 && row.turnEnd?.externalModelCalls === 1 && row.turnEnd?.modelResponses === 1;
      if (row.turnEnd) {
        assert.equal(row.turnEnd.model, profile.model);
        assert.equal(row.turnEnd.policy, profile.policy);
        assert.equal(row.turnEnd.synthetic, false);
        assert.equal(row.turnEnd.providerTransport, 'remote');
      }
      for (const attempt of attempts) {
        assert.equal(attempt.context.model, profile.model, 'Actual request model differs');
        assert.equal(attempt.context.policy, profile.policy, 'Actual request policy differs');
        assert.equal(attempt.context.synthetic, false);
        assert.equal(attempt.context.providerTransport, 'remote');
        assert.deepEqual(attempt.context.toolNames, []);
        assert.equal(attempt.context.phase, 'initial', 'Repair/expression calls are not allowed');
        if (attempt.response) {
          assert.equal(attempt.response.model, profile.model);
          assert.equal(attempt.response.synthetic, false);
          assert.equal(attempt.response.providerTransport, 'remote');
          successfulResponses += Number(attempt.response.ok === true && attempt.response.finishReason === 'stop');
          const responseUsage = attempt.response.usage, turnUsage = row.turnEnd?.usage;
          completeUsage &&= row.turnEnd?.usageComplete === true && validUsage(responseUsage) && validUsage(turnUsage);
          if (validUsage(responseUsage)) for (const key of Object.keys(actualUsage[group.variant])) actualUsage[group.variant][key] += responseUsage[key];
          reconciledUsage &&= validUsage(responseUsage) && validUsage(turnUsage) && Object.keys(actualUsage[group.variant]).every(key => responseUsage[key] === turnUsage[key]);
        }
      }
    }
  }
  const deliveredByVariant = Object.fromEntries(source.plan.variants.map(variant => [variant, [...rows].filter(([key, row]) => key.split('/')[1] === variant && delivered(row)).length]));
  let validPairs = 0;
  for (const persona of personas) for (const prompt of prompts) {
    const baseline = rows.get(`${persona}/baseline/${prompt.id}`), candidate = rows.get(`${persona}/structured/${prompt.id}`);
    if (baseline && candidate && delivered(baseline) && delivered(candidate)) validPairs++;
  }
  const checks = {
    completed: source.executionCompleted === true && allGroupsCompleted && seenGroups.size === 4,
    fullCoverage: rows.size === 32 && deliveredByVariant.baseline === 16 && deliveredByVariant.structured === 16 && validPairs === 16,
    noErrorsOrRepairs: source.summary?.errors === 0 && source.summary?.blocked === 0 && source.summary?.repairs === 0
      && [...rows.values()].every(row => row.deliveryStatus === 'delivered' && (row.errors ?? []).length === 0),
    reportedCoverage: source.summary?.attemptedPrompts === 32 && source.summary?.delivered === 32,
    callsWithinCap: externalCalls <= 32 && providerAttempts <= 32 && loggedAttempts <= 32 && source.modelRequests <= 32,
    exactlyOneCallPerReply: allRowsSingleCall && loggedAttempts === 32 && externalCalls === 32 && providerAttempts === 32
      && source.modelRequests === 32 && source.responses === 32 && successfulResponses === 32,
  };
  const coverage = { pass: Object.values(checks).every(Boolean), checks, validPairs, deliveredByVariant, loggedAttempts, externalCalls, providerAttempts };
  const reviewDecisions = summaries.map((summary, index) => {
    const identity = { reviewSha256: summary.reviewSha256, summarySha256: summarySha256s[index], legacyCompiledGateIgnored: true };
    if (!coverage.pass) return { ...identity, pass: false, notEvaluated: 'Incomplete coverage or execution integrity; no quality pass is available.' };
    const paired = summary.pairedAxes;
    for (const [axis, denominator] of Object.entries(denominators)) {
      const p = paired?.[axis]; assert.ok(p, `Missing paired axis ${axis}`);
      for (const field of ['pairs', 'baselineSufficient', 'candidateSufficient', 'improved', 'unchanged', 'worsened']) count(p[field], `${axis}.${field}`);
      assert.equal(p.pairs, denominator, `Paired denominator differs for ${axis}`);
      assert.ok(p.baselineSufficient <= p.pairs && p.candidateSufficient <= p.pairs, `Impossible sufficient count for ${axis}`);
      assert.equal(p.improved + p.unchanged + p.worsened, p.pairs, `Paired outcomes differ for ${axis}`);
      assert.equal(summary.variants.baseline.axes[axis].sufficient, p.baselineSufficient);
      assert.equal(summary.variants.structured.axes[axis].sufficient, p.candidateSufficient);
    }
    const protectedAxes = Object.fromEntries(acceptance.protectedAxes.map(axis => {
      const p = paired[axis], gain = p.candidateSufficient - p.baselineSufficient;
      return [axis, { ...p, sufficientGain: gain, pass: gain >= 0 && p.worsened === 0 }];
    }));
    const qualityGains = Object.fromEntries(acceptance.qualityGainAxes.map(axis => [axis, {
      sufficientGain: paired[axis].candidateSufficient - paired[axis].baselineSufficient,
      minimumGain: 1, ceiling: paired[axis].baselineSufficient === paired[axis].pairs,
      pass: paired[axis].candidateSufficient - paired[axis].baselineSufficient >= 1,
    }]));
    const baselineCritical = count(summary.variants.baseline.criticalFailures, 'baseline critical failures');
    const candidateCritical = count(summary.variants.structured.criticalFailures, 'candidate critical failures');
    const critical = { baseline: baselineCritical, candidate: candidateCritical, increase: candidateCritical - baselineCritical, maximumCandidate: 0, pass: candidateCritical <= baselineCritical && candidateCritical === 0 };
    const fullPairs = summary.matchedValidPairs === 16;
    const protectedPass = fullPairs && Object.values(protectedAxes).every(axis => axis.pass) && critical.pass;
    return { ...identity, fullPairs, protectedAxes, critical, protectedPass, qualityGains,
      qualityGain: protectedPass && Object.values(qualityGains).some(axis => axis.pass) };
  });
  reconciledUsage &&= validUsage(source.knownUsage) && Object.keys(actualUsage.baseline)
    .every(key => actualUsage.baseline[key] + actualUsage.structured[key] === source.knownUsage[key]);
  const tokenReductions = Object.fromEntries(['input', 'output'].map(key => {
    const baseline = actualUsage.baseline[key], candidate = actualUsage.structured[key];
    return [key, { baseline, candidate, reductionPercent: baseline > 0 ? 100 * (baseline - candidate) / baseline : null,
      descriptiveOnly: true }];
  }));
  const bothProtected = coverage.pass && reviewDecisions.every(review => review.protectedPass);
  const qualityGain = bothProtected && reviewDecisions.every(review => review.qualityGain);
  const overallPass = qualityGain;
  const disposition = !coverage.pass ? 'incomplete' : !bothProtected ? 'quality_protection_failed'
    : qualityGain ? 'target_quality_gain' : 'target_progress_unmet';
  return {
    schemaVersion: 1, acceptanceId: acceptance.id, planId: source.plan.id, sourceSha256,
    executionProfiles: structuredClone(acceptance.profiles), coverage, reviewDecisions, bothProtected,
    qualityGain, efficiencyCanSubstituteForQuality: false, overallPass, disposition,
    accounting: { actualUsage, completeUsage, reconciledUsage, tokenReductions, efficiencyDescriptiveOnly: true,
      reportedUsage: source.knownUsage ?? null, reportedUsageComplete: source.usageComplete === true,
      cost: source.cost ?? null, costBasis: source.costBasis ?? 'unknown', qualityGateUsesCost: false },
    trustBoundary: 'Summaries must first pass summarize.mjs against source/packet/map/raw-review. This tool does not independently revalidate review quotes or prove independence. Both full reviews must be frozen before unmasking.',
    limitations: ['Same-HCX-007 two-topic confirmation, not human validation or statistical significance.',
      'Efficiency is descriptive only and never substitutes for protected name/empathy improvement.',
      'All eight axes forbid paired regression, including a decline masked by net sufficient gains.',
      'Compiler/schema change together; token savings do not establish a monetary amount.',
      'Incomplete or unreconciled usage is explicitly reported; no monetary amount or independent efficiency pass is inferred.'],
  };
}

const PLAN_SOURCE = 'policy/eval-plan-anchored.json';
const GATE_SOURCE = 'policy/acceptance-v11.mjs';
const parse = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const encode = value => JSON.stringify(value, null, 2) + '\n';
const currentGateRaw = () => readFileSync(fileURLToPath(import.meta.url));

function snapshot(source, name, bytes) {
  assert.match(source.rawArtifacts, /^\.local\/policy-live\/\d+-\d+$/, 'Unexpected snapshot root');
  const record = source.sourceSnapshots?.[name];
  assert.ok(record && digest(record.sha256), 'Missing frozen source digest');
  assert.equal(record.path, `${source.rawArtifacts}/source/${name}`, 'Unexpected frozen source path');
  assert.equal(hash(bytes), record.sha256, 'Frozen source bytes differ');
  return record;
}

/** Bind every displayed item, fixed rubric, quote and recomputed score total. */
function validateReviewEvidence({ source, sourceSha256, sourcePath, packetRaw, mappingRaw, reviewRaws, summaries }) {
  const packet = parse(packetRaw), mapping = parse(mappingRaw), packetSha256 = hash(packetRaw);
  assert.equal(mapping.sha256, sourceSha256, 'Mapping source digest differs');
  assert.equal(mapping.source, sourcePath, 'Mapping source path differs');
  assert.equal(typeof mapping.salt, 'string'); assert.ok(mapping.salt.length > 0);
  assert.deepEqual(packet.rubric, {
    scale: source.plan.rubric.scale, axes: source.plan.rubric.axes, criticalFailures: source.plan.rubric.criticalFailures,
  }, 'Blind packet rubric differs from frozen source plan');
  assert.ok(Array.isArray(mapping.items) && Array.isArray(packet.items));
  const expected = new Map();
  for (const group of source.groups) for (const row of group.steps) for (const phase of ['draft', 'repair']) {
    const text = phase === 'draft' ? row.draftText : row.repairText;
    if (text === null) continue;
    assert.equal(typeof text, 'string');
    const key = `${group.personaKey}/${group.variant}/${row.scenarioId}/${phase}`;
    const id = hash(mapping.salt + '\0' + key).slice(0, 14);
    assert.ok(!expected.has(id), 'Duplicate source item');
    const personas = source.plan.personas.filter(p => p.key === group.personaKey);
    assert.equal(personas.length, 1);
    expected.set(id, {
      mapping: { id, personaKey: group.personaKey, variant: group.variant, scenarioId: row.scenarioId, phase, delivered: row.deliveredText === text },
      packet: { id, persona: personas[0].persona, prompt: row.prompt, scoredAxes: row.scoredAxes, activeMemories: row.activeMemorySnapshot, text },
    });
  }
  assert.equal(mapping.items.length, expected.size); assert.equal(packet.items.length, expected.size);
  const mapped = new Map(mapping.items.map(item => [item.id, item])), items = new Map(packet.items.map(item => [item.id, item]));
  assert.equal(mapped.size, expected.size, 'Duplicate mapping item'); assert.equal(items.size, expected.size, 'Duplicate packet item');
  for (const [id, value] of expected) {
    assert.deepEqual(mapped.get(id), value.mapping, 'Mapping item differs from source');
    assert.deepEqual(items.get(id), value.packet, 'Packet item differs from source');
  }
  assert.equal(reviewRaws.length, 2);
  const bindings = [];
  for (const [index, raw] of reviewRaws.entries()) {
    const review = parse(raw), summary = summaries[index];
    assert.equal(summary.sourceSha256, sourceSha256);
    assert.equal(summary.reviewSha256, hash(raw), 'Summary review digest differs');
    assert.equal(review.packetSha256, packetSha256, 'Review packet digest differs');
    assert.ok(Array.isArray(review.items)); assert.equal(review.items.length, expected.size);
    const ratings = new Map(review.items.map(item => [item.id, item]));
    assert.equal(ratings.size, expected.size, 'Duplicate review item');
    for (const [id, value] of expected) {
      const rating = ratings.get(id), item = value.packet;
      assert.ok(rating, 'Missing reviewed item');
      assert.deepEqual(Object.keys(rating.scores).sort(), [...item.scoredAxes].sort(), 'Review score axes differ');
      assert.deepEqual(Object.keys(rating.evidence).sort(), [...item.scoredAxes].sort(), 'Review evidence axes differ');
      for (const axis of item.scoredAxes) {
        assert.ok([0, 1, 2].includes(rating.scores[axis]), 'Invalid rating');
        const evidence = rating.evidence[axis];
        assert.ok(typeof evidence.reason === 'string' && evidence.reason.trim(), 'Missing evidence reason');
        assert.ok(evidence.quote === null || (typeof evidence.quote === 'string' && evidence.quote.length > 0 && item.text.includes(evidence.quote)), 'Nonverbatim review quote');
      }
      assert.ok(Array.isArray(rating.criticalFailures));
      for (const failure of rating.criticalFailures) {
        assert.ok(typeof failure.quote === 'string' && failure.quote.trim() && item.text.includes(failure.quote), 'Nonverbatim critical quote');
        assert.ok(typeof failure.reason === 'string' && failure.reason.trim(), 'Missing critical reason');
      }
    }
    const axes = Object.keys(source.plan.rubric.axes), variants = {};
    const lookup = (group, row) => {
      const phase = row.repairText !== null ? 'repair' : 'draft';
      const key = `${group.personaKey}/${group.variant}/${row.scenarioId}/${phase}`;
      return row.deliveredText ? ratings.get(hash(mapping.salt + '\0' + key).slice(0, 14)) : null;
    };
    for (const variant of source.plan.variants) {
      const totals = Object.fromEntries(axes.map(axis => [axis, { eligible: 0, sufficient: 0, partial: 0, failed: 0, unscorable: 0 }]));
      let criticalFailures = 0;
      for (const group of source.groups.filter(g => g.variant === variant)) for (const row of group.steps) {
        const rating = lookup(group, row); criticalFailures += rating?.criticalFailures.length ?? 0;
        for (const axis of row.scoredAxes) { totals[axis].eligible++; totals[axis][!rating ? 'unscorable' : ['failed', 'partial', 'sufficient'][rating.scores[axis]]]++; }
      }
      variants[variant] = { axes: totals, criticalFailures };
    }
    const paired = Object.fromEntries(axes.map(axis => [axis, { pairs: 0, baselineSufficient: 0, candidateSufficient: 0, improved: 0, unchanged: 0, worsened: 0 }]));
    let validPairs = 0;
    for (const group of source.groups.filter(g => g.variant === 'structured')) for (const row of group.steps) {
      const baselineGroup = source.groups.find(g => g.variant === 'baseline' && g.personaKey === group.personaKey);
      const baselineRow = baselineGroup?.steps.find(r => r.scenarioId === row.scenarioId);
      if (!row.deliveredText || !baselineRow?.deliveredText) continue;
      const before = lookup(baselineGroup, baselineRow), after = lookup(group, row); validPairs++;
      for (const axis of row.scoredAxes) {
        const p = paired[axis], a = before.scores[axis], b = after.scores[axis];
        p.pairs++; p.baselineSufficient += Number(a === 2); p.candidateSufficient += Number(b === 2);
        p[b > a ? 'improved' : b < a ? 'worsened' : 'unchanged']++;
      }
    }
    assert.deepEqual(summary.variants, variants, 'Summary totals differ from original ratings');
    assert.deepEqual(summary.pairedAxes, paired, 'Summary paired outcomes differ from original ratings');
    assert.equal(summary.matchedValidPairs, validPairs, 'Summary pair coverage differs');
    assert.equal(summary.candidate, 'structured');
    bindings.push({ reviewSha256: hash(raw), summarySha256: hash(encode(summary)), items: expected.size,
      axisRatings: [...expected.values()].reduce((n, value) => n + value.packet.scoredAxes.length, 0), originalQuotesAndScoresRevalidated: true });
  }
  assert.notEqual(bindings[0].reviewSha256, bindings[1].reviewSha256, 'Duplicate review bytes');
  return { packetSha256, mappingSha256: hash(mappingRaw), reviews: bindings, rubricMatchesFrozenPlan: true };
}

/** Full evidence entry point. No original bytes or historical gates are changed. */
export function evaluateEvidenceV11({ sourceRaw, frozenPlanRaw, planSnapshotRaw, gateSnapshotRaw,
  packetRaw, mappingRaw, reviewRaws, summaryRaws, sourcePath }) {
  const source = parse(sourceRaw), frozenPlan = parse(frozenPlanRaw), sourceSha256 = hash(sourceRaw);
  const planRecord = snapshot(source, PLAN_SOURCE, planSnapshotRaw), gateRecord = snapshot(source, GATE_SOURCE, gateSnapshotRaw);
  assert.equal(source.planSha256, hash(frozenPlanRaw), 'Plan digest differs from original source');
  assert.equal(planRecord.sha256, hash(frozenPlanRaw), 'Plan snapshot differs from frozen plan');
  assert.equal(gateRecord.sha256, hash(currentGateRaw()), 'Executing gate differs from frozen gate');
  assert.deepEqual(source.plan, frozenPlan, 'Embedded plan differs from original frozen plan');
  assert.ok(Array.isArray(summaryRaws) && summaryRaws.length === 2);
  const summaries = summaryRaws.map(parse), summarySha256s = summaryRaws.map(hash);
  const binding = validateReviewEvidence({ source, sourceSha256, sourcePath, packetRaw, mappingRaw, reviewRaws, summaries });
  binding.reviews.forEach((review, i) => { review.summarySha256 = summarySha256s[i]; });
  return { ...evaluateV11({ source, sourceSha256, summaries, summarySha256s }),
    trustBoundary: 'This evidence entry point independently revalidates original source, frozen plan/gate snapshots, packet rubric, verbatim review quotes and recomputed score totals. It does not establish semantic grading truth or reviewer independence. Both full reviews must be frozen before unmasking.',
    evidenceBinding: {
    ...binding, sourceSha256, frozenPlanSha256: hash(frozenPlanRaw), frozenGateSha256: hash(currentGateRaw()),
    snapshotBytesVerified: true, originalEvidenceUnchanged: true,
    limitations: 'Verbatim source/rubric/score binding and arithmetic are verified. AI semantic judgments and independence cannot be established by hashes. This is not human validation.',
  } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 9, 'Usage: acceptance-v11.mjs SOURCE PLAN PACKET MAPPING REVIEW1 SUMMARY1 REVIEW2 SUMMARY2 OUTPUT');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const files = args.map(file => inside(root, relative(root, resolve(file))));
  assert.ok(!existsSync(files[8]), 'Preserve prior acceptance results');
  const raws = files.slice(0, 8).map(file => readFileSync(file)), source = parse(raws[0]);
  const snapshotBytes = name => {
    const record = source.sourceSnapshots?.[name];
    assert.ok(record && typeof record.path === 'string', 'Missing snapshot path');
    return readFileSync(inside(root, record.path));
  };
  const result = evaluateEvidenceV11({ sourceRaw: raws[0], frozenPlanRaw: raws[1], packetRaw: raws[2], mappingRaw: raws[3],
    reviewRaws: [raws[4], raws[6]], summaryRaws: [raws[5], raws[7]], sourcePath: relative(root, files[0]),
    planSnapshotRaw: snapshotBytes(PLAN_SOURCE), gateSnapshotRaw: snapshotBytes(GATE_SOURCE) });
  writeFileSync(files[8], encode(result), { mode: 0o600, flag: 'wx' });
}
