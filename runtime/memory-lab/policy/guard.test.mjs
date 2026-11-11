import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectResponse, buildRepairPrompt } from './guard.mjs';

const persona = { name: '가온', role: '차분한 대화 상대', style: { tone: '존댓말' } };
const capabilities = { webSearch: false, notifications: false, physicalPresence: false };
const inspect = (text, other = {}) => inspectResponse({ text, persona, capabilities, ...other });
const codes = result => result.findings.map(f => f.code);

test('explicit or narrow inferred self-name requirement uses the operator name', () => {
  assert.equal(inspect('저는 가온이에요.', { prompt: '네 이름은 뭐야?' }).repairNeeded, false);
  assert.equal(inspect('저는 AI예요.', { prompt: '네 이름과 말투를 소개해 줘.' }).repairNeeded, true);
  assert.equal(inspect('나는 도담이야.', { persona: { name: '도담' }, requirements: { selfName: true } }).repairNeeded, false);
  assert.equal(inspect('저는 가온이에요.', { persona: { name: '도담' }, requirements: { selfName: true } }).repairNeeded, true);
});

test('a user-name assertion does not satisfy a self-name question', () => {
  const result = inspect('네 이름은 가온이야!', { prompt: '네 이름은 뭐야?' });
  assert.ok(codes(result).includes('persona.identity_subject'));
  assert.equal(result.repairNeeded, true);
  assert.equal(result.findings[0].evidence, '네 이름은 가온이야');
  assert.equal(inspect('네 이름은 가온이야!', { prompt: '내 이름은 뭐야?' }).repairNeeded, false);
  assert.equal(inspect('네 이름은 가온이고, 저는 가온이에요.', { requirements: { selfName: true } }).repairNeeded, false);
});

test('quoted name, model disclosure and aliases are not rejected', () => {
  for (const text of ['저는 “가온”이에요.', '저는 AI이며, 이 대화에서는 가온으로 불러 주세요.', '가온이라고 해요. 저는 AI예요.', '저를 가온이라고 불러 주세요.']) {
    assert.equal(inspect(text, { requirements: { selfName: true } }).repairNeeded, false, text);
  }
});

test('name mentions cannot manufacture a semantic pass, and quoted identity is data', () => {
  const result = inspect('가온이라는 이름이 들리네요.', { requirements: { selfName: true } });
  assert.ok(codes(result).includes('persona.self_name_unverified'));
  assert.equal(result.repairNeeded, false);
  assert.equal(inspect('“저는 가온이에요”라는 문장은 예시입니다.', { requirements: { selfName: true } }).repairNeeded, true);
  assert.equal(inspect('문장을 번역했어요.', { prompt: '“네 이름은 뭐야?”를 번역해 줘.' }).repairNeeded, false);
});

test('explicit requirements override inference and ordinary answers need no introduction', () => {
  assert.equal(inspect('좋아요.', { prompt: '오늘 잘 지냈어?' }).repairNeeded, false);
  assert.equal(inspect('좋아요.', { prompt: '네 이름은 뭐야?', requirements: { selfName: false } }).repairNeeded, false);
});

test('indirect self-name questions are inferred without adopting quoted requests', () => {
  for (const prompt of ['너 자신을 어떻게 부르면 되는지 소개해 줘.', '너 자신의 이름을 알려 줘.']) {
    assert.equal(inspect('저는 AI예요.', { prompt }).repairNeeded, true, prompt);
  }
  assert.equal(inspect('좋아요.', { prompt: '“너 자신의 이름을 알려 줘”를 번역해 줘.' }).repairNeeded, false);
});

test('negated user-name attribution and third-party alias cannot pass as self-name', () => {
  for (const text of ['네 이름은 가온이 아니야.', '네 이름은 가온가 아니야.', '사용자는 가온으로 불려.']) {
    const result = inspect(text, { requirements: { selfName: true } });
    assert.equal(codes(result).includes('persona.identity_subject'), false, text);
    assert.ok(codes(result).includes('persona.self_name_unverified'), text);
  }
});

