import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const axes = ['name', 'register', 'personality', 'eventMeaning', 'currentness', 'capabilityHonesty', 'empathy', 'practicalHelp'];
const sha = value => createHash('sha256').update(value).digest('hex');
const encode = value => JSON.stringify(value, null, 2) + '\n';

function fixture({ salted = true, repair = false } = {}) {
  const persona = { name: '샘플', style: { language: 'ko', tone: '한국어 해요체' } };
  const memories = [{ kind: 'event', value: '독립 검증용 기억', evidence_pointer: 'turn://test' }];
  const report = {
    executionCompleted: true, modelRequests: repair ? 3 : 2, knownUsage: { input: 10, output: 20 }, usageComplete: true,
    summary: { attemptedPrompts: 2, errors: 0, delivered: 2, blocked: 0 },
    plan: { variants: ['baseline', 'structured'], personas: [{ key: 'calm', persona }], budget: { draftCalls: 2 },
      rubric: { axes: Object.fromEntries(axes.map(axis => [axis, axis])) }, limitations: [] },
    groups: ['baseline', 'structured'].map(variant => ({ personaKey: 'calm', variant, steps: [{
      scenarioId: 'example', prompt: '현재 기억을 알려 줘.', scoredAxes: [...axes], activeMemorySnapshot: structuredClone(memories),
      draftText: variant === 'baseline' ? '기본 응답이에요.\n' : '구조화 응답이에요.\n',
      repairText: repair && variant === 'structured' ? '교정된 응답이에요.\n' : null,
      deliveredText: repair && variant === 'structured' ? '교정된 응답이에요.\n' : variant === 'baseline' ? '기본 응답이에요.\n' : '구조화 응답이에요.\n',
      deliveryStatus: 'delivered',
    }] })),
  };
  const mapping = { ...(salted ? { salt: 'e'.repeat(48) } : {}), items: [] };
  const packet = { items: [] };
  for (const group of report.groups) for (const row of group.steps) for (const phase of ['draft', 'repair']) {
    const text = phase === 'draft' ? row.draftText : row.repairText;
    if (text === null) continue;
    const key = `${group.personaKey}/${group.variant}/${row.scenarioId}/${phase}`;
    const id = sha((mapping.salt ?? 'blind-policy-2026-11-11') + '\0' + key).slice(0, 14);
    mapping.items.push({ id, personaKey: group.personaKey, variant: group.variant, scenarioId: row.scenarioId, phase, delivered: row.deliveredText === text });
    packet.items.push({ id, persona: structuredClone(persona), prompt: row.prompt, scoredAxes: [...axes], activeMemories: structuredClone(memories), text });
  }
  const review = { items: packet.items.map(item => ({ id: item.id,
    scores: Object.fromEntries(axes.map(axis => [axis, 2])),
    evidence: Object.fromEntries(axes.map(axis => [axis, { quote: item.text.trim(), reason: '고정 평가 기준에 따른 시험 근거' }])),
    criticalFailures: [],
  })) };
  return { report, mapping, packet, review };
}

function run(change = () => {}, options = {}) {
  const dir = mkdtempSync(join(root, '.summary-integrity-'));
  try {
    const value = fixture(options);
    change(value);
    const paths = ['source.json', 'packet.json', 'mapping.json', 'review.json', 'summary.json'].map(name => join(dir, name));
    const source = encode(value.report), packet = encode(value.packet);
    value.mapping.sha256 = sha(source);
    value.mapping.source = relative(root, paths[0]);
    value.review.packetSha256 = sha(packet);
    [source, packet, encode(value.mapping), encode(value.review)].forEach((content, index) => writeFileSync(paths[index], content));
    const process = spawnSync(globalThis.process.execPath, [join(here, 'summarize.mjs'), ...paths], { cwd: root, encoding: 'utf8', timeout: 10000 });
    return { status: process.status, stderr: process.stderr, wroteSummary: existsSync(paths[4]),
      summary: existsSync(paths[4]) ? JSON.parse(readFileSync(paths[4], 'utf8')) : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const rejects = (change, expected, options) => {
  const result = run(change, options);
  assert.notEqual(result.status, 0);
  assert.equal(result.wroteSummary, false);
  assert.match(result.stderr, expected);
};

test('old fixed IDs and new salted IDs both preserve scores and existing thresholds', () => {
  for (const salted of [false, true]) {
    const result = run(({ mapping, packet, review }) => { mapping.items.reverse(); packet.items.reverse(); review.items.reverse(); }, { salted });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.summary.matchedValidPairs, 1);
    assert.equal(result.summary.compiledGate.minimumDelivery, 8);
    assert.equal(result.summary.compiledGate.numericGateMet, false);
    assert.equal(result.summary.variants.structured.axes.name.sufficient, 1);
  }
});

test('draft and repair phases retain their exact text and delivery mapping', () => {
  const result = run(() => {}, { repair: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.repairChanges.length, 1);
  rejects(({ mapping }) => { mapping.items.find(item => item.phase === 'repair').phase = 'draft'; }, /Duplicate mapping|Mapping id/, { repair: true });
});

test('swapping variant attribution cannot silently swap semantic scores', () => {
  rejects(({ mapping }) => {
    [mapping.items[0].variant, mapping.items[1].variant] = [mapping.items[1].variant, mapping.items[0].variant];
  }, /Mapping id does not match/);
});

test('packet evidence must exactly match source text, persona, prompt, axes and memories', () => {
  for (const field of ['text', 'persona', 'prompt', 'scoredAxes', 'activeMemories']) {
    rejects(({ packet }) => {
      packet.items[0][field] = { text: '변경된 응답', persona: { name: '다른 사람' }, prompt: '다른 질문', scoredAxes: ['name'], activeMemories: [] }[field];
    }, new RegExp(`Packet ${field} differs`));
  }
});

test('missing, duplicate and unknown evidence rows are rejected', () => {
  rejects(({ mapping }) => mapping.items.pop(), /Mapping does not cover/);
  rejects(({ packet }) => packet.items.pop(), /Packet does not cover/);
  rejects(({ packet }) => { packet.items[1] = structuredClone(packet.items[0]); }, /Duplicate packet id/);
  rejects(({ mapping }) => { mapping.items[1] = structuredClone(mapping.items[0]); }, /Duplicate mapping/);
  rejects(({ mapping }) => { mapping.items[0].scenarioId = 'unknown'; }, /unknown source phase/);
  rejects(({ mapping }) => { mapping.items[0].delivered = false; }, /delivery metadata differs/);
  rejects(({ mapping }) => { mapping.salt = 'different-salt'; }, /Mapping id does not match/);
});

test('critical failures require nonempty verbatim quotes and nonempty reasons', () => {
  for (const quote of ['', ' ', null, '없는 인용']) {
    rejects(({ review }) => { review.items[0].criticalFailures = [{ quote, reason: '검증 이유' }]; }, /Empty or non-verbatim critical/);
  }
  for (const reason of ['', ' ', null, 3]) {
    rejects(({ review, packet }) => { review.items[0].criticalFailures = [{ quote: packet.items[0].text.trim(), reason }]; }, /Missing critical evidence reason/);
  }
  const result = run(({ review, packet }) => {
    review.items[0].criticalFailures = [{ quote: packet.items[0].text.trim(), reason: '시험용 실제 인용 근거' }];
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.summary.variants.baseline.criticalFailures, 1);
});
