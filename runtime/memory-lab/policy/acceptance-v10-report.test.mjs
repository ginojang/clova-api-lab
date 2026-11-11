import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { evaluateReportV10 } from './acceptance-v10-report.mjs';
import { evaluateV10 } from './acceptance-v10.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..');
const results = resolve(here, '../results');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
// Read immutable captured evidence as an integrity fixture; never call a model.
function fixture() {
  const frozenPlanRaw = readFileSync(join(here, 'eval-plan-slim.json'));
  const acceptanceRaw = readFileSync(join(here, 'acceptance-v10.mjs'));
  return {
    sourceRaw: readFileSync(join(results, 'policy-slim-v10-confirmation-live-2026-11-11.json')),
    frozenPlanRaw,
    summaryRaws: ['primary', 'secondary'].map(name => readFileSync(join(results, `policy-slim-v10-${name}-summary-2026-11-11.json`))),
    acceptanceRaw, planSnapshotRaw: Buffer.from(frozenPlanRaw), acceptanceSnapshotRaw: Buffer.from(acceptanceRaw),
  };
}
function changeSource(value, change) {
  const source = JSON.parse(value.sourceRaw); change(source); value.sourceRaw = encode(source);
}

test('restores exactly two twenties and invokes the unchanged gate with original evidence hashes', () => {
  const value = fixture(), originals = [value.sourceRaw, value.frozenPlanRaw, ...value.summaryRaws].map(bytes => Buffer.from(bytes));
  const result = evaluateReportV10(value);
  const source = JSON.parse(value.sourceRaw); source.plan = JSON.parse(value.frozenPlanRaw);
  const expected = evaluateV10({ source, sourceSha256: hash(value.sourceRaw), summaries: value.summaryRaws.map(bytes => JSON.parse(bytes)), summarySha256s: value.summaryRaws.map(hash) });
  const { reportRecovery, ...actual } = result;
  assert.deepEqual(actual, expected);
  assert.equal(reportRecovery.sourceSha256, hash(value.sourceRaw));
  assert.equal(reportRecovery.frozenPlanSha256, hash(value.frozenPlanRaw));
  assert.equal(reportRecovery.frozenAcceptanceSha256, hash(value.acceptanceRaw));
  assert.deepEqual(reportRecovery.restoredFields.map(field => field.restoredValue), [20, 20]);
  assert.ok(Object.values(reportRecovery.frozenSnapshots).every(snapshot => snapshot.bytesVerified));
  assert.deepEqual([value.sourceRaw, value.frozenPlanRaw, ...value.summaryRaws], originals);
  assert.equal(JSON.parse(value.sourceRaw).plan.numericAcceptance.minimumInputTokenReductionPercent, '***');
});

test('different original plan bytes or snapshot digests are rejected', () => {
  for (const mutate of [
    value => { value.frozenPlanRaw = Buffer.concat([value.frozenPlanRaw, Buffer.from(' ')]); },
    value => { changeSource(value, source => { source.planSha256 = hash('wrong'); }); },
    value => { changeSource(value, source => { source.sourceSnapshots['policy/eval-plan-slim.json'].sha256 = hash('wrong'); }); },
    value => { value.planSnapshotRaw = Buffer.from('{}'); },
    value => { value.acceptanceRaw = Buffer.concat([value.acceptanceRaw, Buffer.from('\n')]); },
    value => { value.acceptanceSnapshotRaw = Buffer.from('different source'); },
    value => { changeSource(value, source => { source.sourceSnapshots['policy/acceptance-v10.mjs'].sha256 = hash('wrong'); }); },
  ]) { const value = fixture(); mutate(value); assert.throws(() => evaluateReportV10(value)); }
});

test('nonredacted differences anywhere else in the embedded plan are rejected', () => {
  for (const mutate of [
    source => { source.plan.purpose += ' changed'; },
    source => { source.plan.rubric.axes.register += ' changed'; },
    source => { source.plan.numericAcceptance.minimumQualitySufficientGain = 0; },
    source => { source.plan.steps[0].text += ' changed'; },
    source => { source.plan.extra = '***'; },
  ]) { const value = fixture(); changeSource(value, mutate); assert.throws(() => evaluateReportV10(value), /outside the two known/); }
});

