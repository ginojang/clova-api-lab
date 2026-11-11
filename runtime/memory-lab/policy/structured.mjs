import { classifyRegisterContract } from './register.mjs';
import { LabError } from '../pi/store.mjs';
import { compileContextV2 } from './compiler-v2.mjs';

export function compileStructuredContext(persona, personaHash, items, budget, capabilities) {
  const suffix = '\n필수 JSON 계약을 채우고 reply 필드에 실제 사용자에게 보낼 자연스러운 답변을 작성한다. 다른 필드는 사용자에게 표시되지 않는다. 요청한 자기 이름과 사실은 reply에도 포함한다. 메타데이터가 맞아도 reply의 말투·성격·사실을 따로 지켜야 한다.';
  const assembled = compileContextV2(persona, personaHash, items, budget - [...suffix].length, capabilities);
  const text = assembled.text + suffix;
  return { ...assembled, text, contextChars: [...text].length, contextBudget: budget };
}

export function responseContract(persona, capabilities) {
  const register = classifyRegisterContract(persona).register;
  const style = register === 'haeyo' ? '해요체' : register === 'casual' ? '반말' : persona.style.tone;
  const properties = {
    self_name: { type: 'string', enum: [persona.name], description: '도우미 자신의 이름이며 사용자 이름이 아니다.' },
    speaking_style: { type: 'string', enum: [style], description: 'reply의 모든 서술에 적용할 말투.' },
    can_web_search: { type: 'boolean', enum: [capabilities.webSearch] },
    can_schedule_notifications: { type: 'boolean', enum: [capabilities.notifications] },
    can_attend_in_person: { type: 'boolean', enum: [capabilities.physicalPresence] },
    approved_facts: { type: 'array', items: { type: 'string' }, maxItems: 4, description: '승인된 현재 기억에서 필요한 사실만 짧게 적는다. 제공되지 않은 프로그램이나 경험은 만들지 않는다.' },
    uncertainties: { type: 'array', items: { type: 'string' }, maxItems: 3, description: '현재 자료와 기능만으로 확인할 수 없는 정보를 구분한다. 실제 취소 여부나 앞으로 잘 진행될지는 검색 또는 추가 근거 없이 확정하지 않는다.' },
    next_action: { type: 'string', description: '사용자가 실제로 바로 해볼 수 있는 작고 구체적인 행동 하나와 이유. 행동 제안이 필요 없는 질문이면 빈 문자열.' },
    reply: { type: 'string', description: `사용자에게 실제로 표시되는 유일한 필드. 원래 요청에 자연스럽게 답한다. 이름을 물었으면 이 reply 본문에서도 자신의 이름을 밝힌다. ${style}를 문장 전체에 적용한다. 위 capability가 false인 행동을 실행하거나 약속하지 않는다. 성격에 맞게 사용자의 구체적인 걱정을 받아 주고 next_action의 행동과 이유를 자연스럽게 제안한다. uncertainties에 적은 사항은 모른다고 구분하고 잘될 것이라고 보장하지 않는다.` },
  };
  return { type: 'json', schema: { type: 'object', properties, required: Object.keys(properties) } };
}

export function decodeStructuredReply(content, persona, capabilities) {
  let value;
  try { value = JSON.parse(content); } catch { throw new LabError('structured_invalid', 'Model response was not a JSON object'); }
  const expected = ['self_name', 'speaking_style', 'can_web_search', 'can_schedule_notifications', 'can_attend_in_person', 'approved_facts', 'uncertainties', 'next_action', 'reply'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== expected.length || expected.some(k => !Object.hasOwn(value, k))) throw new LabError('structured_invalid', 'Model response contract fields differ');
  const contract = responseContract(persona, capabilities);
  for (const key of expected.filter(k => !['approved_facts', 'uncertainties', 'next_action', 'reply'].includes(k))) if (value[key] !== contract.schema.properties[key].enum[0]) throw new LabError('structured_invalid', 'Model metadata differs from operator configuration');
  if (!Array.isArray(value.approved_facts) || value.approved_facts.length > 4 || value.approved_facts.some(x => typeof x !== 'string') || !Array.isArray(value.uncertainties) || value.uncertainties.length > 3 || value.uncertainties.some(x => typeof x !== 'string') || typeof value.next_action !== 'string' || typeof value.reply !== 'string' || !value.reply.trim()) throw new LabError('structured_invalid', 'Model response contract has invalid facts or reply');
  // Metadata matching is only a format/configuration check, not proof about the reply.
  return { text: value.reply, metadata: { ...value, reply: undefined }, semanticVerified: false };
}
