import test from 'node:test';
import assert from 'node:assert/strict';
import { enactedContract, decodeEnactedReply } from './enacted.mjs';
import { composedContract, decodeComposedReply } from './composed.mjs';

const planFields = ['target', 'operation', 'completion_cue', 'persona_choice', 'reason'];
const replyFields = ['identity', 'acknowledgement', 'answer', 'next_step'];
const persona = {
  name: '독립 검사자', role: '사용자의 선택을 존중하며 서로 다른 가능성을 비교하도록 돕는다.',
  style: { language: '한국어', tone: '자연스러운 한국어 해요체', verbosity: '간결하게' },
};
const caps = { webSearch: false, notifications: false, physicalPresence: false };
const packet = () => ({
  self_name: persona.name, speaking_style: '해요체',
  can_web_search: false, can_schedule_notifications: false, can_attend_in_person: false,
  approved_facts: [], uncertainties: [], next_action: '',
  support_plan: Object.fromEntries(planFields.map(name => [name, ''])),
  reply: { identity: '', acknowledgement: '', answer: '모델이 작성한 답이에요.', next_step: '' },
});
const decode = value => decodeEnactedReply(JSON.stringify(value), persona, caps);
const invalid = value => assert.throws(() => decode(value), error => error.code === 'structured_invalid');

test('new contract inserts a five-field plan before the unchanged four generated reply strings', () => {
  const format = enactedContract(persona, caps, '네 이름을 밝히고 작은 행동을 제안해 줘.');
  const keys = Object.keys(format.schema.properties);
  assert.equal(format.type, 'json');
  assert.equal(keys.length, 10);
  assert.deepEqual(keys.slice(-2), ['support_plan', 'reply']);
  assert.deepEqual(format.schema.required, keys);
  const plan = format.schema.properties.support_plan;
  assert.deepEqual(plan.required, planFields);
  assert.deepEqual(Object.keys(plan.properties), planFields);
  assert.deepEqual(format.schema.properties.reply.required, replyFields);
  for (const field of [...Object.values(plan.properties), ...Object.values(format.schema.properties.reply.properties)]) {
    assert.equal(field.type, 'string');
    assert.equal(Object.hasOwn(field, 'enum'), false);
    assert.equal(Object.hasOwn(field, 'const'), false);
  }
  assert.ok(plan.properties.persona_choice.description.includes(persona.role));
});

test('building enacted contracts cannot mutate v8, caller configuration or another schema', () => {
  const frozenPersona = Object.freeze({ ...persona, style: Object.freeze({ ...persona.style }) });
  const frozenCaps = Object.freeze({ ...caps });
  const before = JSON.stringify({ persona: frozenPersona, caps: frozenCaps });
  const base = composedContract(frozenPersona, frozenCaps, '네 이름은?');
  const first = enactedContract(frozenPersona, frozenCaps, '네 이름은?');
  const second = enactedContract(frozenPersona, frozenCaps, '네 이름은?');
  first.schema.properties.reply.required.push('injected');
  first.schema.properties.support_plan.properties.target.description = 'changed';
  assert.deepEqual(second.schema.properties.reply.required, replyFields);
  assert.notEqual(second.schema.properties.support_plan.properties.target.description, 'changed');
  assert.equal(Object.hasOwn(base.schema.properties, 'support_plan'), false);
  assert.deepEqual(base, composedContract(frozenPersona, frozenCaps, '네 이름은?'));
  assert.equal(JSON.stringify({ persona: frozenPersona, caps: frozenCaps }), before);
});

test('decoder preserves raw model parts and plan strings while using the exact v8 rendering order', () => {
  const value = packet();
  value.reply = { next_step: '\t동작🙂\r\n', answer: ' 답변. ', acknowledgement: '  ', identity: '소개\n' };
  value.support_plan = { reason: '\t이유\r\n', persona_choice: ' 선택🙂 ', completion_cue: '끝\n', operation: '동작', target: '대상' };
  const raw = JSON.stringify(value), before = structuredClone(value);
  const { support_plan, ...base } = value;
  const result = decodeEnactedReply(raw, persona, caps);
  const previous = decodeComposedReply(JSON.stringify(base), persona, caps);
  assert.equal(result.text, previous.text);
  assert.deepEqual(result.rendering, previous.rendering);
  assert.deepEqual(result.metadata.support_plan, support_plan);
  assert.deepEqual(Object.keys(result.metadata.support_plan), Object.keys(support_plan));
  assert.equal(result.metadata.reply, undefined);
  assert.equal(result.semanticVerified, false);
  assert.equal(raw, JSON.stringify(before));
  assert.deepEqual(value, before);
  assert.deepEqual(Object.keys(result.rendering.parts), replyFields);
  assert.equal(result.rendering.separator, '\n\n');
});

