import test from 'node:test';
import assert from 'node:assert/strict';
import { composedContract, decodeComposedReply } from './composed.mjs';
import { responseContract } from './structured.mjs';

const names = ['identity', 'acknowledgement', 'answer', 'next_step'];
const persona = {
  name: '시험도우미', role: '차분하게 사용자의 선택을 돕는다.',
  style: { language: '한국어', tone: '자연스러운 한국어 존댓말 해요체', verbosity: '간결하게' },
};
const caps = { webSearch: false, notifications: false, physicalPresence: false };
const packet = () => ({
  self_name: persona.name, speaking_style: '해요체',
  can_web_search: false, can_schedule_notifications: false, can_attend_in_person: false,
  approved_facts: [], uncertainties: [], next_action: '',
  reply: { identity: '', acknowledgement: '', answer: '모델이 작성한 답이에요.', next_step: '' },
});
const decode = value => decodeComposedReply(JSON.stringify(value), persona, caps);
const invalid = value => assert.throws(() => decode(value), error => error.code === 'structured_invalid');

test('contract retains v5 metadata and describes four generated string parts without answer enums', () => {
  const base = responseContract(persona, caps), format = composedContract(persona, caps, '네 이름을 밝히고 지금 인터넷 검색과 알림, 현장 참석이 가능한지 말해 줘.');
  assert.equal(format.type, 'json');
  assert.deepEqual(format.schema.required, base.schema.required);
  assert.deepEqual(Object.keys(format.schema.properties), Object.keys(base.schema.properties));
  assert.deepEqual(format.schema.properties.self_name, base.schema.properties.self_name);
  assert.deepEqual(format.schema.properties.speaking_style, base.schema.properties.speaking_style);
  assert.deepEqual(format.schema.properties.reply.required, names);
  assert.deepEqual(Object.keys(format.schema.properties.reply.properties), names);
  for (const part of Object.values(format.schema.properties.reply.properties)) {
    assert.equal(part.type, 'string');
    assert.equal(Object.hasOwn(part, 'enum'), false);
    assert.equal(Object.hasOwn(part, 'const'), false);
    assert.ok(part.description.includes('해요체'));
    assert.ok(part.description.includes(persona.role));
    assert.ok(part.description.includes('확인하지 않은'));
    assert.ok(part.description.includes('상대 날짜로 바꾸지 않는다'));
  }
  const parts = format.schema.properties.reply.properties;
  assert.ok(parts.identity.description.includes(JSON.stringify(persona.name)));
  assert.ok(parts.answer.description.includes('연도까지 포함한 절대 날짜'));
  assert.ok(parts.answer.description.includes('연도·시간·장소가 제공되지 않았으면 지어내지'));
  assert.ok(parts.answer.description.includes('예약 알림을 보낼 수 없다고'));
  assert.ok(parts.answer.description.includes('실시간 외부 조회를 할 수 없으며'));
});

test('prompt-derived self-name instructions exclude quoted translation tasks and preserve other registers', () => {
  const translations = ['"네 이름을 알려줘"를 번역해 줘.', '네 이름을 알려줘라는 문장을 번역해줘'];
  for (const prompt of translations) {
    const identity = composedContract(persona, caps, prompt).schema.properties.reply.properties.identity.description;
    assert.ok(identity.includes('이름을 묻지 않은 질문'));
    assert.ok(!identity.includes(JSON.stringify(persona.name)));
  }
  const casual = { ...persona, name: '별도시험도우미', style: { ...persona.style, tone: '친근한 한국어 반말' } };
  const format = composedContract(casual, { ...caps, webSearch: true }, '네 이름은? 검색해 줘.');
  for (const part of Object.values(format.schema.properties.reply.properties)) assert.ok(part.description.includes('친근한 한국어 반말'));
  assert.deepEqual(format.schema.properties.can_web_search.enum, [true]);
  assert.ok(!format.schema.properties.reply.properties.answer.description.includes('실시간 외부 조회를 할 수 없으며'));
});