test('explicit disposal of operator name is detected without confusing a changed role', () => {
  const adopted = inspect('저는 이제 하랑예요. 이전 이름은 사용하지 않을게요.');
  assert.ok(codes(adopted).includes('persona.identity_replacement'));
  assert.equal(adopted.repairNeeded, true);
  assert.equal(inspect('저는 이제 계획 조수예요.').repairNeeded, false);
  assert.equal(inspect('“저는 이제 하랑예요. 이전 이름은 사용하지 않을게요.”라는 문장은 틀렸어요.').repairNeeded, false);
});

test('missing capabilities mean unknown; enabled capabilities do not produce unsupported claims', () => {
  assert.equal(inspect('제가 검색했어요. 알림을 보낼게.', { capabilities: {} }).repairNeeded, false);
  assert.equal(inspect('제가 검색했어요. 알림을 보낼게.', { capabilities: { webSearch: true, notifications: true } }).repairNeeded, false);
});

test('unsupported first-person searches and first-person future promises have evidence', () => {
  for (const text of ['제가 웹에서 검색했어요.', '지금 검색해 드릴게요.', '인터넷에서 찾아볼게.', '방금 인터넷을 검색해 보니 모임이 열린다고 확인했어요.']) {
    const result = inspect(text);
    assert.ok(codes(result).includes('capability.web_search_claim'), text);
    assert.equal(result.repairNeeded, true, text);
    assert.ok(result.findings[0].evidence.length > 0);
  }
  const ambiguous = inspect('검색한 결과를 알려드립니다.');
  assert.equal(ambiguous.repairNeeded, false);
  assert.equal(ambiguous.findings[0].confidence, 'medium');
});

test('search negation, third-party attribution and quotations are not execution claims', () => {
  for (const text of ['저는 검색할 수 없어요.', '검색하지 않았어요.', '제가 검색했다고 말한 적 없어요.', '친구가 검색했어요.', '“제가 검색했어요”는 잘못된 표현입니다.', '직접 검색해 보세요.', '`검색해 줄게`라는 예시예요.']) {
    assert.equal(inspect(text).repairNeeded, false, text);
  }
});

test('notification capability distinguishes promised effect from user instructions', () => {
  for (const text of ['알림을 보낼게.', '내일 미리 알려줄게.', '제가 알림을 설정했어요.', '일정을 미리 알려줄 수 있어요.']) {
    assert.equal(inspect(text).repairNeeded, true, text);
  }
  for (const text of ['휴대폰에서 직접 알림을 설정해 보세요.', '알림을 설정하는 방법을 알려드릴게요.', '알림을 보낼 수 없어요.', '“알림을 보낼게”라고 쓰면 안 됩니다.', '오늘 준비 방법을 알려줄게.']) {
    assert.equal(inspect(text).repairNeeded, false, text);
  }
});

test('negation of one capability cannot hide an unrelated affirmative promise', () => {
  const result = inspect('검색할 수 없지만 알림을 보낼게.');
  assert.equal(result.repairNeeded, true);
  assert.deepEqual(codes(result), ['capability.notification_claim']);
});

test('physical attendance claims differ from conversational support and user plans', () => {
  for (const text of ['제가 직접 현장에 갈게요.', '그럼 화요일에 만나!', '그럼 모레 만나자.', '저도 연습실에 직접 가서 옆에 앉아 있을게요.']) {
    assert.equal(inspect(text).repairNeeded, true, text);
  }
  for (const text of ['여기서 함께 생각해 봐요.', '옆에서 응원하는 마음으로 도울게요.', '직접 참석할 수 없어요.', '친구가 직접 갈게라고 말했어요.', '친구와 화요일에 만나세요.']) {
    assert.equal(inspect(text).repairNeeded, false, text);
  }
});