test('only exact markers are recoverable; numeric, missing and malformed threshold values fail', () => {
  for (const threshold of [20, 19, null, '20', '**', '****', {}]) {
    const value = fixture(); changeSource(value, source => { source.plan.numericAcceptance.minimumInputTokenReductionPercent = threshold; });
    assert.throws(() => evaluateReportV10(value), /exact redaction markers/);
  }
  const value = fixture(); changeSource(value, source => { delete source.plan.numericAcceptance.minimumOutputTokenReductionPercent; });
  assert.throws(() => evaluateReportV10(value), /exact redaction markers/);
});

test('a matching fabricated frozen plan still cannot change the fixed twenty percent profile', () => {
  const value = fixture(), plan = JSON.parse(value.frozenPlanRaw); plan.numericAcceptance.minimumInputTokenReductionPercent = 19;
  value.frozenPlanRaw = encode(plan); value.planSnapshotRaw = Buffer.from(value.frozenPlanRaw);
  changeSource(value, source => { source.planSha256 = hash(value.frozenPlanRaw); source.sourceSnapshots['policy/eval-plan-slim.json'].sha256 = hash(value.frozenPlanRaw); });
  assert.throws(() => evaluateReportV10(value), /Frozen numeric acceptance profile differs/);
});

test('untrusted snapshot paths and summaries detached from the original source are rejected', () => {
  const path = fixture(); changeSource(path, source => { source.sourceSnapshots['policy/eval-plan-slim.json'].path = '../secret'; });
  assert.throws(() => evaluateReportV10(path), /snapshot path/);
  const summary = fixture(), one = JSON.parse(summary.summaryRaws[0]); one.sourceSha256 = hash('other source'); summary.summaryRaws[0] = encode(one);
  assert.throws(() => evaluateReportV10(summary), /source SHA-256 differs/);
});

test('CLI verifies actual snapshot bytes and refuses to overwrite its result', () => {
  const parent = join(root, '.local', 'acceptance-v10-report-tests'); mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'case-'));
  const snapshotRoot = `.local/policy-live/${Date.now()}-${process.pid}`;
  const snapshotDir = join(root, snapshotRoot, 'source', 'policy'); mkdirSync(snapshotDir, { recursive: true });
  try {
    const value = fixture();
    changeSource(value, source => {
      source.rawArtifacts = snapshotRoot;
      for (const name of ['policy/eval-plan-slim.json', 'policy/acceptance-v10.mjs']) source.sourceSnapshots[name].path = `${snapshotRoot}/source/${name}`;
    });
    value.summaryRaws = value.summaryRaws.map(raw => { const summary = JSON.parse(raw); summary.sourceSha256 = hash(value.sourceRaw); return encode(summary); });
    writeFileSync(join(snapshotDir, 'eval-plan-slim.json'), value.planSnapshotRaw);
    writeFileSync(join(snapshotDir, 'acceptance-v10.mjs'), value.acceptanceSnapshotRaw);
    const paths = ['source.json', 'plan.json', 'one.json', 'two.json', 'result.json'].map(name => join(dir, name));
    [value.sourceRaw, value.frozenPlanRaw, ...value.summaryRaws].forEach((raw, i) => writeFileSync(paths[i], raw, { mode: 0o600 }));
    const run = () => spawnSync(process.execPath, [join(here, 'acceptance-v10-report.mjs'), ...paths], { cwd: root, encoding: 'utf8', timeout: 10000 });
    const first = run(); assert.equal(first.status, 0, first.stderr);
    const saved = readFileSync(paths[4]); assert.equal(JSON.parse(saved).reportRecovery.sourceSha256, hash(value.sourceRaw));
    const again = run(); assert.notEqual(again.status, 0); assert.match(again.stderr, /Preserve prior acceptance/);
    assert.deepEqual(readFileSync(paths[4]), saved);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(join(root, snapshotRoot), { recursive: true, force: true }); }
});
