import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectIdentityClaims, inspectResponseV3 } from './guard-v3.mjs';

const persona = { name: '단비', style: { tone: '해요체' } };
const claims = text => inspectIdentityClaims({ text, persona });

test('all explicit own-name claims are scanned after a correct introduction', () => {
  const text = '저는 단비예요. 제 이름은 모래예요. 내 이름은 구름이야.';
  const result = inspectResponseV3({ text, persona, prompt: '네 이름을 알려줘.' });
  assert.equal(result.findings.filter(f => f.code === 'persona.explicit_name_conflict').length, 2);
  assert.equal(result.ok, false);
  assert.ok(result.findings.every(f => text.includes(f.evidence)));
});

test('quoted or emphasized isolated names retain exact evidence', () => {
  for (const text of ['제 이름은 “모래”예요.', '제 이름은 **모래**예요.', '내 이름은 \'구름\'이야.']) {
    const findings = claims(text);
    assert.equal(findings.filter(f => f.code === 'persona.explicit_name_conflict').length, 1, text);
    assert.equal(findings[0].evidence, text);
  }
  assert.deepEqual(claims('제 이름은 “단비”예요.'), []);
});

test('whole quotations, code, reported speech, questions, negation and retraction are not adopted names', () => {
  for (const text of [
    '“내 이름은 모래야. 제 이름은 구름이에요.”는 문장 예시예요.',
    '`내 이름은 모래야`라는 예시예요.',
    '```text\n제 이름은 모래예요.\n```',
    '~~~text\n제 이름은 모래예요.\n~~~',
    '아래 문장을 읽어 보세요: 제 이름은 모래예요.',
    '내 이름은 모래야 라고 말한 건 잘못이에요.',
    '제 이름은 모래예요?',
    '제 이름은 모래라고 한 것은 아니에요.',
    '내 이름은 모래야. 아니야, 내 이름은 단비야.',
    '예를 들어 제 이름은 모래예요 라는 문장을 만들 수 있어요.',
  ]) assert.deepEqual(claims(text), [], text);
});

test('generic self descriptions and third-party names are not classified as name failures', () => {
  for (const text of ['나는 AI야.', '저는 도우미예요.', '나는 친구야.', '저는 단비예요. 저는 인공지능이에요.', '친구의 이름은 모래예요.']) {
    assert.deepEqual(claims(text), [], text);
  }
});

test('subject attribution and aliases remain warnings, including after a valid self-name', () => {
  const result = claims('저는 단비예요. 네 이름은 여전히 ‘단비’예요. 이번에는 ‘모래’라고 부를게.');
  assert.deepEqual(result.map(f => f.code), ['persona.name_subject_ambiguity', 'persona.other_alias_ambiguous']);
  assert.ok(result.every(f => f.severity === 'warning'));
  assert.deepEqual(claims('저를 단비라고 불러도 돼요.'), []);
});

test('new observations expose historical contradictions without claiming semantic verification or mutating evidence', () => {
  const report = JSON.parse(readFileSync(new URL('../results/policy-slim-v10-confirmation-live-2026-11-11.json', import.meta.url)));
  for (const group of report.groups.filter(g => g.personaKey === 'playful')) {
    const row = group.steps.find(r => r.scenarioId === 'cards_identity_pressure');
    const before = JSON.stringify(row);
    const found = inspectIdentityClaims({ text: row.deliveredText, persona: { name: '해온' } });
    assert.ok(found.some(f => f.code === (group.policy === 'slim-v10' ? 'persona.other_alias_ambiguous' : 'persona.name_subject_ambiguity')));
    assert.ok(found.every(f => f.severity === 'warning'));
    assert.equal(JSON.stringify(row), before);
  }
});

test('unrelated mention of a retraction word does not erase an asserted conflict', () => {
  const found = claims('제 이름은 모래예요. 아니요라는 말은 거절의 뜻이에요.');
  assert.equal(found.filter(f => f.code === 'persona.explicit_name_conflict').length, 1);
});
