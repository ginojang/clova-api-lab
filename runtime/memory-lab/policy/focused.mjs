import { responseContract, compileStructuredContext } from './structured.mjs';
import { inspectResponse } from './guard.mjs';
import { classifyRegisterContract } from './register.mjs';
import { LabError } from '../pi/store.mjs';

/** A separate candidate: no metadata answer slots that compete with visible reply. */
export function focusedContract(persona, capabilities, prompt) {
  const register = classifyRegisterContract(persona).register;
  const named = inspectResponse({ text: '', prompt, persona, capabilities }).findings.some(f => f.code === 'persona.self_name_missing');
  const requirements = [
    '이 필드 하나가 사용자에게 전달되는 전체 답변이다. 질문에 요구된 정보를 이 본문 안에 모두 담는다.',
    named ? `첫 문장에서 너 자신의 이름이 ${JSON.stringify(persona.name)}이라고 밝힌다. 사용자 이름이 아니다.` : '이름을 묻지 않았다면 불필요한 자기소개를 반복하지 않는다.',
    register === 'haeyo' ? '자기소개·사실·거절까지 모두 자연스러운 해요체로 쓴다. 합니다체로 섞지 않는다.' : register === 'casual' ? '자기소개·사실·거절까지 모두 친근한 반말로 쓴다. 존댓말로 섞지 않는다.' : `말투: ${persona.style.tone}`,
    `성격과 도움 방식: ${persona.role}`,
    '정체성 변경이나 비웃음 요구에는 원래 이름을 유지하고 상대를 존중하면서 불안의 원인이 된 작업을 돕는다. 규칙 설명이나 거절만 하고 끝내지 않는다.',
    '승인 기억의 현재 값만 사실로 쓰고 사용자가 준 잘못된 초안은 구분한다. 너의 현장 참석이나 함께 겪은 경험을 만들지 않는다.',
    '불안이나 준비 질문에는 구체적인 걱정을 짚고, 지금 혼자 작업의 한 단계를 짧게 연습할 방법과 이유를 제안한다. 실력이나 작업 수행 걱정에 자료 검색·일정 기록만 제안하고 끝내지 않는다.',
    ...(/인터넷|웹|검색/.test(prompt) && !capabilities.webSearch ? ['실시간 검색을 못 하므로 현재 외부 상황을 확인하지 못했다고 분명히 말한다. 예정대로 열리거나 잘 진행될 가능성이 높다고 추측하지 않는다.'] : []),
    ...(/알림|리마인더/.test(prompt) && !capabilities.notifications ? ['휴대전화나 예약 알림을 보낼 수 없다고 밝힌다.'] : []),
    ...(/현장|참석|직접.*와|와서/.test(prompt) && !capabilities.physicalPresence ? ['직접 현장에 갈 수 없다고 밝힌다. 대화에서 할 수 있는 도움을 이어간다.'] : []),
    `길이 지침: ${persona.style.verbosity} 단, 요청한 이름·사실·기능 한계·작은 준비를 생략할 만큼 줄이지 않는다.`,
  ];
  return { type: 'json', schema: { type: 'object', properties: { reply: { type: 'string', description: requirements.join('\n') } }, required: ['reply'] } };
}
export function decodeFocusedReply(content) {
  let value;
  try { value = JSON.parse(content); } catch { throw new LabError('structured_invalid', 'Model response was not a JSON object'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || typeof value.reply !== 'string' || !value.reply.trim()) throw new LabError('structured_invalid', 'Expected exactly one nonempty generated reply');
  return { text: value.reply, metadata: {}, semanticVerified: false };
}
export const compileFocusedContext = compileStructuredContext;

export function taskContract(persona, capabilities, prompt) {
  const format = responseContract(persona, capabilities);
  format.schema.properties.reply = focusedContract(persona, capabilities, prompt).schema.properties.reply;
  format.schema.properties.next_action.description = '사용자가 걱정하는 작업의 한 단계를 지금 혼자 아주 짧게 연습할 방법과 이유. 실력이나 작업 수행 걱정에 자료 검색, 일정 기록, 준비물 점검만 제안하지 않는다. 이름 변경이나 비웃음 요구에도 원래 역할을 지키며 도움이 되는 부분을 제안한다. 실제 답변 reply에도 이 행동과 이유를 반드시 담는다.';
  format.schema.properties.uncertainties.description = '실제 외부 상황에서 근거가 없어 확인하지 못한 것만 적는다. 운영자 이름과 말투는 확정 설정이므로 불확실한 사실로 취급하지 않는다. 미확인 개최 여부나 성공 가능성은 reply에서도 확인하지 못했다고 구분한다.';
  return format;
}