test('rendering uses fixed part order and preserves all generated spaces, newlines and Unicode exactly', () => {
  const value = packet();
  // Deliberately change JSON key order: rendering order is the declared contract.
  value.reply = { next_step: '\t다음 행동🙂\r\n', answer: ' 근거가 있는 답. ', acknowledgement: '걱정\n\n확인\n', identity: '  자기소개\n' };
  const raw = JSON.stringify(value), before = structuredClone(value);
  const result = decodeComposedReply(raw, persona, caps);
  assert.equal(result.text, '  자기소개\n\n\n걱정\n\n확인\n\n\n 근거가 있는 답. \n\n\t다음 행동🙂\r\n');
  assert.deepEqual(result.rendering.parts, Object.fromEntries(names.map(name => [name, value.reply[name]])));
  assert.deepEqual(Object.keys(result.rendering.parts), names);
  assert.equal(result.rendering.separator, '\n\n');
  assert.equal(result.semanticVerified, false);
  assert.equal(result.metadata.reply, undefined);
  assert.deepEqual(value, before);
  assert.equal(raw, JSON.stringify(before));
});

test('only zero-length parts are omitted; whitespace parts remain unmodified', () => {
  const value = packet();
  value.reply = { identity: '', acknowledgement: '  ', answer: '\n정확한 원문\n', next_step: '' };
  assert.equal(decode(value).text, '  \n\n\n정확한 원문\n');
  value.reply.acknowledgement = '';
  assert.equal(decode(value).text, '\n정확한 원문\n');
  for (const name of names) value.reply[name] = '';
  invalid(value);
  value.reply.answer = ' \n\t ';
  invalid(value);
});

test('malformed JSON and non-object or inexact reply shapes fail before rendering', () => {
  for (const raw of ['not JSON', '{', 'null', '[]', '42']) {
    assert.throws(() => decodeComposedReply(raw, persona, caps), error => error.code === 'structured_invalid');
  }
  for (const reply of [null, [], 'plain reply', 1, true, {}, { ...packet().reply, extra: 'hidden text' }]) invalid({ ...packet(), reply });
  for (const name of names) {
    const missing = packet(); delete missing.reply[name]; invalid(missing);
    for (const value of [null, false, 1, [], {}]) invalid({ ...packet(), reply: { ...packet().reply, [name]: value } });
  }
});

test('v5 metadata validation still rejects missing, extra, mismatched and malformed fields', () => {
  const missing = packet(); delete missing.self_name; invalid(missing);
  for (const change of [
    { extra: true }, { self_name: '다른 도우미' }, { speaking_style: '반말' },
    { can_web_search: true }, { can_schedule_notifications: true }, { can_attend_in_person: true },
    { approved_facts: [1] }, { approved_facts: Array(5).fill('fact') },
    { uncertainties: [false] }, { uncertainties: Array(4).fill('uncertain') }, { next_action: null },
  ]) invalid({ ...packet(), ...change });
});

test('correct metadata cannot repair a wrong identity, missing identity or unsupported factual claim', () => {
  const value = packet();
  value.reply.identity = '나는 운영자가 정한 이름과 다른 이름이야.';
  value.reply.answer = '제가 방금 인터넷을 검색했어요.';
  value.next_action = '메타데이터에만 있는 행동';
  const result = decode(value);
  assert.equal(result.text, `${value.reply.identity}\n\n${value.reply.answer}`);
  assert.equal(result.semanticVerified, false);
  assert.ok(!result.text.includes(persona.name));
  assert.ok(!result.text.includes(value.next_action));
  value.reply.identity = '';
  assert.equal(decode(value).text, value.reply.answer);
});

test('builder and decoder do not mutate caller input or share mutable schemas', () => {
  const frozenPersona = Object.freeze({ ...persona, style: Object.freeze({ ...persona.style }) });
  const frozenCaps = Object.freeze({ ...caps });
  const original = JSON.stringify({ persona: frozenPersona, caps: frozenCaps });
  const first = composedContract(frozenPersona, frozenCaps, '네 이름은?');
  const second = composedContract(frozenPersona, frozenCaps, '네 이름은?');
  first.schema.properties.reply.required.push('injected');
  first.schema.properties.reply.properties.identity.description = 'changed';
  assert.deepEqual(second.schema.properties.reply.required, names);
  assert.notEqual(second.schema.properties.reply.properties.identity.description, 'changed');
  assert.equal(JSON.stringify({ persona: frozenPersona, caps: frozenCaps }), original);
  const value = packet(), raw = JSON.stringify(value);
  const result = decodeComposedReply(raw, frozenPersona, frozenCaps);
  result.rendering.parts.answer = 'changed';
  assert.equal(raw, JSON.stringify(value));
  assert.equal(decodeComposedReply(raw, frozenPersona, frozenCaps).text, value.reply.answer);
});
