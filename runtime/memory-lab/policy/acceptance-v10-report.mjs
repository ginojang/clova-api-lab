#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { inside } from '../../clova/common.ts';
import { evaluateV10, NUMERIC_ACCEPTANCE_V10 } from './acceptance-v10.mjs';

const PLAN_SOURCE = 'policy/eval-plan-slim.json';
const ACCEPTANCE_SOURCE = 'policy/acceptance-v10.mjs';
const RESTORED_FIELDS = ['minimumInputTokenReductionPercent', 'minimumOutputTokenReductionPercent'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));

function snapshotRecord(source, name) {
  assert.match(source.rawArtifacts, /^\.local\/policy-live\/\d+-\d+$/, 'Unexpected source snapshot root');
  const snapshot = source.sourceSnapshots?.[name];
  assert.ok(snapshot && typeof snapshot.sha256 === 'string' && /^[a-f0-9]{64}$/.test(snapshot.sha256), 'Missing source snapshot digest');
  assert.equal(snapshot.path, `${source.rawArtifacts}/source/${name}`, 'Unexpected source snapshot path');
  return snapshot;
}

/**
 * Narrow evidence-serialization recovery, not a new gate. Only the two known
 * numeric threshold values may differ, and only as the exact marker "***".
 * The original source and summary bytes remain the identity used by the frozen
 * evaluator. No report, plan, review, summary or frozen evaluator is rewritten.
 */
export function evaluateReportV10({ sourceRaw, frozenPlanRaw, summaryRaws, acceptanceRaw, planSnapshotRaw, acceptanceSnapshotRaw }) {
  const source = parse(sourceRaw), frozenPlan = parse(frozenPlanRaw);
  const sourceSha256 = hash(sourceRaw), planSha256 = hash(frozenPlanRaw), acceptanceSha256 = hash(acceptanceRaw);
  const planSnapshot = snapshotRecord(source, PLAN_SOURCE), acceptanceSnapshot = snapshotRecord(source, ACCEPTANCE_SOURCE);
  assert.equal(source.planSha256, planSha256, 'Frozen plan bytes do not match source.planSha256');
  assert.equal(planSnapshot.sha256, planSha256, 'Frozen plan snapshot digest differs');
  assert.equal(hash(planSnapshotRaw), planSha256, 'Frozen plan snapshot bytes differ');
  assert.equal(acceptanceSnapshot.sha256, acceptanceSha256, 'Frozen acceptance source digest differs');
  assert.equal(hash(acceptanceSnapshotRaw), acceptanceSha256, 'Frozen acceptance snapshot bytes differ');
  assert.deepEqual(frozenPlan.numericAcceptance, NUMERIC_ACCEPTANCE_V10, 'Frozen numeric acceptance profile differs');

  const recoveredPlan = structuredClone(source.plan);
  const restoredFields = RESTORED_FIELDS.map(field => {
    assert.equal(recoveredPlan?.numericAcceptance?.[field], '***', 'Recovery only permits exact redaction markers in the two threshold fields');
    const restored = frozenPlan.numericAcceptance[field];
    assert.equal(restored, 20, 'Frozen threshold must remain twenty percent');
    recoveredPlan.numericAcceptance[field] = restored;
    return { path: `plan.numericAcceptance.${field}`, serializedValue: '***', restoredValue: restored };
  });
  assert.deepEqual(recoveredPlan, frozenPlan, 'Report plan differs outside the two known redacted thresholds');
  const recoveredSource = { ...source, plan: recoveredPlan };
  assert.ok(Array.isArray(summaryRaws) && summaryRaws.length === 2, 'Two original validated summaries are required');
  const summaries = summaryRaws.map(parse), summarySha256s = summaryRaws.map(hash);
  const result = evaluateV10({ source: recoveredSource, sourceSha256, summaries, summarySha256s });
  return {
    ...result,
    reportRecovery: {
      kind: 'two_numeric_threshold_redactions_only',
      sourceSha256, frozenPlanSha256: planSha256, frozenAcceptanceSha256: acceptanceSha256,
      sourceAndSummaryBytesUnchanged: true,
      originalSummarySha256s: summarySha256s,
      restoredFields,
      frozenSnapshots: {
        plan: { ...planSnapshot, bytesVerified: true },
        acceptance: { ...acceptanceSnapshot, bytesVerified: true },
      },
      equalityCheck: 'After restoring exactly the two marker values in an in-memory copy, the entire embedded plan deep-equals the original frozen plan.',
      gateUnchanged: true,
      limitations: 'This repairs serialization of nonsecret evaluation constants only. It does not relax redaction, rewrite evidence, change rubric/grades/gates, revalidate every review quote, or prove reviewer independence.',
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  assert.equal(args.length, 5, 'Usage: acceptance-v10-report.mjs SOURCE FROZEN_PLAN SUMMARY1 SUMMARY2 OUTPUT');
  const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
  const paths = args.map(path => inside(root, relative(root, resolve(path))));
  assert.ok(!existsSync(paths[4]), 'Preserve prior acceptance results');
  const [sourceRaw, frozenPlanRaw, ...summaryRaws] = paths.slice(0, 4).map(path => readFileSync(path));
  const source = parse(sourceRaw);
  const snapshotBytes = name => {
    const snapshot = snapshotRecord(source, name), path = inside(root, snapshot.path);
    assert.equal(path, resolve(root, snapshot.path), 'Snapshot path must not traverse symbolic links');
    return readFileSync(path);
  };
  const result = evaluateReportV10({ sourceRaw, frozenPlanRaw, summaryRaws,
    acceptanceRaw: readFileSync(resolve(here, 'acceptance-v10.mjs')),
    planSnapshotRaw: snapshotBytes(PLAN_SOURCE), acceptanceSnapshotRaw: snapshotBytes(ACCEPTANCE_SOURCE) });
  writeFileSync(paths[4], JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ output: relative(root, paths[4]), overallPass: result.overallPass,
    disposition: result.disposition, recoveredFields: result.reportRecovery.restoredFields.map(field => field.path) }) + '\n');
}