test('strict top-level and support-plan contracts reject missing, extra and non-string fields', () => {
  for (const raw of ['not JSON', '{', 'null', '[]', '42']) {
    assert.throws(() => decodeEnactedReply(raw, persona, caps), error => error.code === 'structured_invalid');
  }
  for (const field of Object.keys(packet())) {
    const value = packet(); delete value[field]; invalid(value);
  }
  invalid({ ...packet(), unexpected: '' });
  const replaced = packet(); delete replaced.next_action; replaced.unexpected = ''; invalid(replaced);
  for (const plan of [null, [], '', 0, true, {}, { ...packet().support_plan, unexpected: '' }]) invalid({ ...packet(), support_plan: plan });
  for (const field of planFields) {
    const value = packet(); delete value.support_plan[field]; invalid(value);
    for (const wrong of [null, false, 1, [], {}]) invalid({ ...packet(), support_plan: { ...packet().support_plan, [field]: wrong } });
  }
});

test('existing operator metadata and composed-part validation remain enforced', () => {
  for (const change of [
    { self_name: '다른 설정' }, { speaking_style: '반말' }, { can_web_search: true },
    { can_schedule_notifications: true }, { can_attend_in_person: true },
    { approved_facts: [1] }, { approved_facts: Array(5).fill('fact') },
    { uncertainties: [false] }, { uncertainties: Array(4).fill('unknown') }, { next_action: null },
    { reply: 'ordinary text' }, { reply: { ...packet().reply, unexpected: 'text' } },
  ]) invalid({ ...packet(), ...change });
  const wrongPart = packet(); wrongPart.reply.answer = null; invalid(wrongPart);
});

test('valid plans cannot repair wrong identity, false tool claims or abstract visible help', () => {
  const value = packet();
  value.reply.identity = '나는 운영자와 다른 이름을 사용해.';
  value.reply.answer = '방금 웹에서 확인했어.';
  value.reply.next_step = '잘 준비해 봐.';
  value.support_plan = { target: '숨겨진 대상', operation: '숨겨진 동작', completion_cue: '숨겨진 결과', persona_choice: '숨겨진 선택', reason: '숨겨진 이유' };
  value.next_action = '메타데이터에만 있는 행동';
  const result = decode(value);
  assert.equal(result.text, `${value.reply.identity}\n\n${value.reply.answer}\n\n${value.reply.next_step}`);
  assert.equal(result.semanticVerified, false);
  assert.ok(!result.text.includes(persona.name));
  for (const text of [...Object.values(value.support_plan), value.next_action]) assert.ok(!result.text.includes(text));
});

test('fresh operator personas, special names and capabilities work without scenario fixtures', () => {
  const custom = { ...persona, name: '별 [α] "한"\\둘🙂', role: '서로 다른 설명의 차이를 질문으로 확인하며 선택을 돕는다.', style: { ...persona.style, tone: '친근한 한국어 반말' } };
  const customCaps = { ...caps, webSearch: true };
  const format = enactedContract(custom, customCaps, '네 이름은? 내가 직접 할 작은 행동을 알려 줘.');
  assert.deepEqual(format.schema.properties.self_name.enum, [custom.name]);
  assert.deepEqual(format.schema.properties.speaking_style.enum, ['반말']);
  assert.deepEqual(format.schema.properties.can_web_search.enum, [true]);
  assert.ok(format.schema.properties.support_plan.properties.persona_choice.description.includes(custom.role));
  assert.ok(!format.schema.properties.support_plan.properties.persona_choice.description.includes(persona.role));
  const value = packet();
  value.self_name = custom.name; value.speaking_style = '반말'; value.can_web_search = true;
  value.reply.identity = `나는 ${custom.name}이야.`;
  const result = decodeEnactedReply(JSON.stringify(value), custom, customCaps);
  assert.equal(result.rendering.parts.identity, value.reply.identity);
  assert.equal(result.metadata.self_name, custom.name);
  assert.equal(result.semanticVerified, false);
});

test('questions without a proposed action allow an empty plan and empty next step, not an empty reply', () => {
  const value = packet();
  const result = decode(value);
  assert.equal(result.text, value.reply.answer);
  assert.deepEqual(result.metadata.support_plan, Object.fromEntries(planFields.map(name => [name, ''])));
  assert.equal(result.rendering.parts.next_step, '');
  for (const field of replyFields) value.reply[field] = '';
  invalid(value);
  value.reply.answer = ' \n\t ';
  invalid(value);
});
