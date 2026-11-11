import test from 'node:test';
import assert from 'node:assert/strict';
import { responseContract, decodeStructuredReply } from './structured.mjs';

const persona = { name: '세린', style: { language: '한국어', tone: '친근한 해요체' } };
const caps = { webSearch: false, notifications: false, physicalPresence: false };
const packet = () => ({ self_name: '세린', speaking_style: '해요체', can_web_search: false, can_schedule_notifications: false, can_attend_in_person: false, approved_facts: [], uncertainties: ['외부 확인 없음'], next_action: '작은 목표 하나 정하기', reply: '저는 세린이에요. 작은 목표 하나를 정해 봐요.\n' });
test('schema is caller-owned and the displayed reply is exact generated text, never a synthetic name prefix', () => {
  const schema = responseContract(persona, caps);
  assert.deepEqual(schema.schema.properties.self_name.enum, ['세린']);
  assert.deepEqual(schema.schema.properties.can_web_search.enum, [false]);
  const data = packet(), decoded = decodeStructuredReply(JSON.stringify(data), persona, caps);
  assert.equal(decoded.text, data.reply); assert.equal(decoded.semanticVerified, false);
  assert.equal(decoded.metadata.reply, undefined);
  data.reply = '어떤 말투나 이름도 보장되지 않는 원문';
  assert.equal(decodeStructuredReply(JSON.stringify(data), persona, caps).text, data.reply);
});
test('malformed JSON, missing or extra fields, mismatched metadata and empty replies cannot pass the contract', () => {
  for (const raw of ['not json', '[]', '{}']) assert.throws(() => decodeStructuredReply(raw, persona, caps), /JSON|contract/);
  for (const change of [ { self_name: '다른 사람' }, { speaking_style: '반말' }, { can_web_search: true }, { unknown: true }, { reply: ' ' }, { approved_facts: [1] }, { uncertainties: [false] }, { next_action: null } ]) {
    assert.throws(() => decodeStructuredReply(JSON.stringify({ ...packet(), ...change }), persona, caps));
  }
});
