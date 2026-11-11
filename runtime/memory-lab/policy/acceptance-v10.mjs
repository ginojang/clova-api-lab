#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inside } from '../../clova/common.ts';

export const NUMERIC_ACCEPTANCE_V10 = {
  "id": "same-hcx007-v8-slim-v10-quality-or-efficiency-v1",
  "profiles": {
    "baseline": {
      "model": "clova:HCX-007",
      "policy": "composed-v8"
    },
    "structured": {
      "model": "clova:HCX-007",
      "policy": "slim-v10"
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
  "qualityGainAxes": [
    "register",
    "personality",
    "practicalHelp"
  ],
  "minimumQualitySufficientGain": 1,
  "minimumInputTokenReductionPercent": 20,
  "minimumOutputTokenReductionPercent": 20,
  "requireCompleteUsageForEfficiency": true,
  "requireEveryReviewProtected": true,
  "progressRoutes": [
    "quality_gain",
    "efficiency_gain"
  ]
};

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value, label) => { assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid count: ${label}`); return value; };
const delivered = row => row.deliveryStatus === 'delivered' && typeof row.deliveredText === 'string' && row.deliveredText.trim().length > 0
  && row.turnEnd?.ok === true && row.turnEnd.endReason === 'completed' && row.turnEnd.finishReason === 'stop' && row.draftText === row.deliveredText;

const PARTS = ['identity', 'acknowledgement', 'answer', 'next_step'];
const BASE_FIELDS = ['self_name', 'speaking_style', 'can_web_search', 'can_schedule_notifications', 'can_attend_in_person', 'approved_facts', 'uncertainties', 'next_action', 'reply'];
const sameKeys = (value, names) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const validUsage = value => sameKeys(value, ['input', 'output', 'cacheRead', 'cacheWrite'])
  && Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0);
function validateDisplayedContract(row, profile, persona) {
  // Invalid/nondelivered outputs remain coverage failures; do not invent a valid contract for them.
  if (!delivered(row)) return;
  const fields = profile.policy === 'slim-v10' ? ['reply'] : BASE_FIELDS;
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
  if (profile.policy === 'slim-v10') assert.ok(row.structuredMetadata == null || sameKeys(row.structuredMetadata, []), 'Slim output must not fabricate generated metadata');
  else assert.equal(raw.self_name, persona.name, 'Baseline generated identity metadata differs from active persona');
}

/**
 * A prospective two-route gate for v8 versus slim-v10, not a replacement for any
 * historical compiledGate. Summaries MUST first pass summarize.mjs against their
 * source/packet/mapping/review inputs. This tool binds their source and hashes,
 * but does not revalidate raw review quotes or establish reviewer independence.
 */
export function evaluateV10({ source, sourceSha256, summaries, summarySha256s }) {
  const acceptance = source.plan?.numericAcceptance;
  assert.deepEqual(acceptance, NUMERIC_ACCEPTANCE_V10, 'Unexpected or weakened v10 acceptance profile');
  assert.equal(source.plan.evaluationStage, 'confirmation');
  assert.equal(source.plan.id, 'persona-slim-v10-two-topics-2026-11-11');
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
    const critical = { baseline: baselineCritical, candidate: candidateCritical, increase: candidateCritical - baselineCritical, pass: candidateCritical <= baselineCritical };
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
      minimumReductionPercent: 20, pass: baseline > 0 && candidate * 100 <= baseline * 80 }];
  }));
  const efficiencyMeasuredPass = completeUsage && reconciledUsage && Object.values(tokenReductions).every(value => value.pass);
  const bothProtected = coverage.pass && reviewDecisions.every(review => review.protectedPass);
  const qualityGain = bothProtected && reviewDecisions.every(review => review.qualityGain);
  const efficiencyGain = bothProtected && efficiencyMeasuredPass;
  const overallPass = qualityGain || efficiencyGain;
  const disposition = !coverage.pass ? 'incomplete' : !bothProtected ? 'quality_protection_failed'
    : qualityGain && efficiencyGain ? 'quality_and_efficiency_gain' : qualityGain ? 'quality_gain'
      : efficiencyGain ? 'efficiency_gain_only' : 'progress_unmet';
  return {
    schemaVersion: 1, acceptanceId: acceptance.id, planId: source.plan.id, sourceSha256,
    executionProfiles: structuredClone(acceptance.profiles), coverage, reviewDecisions, bothProtected,
    qualityGain, efficiencyGain, overallPass, disposition,
    accounting: { actualUsage, completeUsage, reconciledUsage, tokenReductions, efficiencyMeasuredPass,
      reportedUsage: source.knownUsage ?? null, reportedUsageComplete: source.usageComplete === true,
      cost: source.cost ?? null, costBasis: source.costBasis ?? 'unknown', qualityGateUsesCost: false },
    trustBoundary: 'Summaries must first pass summarize.mjs against source/packet/map/raw-review. This tool does not independently revalidate review quotes or prove independence. Both full reviews must be frozen before unmasking.',
    limitations: ['Same-HCX-007 two-topic confirmation, not human validation or statistical significance.',
      'Efficiency-only progress does not imply improved personality/register/help.',
      'All eight axes forbid paired regression, including a decline masked by net sufficient gains.',
      'Compiler/schema change together; token savings do not establish a monetary amount.',
      'Incomplete or unreconciled usage prevents efficiency acceptance, but does not fabricate zero usage.'],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 4, 'Usage: acceptance-v10.mjs SOURCE SUMMARY1 SUMMARY2 OUTPUT');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const files = args.map(file => inside(root, relative(root, resolve(file))));
  assert.ok(!existsSync(files[3]), 'Preserve prior acceptance results');
  const raw = files.slice(0, 3).map(file => readFileSync(file));
  const [source, ...summaries] = raw.map(value => JSON.parse(value.toString('utf8')));
  const result = evaluateV10({ source, sourceSha256: hash(raw[0]), summaries, summarySha256s: raw.slice(1).map(hash) });
  writeFileSync(files[3], JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ output: relative(root, files[3]), overallPass: result.overallPass, disposition: result.disposition }) + '\n');
}