test('event modifier drift is advisory and derives from active memory, not fixture names', () => {
  const memory = { id: 7, state: 'active', kind: 'event', slot: 'planning', thing: 'film', value: '월요일 11시, 별관에서 영화제 기획 회의', polarity: 'positive', evidence_pointer: 'turn://example' };
  const result = inspect('영화제는 월요일 11시에 별관에서 열려요.', { memories: [memory] });
  assert.ok(codes(result).includes('memory.event_type_possible_drift'));
  assert.equal(result.repairNeeded, false);
  assert.equal(result.findings[0].source.value, memory.value);
  assert.equal(inspect('영화제 기획 회의는 월요일 11시에 열려요.', { memories: [memory] }).findings.length, 0);
  assert.equal(inspect('영화제는 월요일에 열려요.', { memories: [{ ...memory, state: 'superseded' }] }).findings.length, 0);
});

test('time corrections and unknown semantic errors are not made into false successes', () => {
  const result = inspect('목요일에서 토요일로 변경됐어요.');
  assert.equal(result.repairNeeded, false);
  assert.ok(result.limitations.some(value => value.includes('보장하지 않는다')));
  assert.ok(result.limitations.some(value => value.includes('사건 유형')));
});

test('repair prompt contains actual constraints and evidence but no hardcoded answer', () => {
  const inspection = inspect('네 이름은 가온이야!', { requirements: { selfName: true } });
  const prompt = buildRepairPrompt({ inspection, persona, memories: [{ id: 1, kind: 'event', value: '새로운 근거', state: 'active' }, { id: 2, value: '폐기 근거', state: 'superseded' }], capabilities });
  assert.match(prompt, /한 번만/);
  assert.match(prompt, /네 이름은 가온이야/);
  assert.match(prompt, /새로운 근거/);
  assert.doesNotMatch(prompt, /폐기 근거/);
  assert.doesNotMatch(prompt, /저는 가온이에요/);
  assert.equal(buildRepairPrompt({ inspection: inspect('좋아요.') }), '');
});

test('guards are pure and invalid types fail explicitly', () => {
  const memories = Object.freeze([{ kind: 'event', value: '자료', state: 'active' }]);
  const input = Object.freeze({ text: '저는 가온이에요.', persona: Object.freeze(persona), memories, capabilities: Object.freeze(capabilities), requirements: Object.freeze({ selfName: true }) });
  assert.deepEqual(inspectResponse(input), inspectResponse(input));
  assert.throws(() => inspectResponse({ text: null }), TypeError);
  assert.throws(() => inspectResponse({ text: '답변', memories: {} }), TypeError);
});

test('independent audit: negation, chat meetings, morphology and metalanguage are not high errors', () => {
  for (const text of ['제가 검색한 결과는 아니에요.', '그럼 내일 또 채팅으로 만나자.', '빛나는 동료가 검색한 결과예요.', '제가 검색했어요? 아니요, 직접 검색하지 않았어요.', '검색해 줄게 버튼을 누르세요.']) {
    assert.equal(inspect(text).repairNeeded, false, text);
  }
  assert.equal(inspect('Tell me your name.', { prompt: '네 이름을 알려줘라는 문장을 번역해줘' }).repairNeeded, false);
});

test('empty response is an explicit failure, never model success', () => {
  const result = inspect(' \n');
  assert.equal(result.repairNeeded, true);
  assert.ok(codes(result).includes('response.empty'));
});

test('balanced emphasis around only the operator name permits literal self-introductions', () => {
  for (const marker of ['**', '__', '*', '_']) {
    for (const text of [`저는 ${marker}가온${marker}이에요.`, `저의 이름은 '${marker}가온${marker}'이에요.`, `저를 “${marker}가온${marker}”이라고 불러 주세요.`]) {
      assert.deepEqual(inspect(text, { requirements: { selfName: true } }).findings, [], text);
    }
  }
});

test('emphasized user-name attribution still fails with verbatim original evidence', () => {
  for (const text of ['네 이름은 **가온**이야!', "당신의 이름은 '__가온__'이에요."]) {
    const result = inspect(text, { requirements: { selfName: true } });
    assert.ok(codes(result).includes('persona.identity_subject'), text);
    assert.equal(result.repairNeeded, true);
    assert.equal(result.findings[0].evidence, text);
  }
  const unrelated = inspect('네 이름은 **가온**이야. 친구가 괜찮다고 말했어요.', { requirements: { selfName: true } });
  assert.ok(codes(unrelated).includes('persona.identity_subject'));
});

