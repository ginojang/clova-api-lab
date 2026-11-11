#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inside } from '../../clova/common.ts';

export const NUMERIC_ACCEPTANCE_V9 = {
  id: 'same-hcx007-v8-enacted-v9-behavior-v1',
  profiles: { baseline: { model: 'clova:HCX-007', policy: 'composed-v8' }, structured: { model: 'clova:HCX-007', policy: 'enacted-v9' } },
  minimumMatchedPairs: 8,
  requiredFullReviews: 2,
  plannedCalls: 16,
  maximumExternalCalls: 16,
  deliveredPerVariant: 8,
  maximumRepairs: 0,
  maximumErrors: 0,
  primarySufficientGains: { personality: 1, practicalHelp: 1 },
  protectedAxes: ['name', 'register', 'eventMeaning', 'currentness', 'capabilityHonesty', 'empathy'],
  protectedMinimumSufficientGain: 0,
  protectedMaximumPairedWorsened: 0,
  maximumCriticalFailureIncrease: 0,
  requireEveryReviewToPass: true,
};

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const count = (value, label) => { assert.ok(Number.isSafeInteger(value) && value >= 0, `Invalid count: ${label}`); return value; };
const delivered = row => row.deliveryStatus === 'delivered' && typeof row.deliveredText === 'string' && row.deliveredText.trim().length > 0
  && row.turnEnd?.ok === true && row.turnEnd.endReason === 'completed' && row.turnEnd.finishReason === 'stop' && row.draftText === row.deliveredText;

/**
 * A new, prospective gate for v8 versus enacted-v9, not a replacement for any
 * historical compiledGate. Summaries MUST first pass summarize.mjs against their
 * source/packet/mapping/review inputs. This tool binds their source and hashes,
 * but does not revalidate raw review quotes or establish reviewer independence.
 */
export function evaluateV9({ source, sourceSha256, summaries, summarySha256s }) {
  const acceptance = source.plan?.numericAcceptance;
  assert.deepEqual(acceptance, NUMERIC_ACCEPTANCE_V9, 'Unexpected or weakened v9 acceptance profile');
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
  assert.equal(source.plan.budget.draftCalls, 16);
  assert.equal(source.plan.budget.maxPlannedTotalCalls, 16);
  assert.equal(source.plan.budget.absoluteApiCallCap, 16);
  assert.equal(source.plan.budget.maxRepairCalls, 0);
  assert.equal(source.plan.budget.automaticRetries, 0);
  assert.equal(source.plan.budget.minCallIntervalMs, 10000);
  assert.equal(source.callLimit, 16);
  assert.equal(source.plan.personas.length, 2);
  const prompts = source.plan.steps.filter(step => step.op === 'prompt');
  assert.equal(prompts.length, 4);
  assert.equal(new Set(prompts.map(step => step.id)).size, 4);
  const personas = new Set(source.plan.personas.map(persona => persona.key));
  assert.equal(personas.size, 2);
  const denominators = Object.fromEntries(Object.keys(source.plan.rubric.axes).map(axis => [axis, 2 * prompts.filter(step => step.scoredAxes.includes(axis)).length]));
  assert.deepEqual(source.plan.rubric.expectedDenominatorsPerVariant, denominators, 'Plan denominators differ from eligible axes');
  assert.equal(denominators.personality, 8);
  assert.equal(denominators.practicalHelp, 4);

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
    fullCoverage: rows.size === 16 && deliveredByVariant.baseline === 8 && deliveredByVariant.structured === 8 && validPairs === 8,
    noErrorsOrRepairs: source.summary?.errors === 0 && source.summary?.blocked === 0 && source.summary?.repairs === 0
      && [...rows.values()].every(row => row.deliveryStatus === 'delivered' && (row.errors ?? []).length === 0),
    reportedCoverage: source.summary?.attemptedPrompts === 16 && source.summary?.delivered === 16,
    callsWithinCap: externalCalls <= 16 && providerAttempts <= 16 && loggedAttempts <= 16 && source.modelRequests <= 16,
    exactlyOneCallPerReply: allRowsSingleCall && loggedAttempts === 16 && externalCalls === 16 && providerAttempts === 16
      && source.modelRequests === 16 && source.responses === 16 && successfulResponses === 16,
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
    const primary = Object.fromEntries(Object.entries(acceptance.primarySufficientGains).map(([axis, minimumGain]) => {
      const p = paired[axis], gain = p.candidateSufficient - p.baselineSufficient;
      return [axis, { ...p, sufficientGain: gain, minimumGain, ceiling: p.baselineSufficient === p.pairs, pass: gain >= minimumGain }];
    }));
    const protectedAxes = Object.fromEntries(acceptance.protectedAxes.map(axis => {
      const p = paired[axis], gain = p.candidateSufficient - p.baselineSufficient;
      return [axis, { ...p, sufficientGain: gain, pass: gain >= 0 && p.worsened === 0 }];
    }));
    const baselineCritical = count(summary.variants.baseline.criticalFailures, 'baseline critical failures');
    const candidateCritical = count(summary.variants.structured.criticalFailures, 'candidate critical failures');
    const critical = { baseline: baselineCritical, candidate: candidateCritical, increase: candidateCritical - baselineCritical, pass: candidateCritical <= baselineCritical };
    const fullPairs = summary.matchedValidPairs === 8;
    return { ...identity, fullPairs, primary, protectedAxes, critical,
      primaryPairedRegressions: Object.fromEntries(Object.keys(primary).map(axis => [axis, paired[axis].worsened])),
      pass: fullPairs && Object.values(primary).every(value => value.pass) && Object.values(protectedAxes).every(value => value.pass) && critical.pass };
  });
  const overallPass = coverage.pass && reviewDecisions.every(review => review.pass);
  return {
    schemaVersion: 1, acceptanceId: acceptance.id, planId: source.plan.id, sourceSha256,
    executionProfiles: structuredClone(acceptance.profiles), coverage, reviewDecisions, overallPass,
    disposition: !coverage.pass ? 'incomplete' : overallPass ? 'passed_prospective_pilot_gate' : reviewDecisions.some(review => review.pass) ? 'mixed_reviews' : 'gate_unmet',
    accounting: { knownUsage: source.knownUsage ?? null, usageComplete: source.usageComplete === true, cost: source.cost ?? null, costBasis: source.costBasis ?? 'unknown', qualityGateUsesCost: false },
    trustBoundary: 'Input summaries must already be validated by summarize.mjs against source, packet, mapping and raw review. This tool does not independently revalidate review quotations or prove reviewer independence. Both full reviews must be frozen before unmasking.',
    limitations: ['Prospective same-HCX-007 harness pilot; no retroactive change to old gates or conclusions.', 'Primary-axis regressions remain disclosed even when the net sufficient gain passes.', 'Ceiling cases remain unmet; no post-output replacement of questions or thresholds.', 'Two AI reviews do not establish human validation, statistical independence or production reliability.'],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 4, 'Usage: acceptance-v9.mjs SOURCE SUMMARY1 SUMMARY2 OUTPUT');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const files = args.map(file => inside(root, relative(root, resolve(file))));
  assert.ok(!existsSync(files[3]), 'Preserve prior acceptance results');
  const raw = files.slice(0, 3).map(file => readFileSync(file));
  const [source, ...summaries] = raw.map(value => JSON.parse(value.toString('utf8')));
  const result = evaluateV9({ source, sourceSha256: hash(raw[0]), summaries, summarySha256s: raw.slice(1).map(hash) });
  writeFileSync(files[3], JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ output: relative(root, files[3]), overallPass: result.overallPass, disposition: result.disposition }) + '\n');
}
