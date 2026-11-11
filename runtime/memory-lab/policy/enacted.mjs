import { composedContract, decodeComposedReply } from './composed.mjs';
import { LabError } from '../pi/store.mjs';

const PLAN_FIELDS = Object.freeze(['target', 'operation', 'completion_cue', 'persona_choice', 'reason']);
const TOP_LEVEL_FIELDS = Object.freeze([
  'self_name', 'speaking_style', 'can_web_search', 'can_schedule_notifications',
  'can_attend_in_person', 'approved_facts', 'uncertainties', 'next_action', 'support_plan', 'reply',
]);

/** A separately versioned, single-call contract; no scenario or answer lookup. */
export function enactedContract(persona, capabilities, prompt) {
  const format = composedContract(persona, capabilities, prompt);
  const descriptions = {
    target: '이번 요청에서 사용자가 직접 다룰 구체적인 대상 하나를 짧게 적는다. 현재 질문과 자료에서 사용할 수 있는 대상만 고르고, 필요하지만 보유 여부를 모르면 조건을 밝힌다. 사용자에게 없는 물건·자료·과거 경험을 있다고 단정하지 않는다.',
    operation: '그 대상에 대해 지금 혼자 할 수 있는 작은 동작 하나를 짧게 적는다. 준비하기·연습하기·확인하기라는 방향만 쓰지 말고 무엇을 어떻게 찾거나 움직이거나 말하거나 비교할지 정한다. 손동작은 해당 작업에 필요한 경우에만 고른다. 외부 기능 요청이 불가능해도 사용자가 걱정하는 실제 작업을 돕는 동작을 고른다.',
    completion_cue: '사용자가 그 작은 시도를 마친 것을 알아볼 수 있는 관찰 가능한 상태를 짧게 적는다. 동작의 대상과 결과에 연결하고 임의의 횟수·시간 제한이나 숙련·성공 보장을 만들지 않는다.',
    persona_choice: `운영자가 정한 현재 역할: ${persona.role ?? ''}\n이 역할이 이번 요청에서 어떤 작은 선택을 어떤 태도로 돕는지 짧게 적는다. 역할의 선택 기준을 실제 행동과 설명에 적용한다. 이름이나 성격 명칭을 반복하는 자기소개로 대신하지 않는다. 운영자에게 없는 성격을 추가하거나 말투만으로 성격을 표현했다고 간주하지 않는다.`,
    reason: '고른 동작이 사용자가 실제로 말한 부담이나 작업을 어떻게 돕는지 짧게 적는다. 막연한 큰 도움·자신감·성공 보장 대신 동작과 관련된 이유를 쓴다. 승인되지 않은 개인사·의학적 효과·외부 사실을 덧붙이지 않는다.',
  };
  const supportPlan = {
    type: 'object',
    description: '사용자에게 표시할 작은 도움의 표현 계획이다. 긴 사고 과정이나 자기평가가 아니라 각 항목을 짧은 구절로 작성한다. 질문에 행동 제안이 필요 없으면 관련 항목은 빈 문자열이어도 된다. 현재 질문·운영자 역할·승인된 기억·실제 기능만 사용한다. 이 계획은 사용자에게 보이지 않으므로 계획만 구체적이고 reply가 일반 권유이면 요청을 이행한 것이 아니다.',
    properties: Object.fromEntries(PLAN_FIELDS.map(name => [name, { type: 'string', description: descriptions[name] }])),
    required: [...PLAN_FIELDS],
  };
  const { reply, ...metadata } = format.schema.properties;
  // Property order records the requested layout; it does not prove reasoning order.
  format.schema.properties = { ...metadata, support_plan: supportPlan, reply };
  format.schema.required = Object.keys(format.schema.properties);
  reply.description += '\n숨겨진 support_plan은 표시 답변을 대신하지 않는다. 실제 도움을 요청받았으면 선택한 대상·동작·필요한 끝표시·이유를 reply.next_step에 자연스러운 문장으로 직접 표현한다. 성격은 역할 명칭을 되풀이하기보다 선택과 태도에 드러낸다.';
  const parts = reply.properties;
  parts.identity.description += '\n이름만 요청받았으면 자기 이름을 짧게 밝히고 역할 소개를 반복하지 않는다. 역할 소개도 요청받았을 때만 도움 방식을 간결하게 설명한다. 성격 명칭을 말하는 것으로 실제 도움을 대신하지 않는다.';
  parts.acknowledgement.description += '\n이번에 표현된 부담만 짚고 이름이나 역할 소개를 다시 넣지 않는다. 불안한 사용자에게 성급한 낙관이나 장난을 강요하지 않는다.';
  parts.answer.description += '\n승인된 사용자 보고의 예정 정보와 방금 외부에서 확인한 사실을 구별한다. 외부 조회가 불가능하면 지금 개최 여부를 확인했다고 표현하지 않는다. 질문에 필요 없는 일시나 역할 설명을 반복하지 않는다. 기능의 한계를 답한 뒤에도 요청된 실제 작업 도움은 next_step에 남긴다.';
  parts.next_step.description += '\nsupport_plan에서 고른 구체적인 대상과 작은 동작, 그 동작이 요청된 부담을 덜어 주는 이유를 이 표시 문장에도 직접 쓴다. 필요한 경우 사용자가 시도의 끝을 알아볼 수 있는 상태를 자연스럽게 포함한다. 단순히 연습하자·작은 목표부터 시작하자고 말하거나 계획만 채우지 않는다. 이번 역할의 실제 선택과 태도를 드러내되 역할 명칭을 반복하지 않는다. 행동이 불필요한 사실 질문에는 빈 문자열로 두어도 된다.';
  format.schema.properties.next_action.description = '행동이 필요하면 support_plan에서 고른 동일한 작은 행동과 이유를 짧게 적는다. 별개의 일정 확인이나 새로운 동작을 추가하지 않는다. 필요한 행동은 reply.next_step에도 직접 표현하며, 행동이 불필요하면 빈 문자열.';
  return format;
}

/** Validate format, preserve model wording, and reuse the unchanged v8 renderer. */
export function decodeEnactedReply(raw, persona, capabilities) {
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new LabError('structured_invalid', 'Model response was not a JSON object'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== TOP_LEVEL_FIELDS.length
    || TOP_LEVEL_FIELDS.some(name => !Object.hasOwn(value, name))) {
    throw new LabError('structured_invalid', 'Enacted response contract fields differ');
  }
  const supportPlan = value.support_plan;
  if (!supportPlan || typeof supportPlan !== 'object' || Array.isArray(supportPlan)
    || Object.keys(supportPlan).length !== PLAN_FIELDS.length
    || PLAN_FIELDS.some(name => !Object.hasOwn(supportPlan, name) || typeof supportPlan[name] !== 'string')) {
    throw new LabError('structured_invalid', 'Support plan requires exactly five string fields');
  }
  const { support_plan, ...composed } = value;
  const decoded = decodeComposedReply(JSON.stringify(composed), persona, capabilities);
  return { ...decoded, metadata: { ...decoded.metadata, support_plan }, semanticVerified: false };
}