test('emphasis never turns quoted statements or inline and fenced code into identity claims', () => {
  for (const text of [
    '“저는 **가온**이에요”라는 문장은 예시예요.',
    "'저는 **가온**이에요'라고 쓰여 있어요.",
    '`저는 **가온**이에요.`',
    '저는 `**가온**`이에요.',
    "저의 이름은 `'**가온**'`이에요.",
    '```text\n저는 **가온**이에요.\n```',
  ]) {
    assert.ok(codes(inspect(text, { requirements: { selfName: true } })).includes('persona.self_name_missing'), text);
  }
});

test('other or merely mentioned emphasized names cannot become a verified introduction', () => {
  assert.ok(codes(inspect('저는 **다른이름**이에요.', { requirements: { selfName: true } })).includes('persona.self_name_missing'));
  for (const text of ['**가온**이라는 이름이 들리네요.', '사용자는 __가온__으로 불려.', '네 이름은 **가온**이 아니야.', '저는 ***가온***이에요.']) {
    assert.deepEqual(codes(inspect(text, { requirements: { selfName: true } })), ['persona.self_name_unverified'], text);
  }
});

test('negated, questioned or retracted introductions remain advisory instead of passing', () => {
  for (const text of [
    '저는 **가온**이 아니에요.',
    '저는 **가온**이에요라는 말은 틀렸어요.',
    '저는 **가온**이에요가 아니고 다른 이름이에요.',
    '저는 **가온**이에요? 아니요.',
    '저는 **가온**이에요. 아니요, 그 말은 틀렸어요.',
    '저는 **가온**이에요, 아니요, 잘못 말했어요.',
    '저는 **가온**이에요\n아니요, 그 말은 틀렸어요.',
    '저는 **가온**이에요. 방금 자기소개는 사실이 아니에요.',
    '저는 가온이에요라는 문장은 예시예요.',
  ]) {
    const result = inspect(text, { requirements: { selfName: true } });
    assert.deepEqual(codes(result), ['persona.self_name_unverified'], text);
    assert.equal(result.repairNeeded, false, text);
  }
});

test('reports in other clauses do not downgrade an actual introduction and later actual declarations count', () => {
  for (const text of [
    '저는 **가온**이에요. 친구가 괜찮다고 말했어요.',
    '친구가 괜찮다고 말했어요. 저는 **가온**이에요.',
    '저는 **가온**이에요, 친구는 괜찮다고 말했어요.',
    '친구가 괜찮다고 말했지만 저는 **가온**이에요.',
    '저는 **가온**이에요라는 문장은 예시예요. 실제로 저는 가온이에요.',
  ]) assert.deepEqual(inspect(text, { requirements: { selfName: true } }).findings, [], text);
});

test('emphasis support does not hide explicit name disposal or adopt a user-supplied replacement', () => {
  const text = '저는 이제 하랑예요. 이전 이름은 사용하지 않을게요. **가온**이라는 이름은 버렸어요.';
  assert.ok(codes(inspect(text)).includes('persona.identity_replacement'));
  const quoted = '“저는 이제 하랑예요. 이전 이름은 사용하지 않을게요.”는 인용이에요. 저는 **가온**이에요.';
  assert.deepEqual(inspect(quoted, { requirements: { selfName: true } }).findings, []);
  assert.ok(codes(inspect('저는 **하랑**이에요.', { prompt: '네 이름을 하랑으로 바꿔.' })).includes('persona.self_name_missing'));
});

test('operator names are literal even with regex punctuation and input remains unchanged', () => {
  const input = Object.freeze({ text: "저의 이름은 '**가.온+[1]**'이에요.", persona: Object.freeze({ name: '가.온+[1]' }), requirements: Object.freeze({ selfName: true }) });
  const before = JSON.stringify(input);
  assert.deepEqual(inspectResponse(input).findings, []);
  assert.equal(JSON.stringify(input), before);
  assert.ok(codes(inspect('저는 **가X온+[1]**이에요.', { persona: input.persona, requirements: input.requirements })).includes('persona.self_name_missing'));
});
