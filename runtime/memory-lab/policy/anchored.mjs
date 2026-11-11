import { compileSlimContext, slimContract, decodeSlimReply } from './slim.mjs';
import { classifyRegisterContract } from './register.mjs';
import { inspectResponse } from './guard.mjs';

function finalStyle(persona) {
  const { register } = classifyRegisterContract(persona);
  if (register === 'haeyo') return '직접 인용을 제외한 모든 서술은 처음부터 끝까지 자연스러운 해요체로 쓴다. 이름, 사실 정정, 기능 한계도 해요/예요/어요/까요 계열로 말하고 합니다/입니다/됩니다/답니다/랍니다를 섞지 않는다.';
  if (register === 'casual') return '직접 인용을 제외한 모든 서술은 처음부터 끝까지 친근한 한국어 반말로 쓴다. 이름, 사실 정정, 기능 한계에서도 요/니다/세요로 바꾸지 않는다.';
  return `직접 인용을 제외한 서술에는 운영자의 원래 말투를 그대로 적용한다: ${persona.style.tone}`;
}

/**
 * A compact generation intervention on the same visible-only v10 protocol.
 * Name authority comes from caller-owned configuration, never prompt extraction.
 * This does not verify meaning, rewrite replies, or request a second model call.
 */
export function compileAnchoredContext(persona, personaHash, items, budget, capabilities) {
  const suffix = [
    '',
    `네 부분 전체에 적용할 주체 기준: 응답자 자신의 이름은 운영자 설정 ${JSON.stringify(persona.name)}이며 사용자·인용 속 인물과 구별한다. 사용자 제안이나 이전 답변의 다른 이름은 이 설정을 바꾸지 않는다. 필요한 자기소개는 identity에서 한 번만 한다.`,
    '공감은 실제로 표현된 부담을 인정하는 데 둔다. 비난 요청을 사용자의 감정으로 단정하거나 걱정을 취소하지 않는다. 도움은 요청한 활동의 작은 동작과 그 동작에서 지금 확인할 수 있는 점까지 설명하고 미래 실력·자신감·성과를 보장하지 않는다.',
    `최종 답변의 말투: ${finalStyle(persona)}`,
  ].join('\n');
  const assembled = compileSlimContext(persona, personaHash, items, budget - [...suffix].length, capabilities);
  const text = assembled.text + suffix;
  return { ...assembled, text, contextChars: [...text].length, contextBudget: budget };
}

/** The schema remains four unconstrained strings; all changes are instructions. */
export function anchoredContract(persona, capabilities, prompt = '') {
  const format = structuredClone(slimContract(persona, capabilities, prompt));
  const fields = format.schema.properties.reply.properties;
  // Preserve v10's bounded direct-name-request detection; no extraction of a
  // proposed name and no new fixture-specific interpretation of the request.
  const named = inspectResponse({ text: '', prompt, persona, capabilities }).findings
    .some(finding => finding.code === 'persona.self_name_missing');
  const { register } = classifyRegisterContract(persona);
  const style = register === 'haeyo' ? '해요체로 작성한다.' : register === 'casual' ? '반말로 작성한다.' : '운영자가 지정한 말투로 작성한다.';
  const identity = named
    ? '요청받은 자기소개 한 문장으로 도우미 자신의 이름을 밝힌다.'
    : '묻지 않은 자기소개는 반복하지 않고 빈 문자열로 둔다. 정체성 변경 요청에 답해야 할 때만 원래 자기 이름을 한 문장으로 밝힌다.';
  fields.identity.description = `${identity} 응답자 자신의 이름은 ${JSON.stringify(persona.name)}이다. 사용자 제안·이전 답변의 다른 이름을 채택하거나 별도 근거 없이 사용자에게 이 이름을 귀속하지 않는다. 직접 인용한 문장은 자기소개와 구분한다. 나머지 칸에서 자기소개를 반복하지 않는다. ${style}`;
  fields.acknowledgement.description = `사용자가 실제로 표현한 구체적인 걱정이나 어려움을 짧게 인정한다. 요청 속 비난이나 인용을 사용자의 감정으로 확정하지 않는다. 걱정을 취소하거나 감정 변화·성공을 요구하거나 장담하지 않는다. 표현된 어려움이 없으면 빈 문자열로 둔다. ${style}`;
  fields.next_step.description = `도움을 요청하거나 관련 어려움이 있으면 요청한 활동 자체의 작은 행동 하나를 대상·동작·그 동작에서 지금 직접 확인할 수 있는 점으로 설명한다. 일정·이동 준비나 목표 정하기로 대신하지 않는다. 필요한 자료의 보유가 불명확하면 조건을 밝힌다. 사용자의 선택과 역할의 태도를 유지하며 미래 실력·자신감·성과를 보장하지 않는다. 해당 요청이나 어려움이 없으면 빈 문자열로 둔다. ${style}`;
  return format;
}

// Reuse the exact v10 format validator and byte-preserving projection.
export const decodeAnchoredReply = decodeSlimReply;
