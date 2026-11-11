# 기억 근거·정체성·출력 교정 조사 및 제한적 guard 구현

확인일: **2026-11-11**. 작업 범위: 이 프로젝트의 Elda-CLI 모드 ② 자체 하네스. 외부 프레임워크 전체를 이식한 결과가 아니라, 논문과 공식 문서의 설계 근거를 읽고 현재 Pi 경로에 연결할 수 있는 독립 출력 검사 모듈을 구현한 기록이다. 이 조사 담당자의 모델 API 호출은 **0회**이며 외부 SDK 설치·서비스 실행·reference 내부 쓰기를 하지 않았다. 실제 HCX 실행 결과는 root가 작성하는 별도 live 보고서로 구분한다.

## 1. 이번 개선의 결론

현재 병목은 기억 저장소의 부재보다 **올바른 기억이 주입되어도 모델이 주체·사건 종류·실제 능력을 바꾸어 말하는 현상**이다. 따라서 이번 변경은 다음 경계를 분리한다.

1. 운영자 페르소나와 실제 런타임 기능은 권한 있는 설정이다. 사용자 발화·검색 결과·기억은 이 설정을 덮어쓰는 명령이 아니다.
2. 기억에 날짜·장소가 맞게 저장되어 있다는 사실은 모델의 사건 설명까지 맞다는 증명이 아니다. “준비 모임”을 “행사 개최”로 바꾸는 오류는 날짜 일치로 통과시키지 않는다.
3. 제한된 결정론 검사는 명확한 위반의 원문 근거를 제시하고, 애매한 의미 판단은 경고에 남긴다. 위반이 발견되지 않은 답변을 성격·사실성 성공으로 집계하지 않는다.
4. 교정은 같은 대화 맥락에서 원문·운영자 설정·활성 기억을 근거로 **최대 한 번** 수행하도록 caller가 제한한다. 교정 후에도 원문과 잔여 위반을 보존한다. 이름 접두사나 고정 답변을 붙여 성공을 만들어 내지 않는다.

이 네 가지는 아래 자료를 종합한 **이번 프로젝트의 구현 판단**이며 특정 논문이 HCX-005의 한국어 성격 유지 효과를 입증했다는 뜻이 아니다.

## 2. 기존 실험·저장소에서 확인한 사실

[`PERSONA-FOLLOWUP-RESULTS-2026-11-10.md`](../../PERSONA-FOLLOWUP-RESULTS-2026-11-10.md)의 대응 가능한 38쌍 비교에서는 이름 충분 응답이 10/19→10/19, 말투 15/38→19/38, 성격 23/38→23/38이었다. 명시 지시만 추가한 결과를 성격 유지의 해결로 선언할 근거가 부족하다. 해당 보고서의 사례에는 다음처럼 구분해야 할 실패가 있다.

- “네 이름은 루리야!”: persona 이름의 문자열은 있으나 사용자의 이름으로 진술한다.
- “전시는 … 열린다”: 저장된 준비 모임의 날짜·장소를 맞히면서 사건을 개최로 바꾼다.
- “미리 알려주고”, “금요일에 만나”: 실제 알림·신체가 없는 실행에서 사후 알림이나 참석을 암시한다.
- “지난번 모임 때”: 주입 자료에 없는 공동 경험을 만든다.

이 문장의 고유 이름·날짜·장소는 guard 규칙이나 교정 정답으로 넣지 않았다. 검사 대상 이름은 `persona.name`, 능력은 caller의 boolean, 사건 경고는 활성 기억의 값에서 가져온다.

[`pi/store.mjs`](pi/store.mjs)는 principal/persona/scope/conversation별 SQLite 네임스페이스, evidence digest/pointer, 승인된 tuple, active/superseded revision을 가진다. `kind/slot/thing/value/polarity`는 구분되지만 `value` 자체는 자유문장이다. 관찰 원문 전문은 보존하지 않으며 digest와 포인터가 출처 연결 역할을 한다. 따라서 **digest만으로 문장 의미를 다시 읽거나 검증할 수 없다**. 사건별 행위자·역할·발생 시각·유효 시각의 추가 구조화는 후속 설계이며 이번 guard가 저장소에 조용히 새로운 사실을 합성하지 않는다.

## 3. 1차 자료와 적용 판단

### MemGPT: 메모리 계층은 컨텍스트 수명 문제를 다룬다

MemGPT는 제한된 모델 컨텍스트에서 계층 간 데이터 이동과 제어 흐름을 관리하는 가상 컨텍스트 구조를 제안한다. 문서 분석과 여러 세션 대화를 평가하지만, 운영자 정체성의 불변성이나 한국어 주체 보존을 자동 보장하는 장치는 아니다. 짧은 근거: “virtual context management”. [논문, 2023/2024](https://arxiv.org/abs/2310.08560)

적용 판단: 장기 저장과 컨텍스트 편성은 별도 역할로 유지한다. 더 긴 기억을 넣는 변경만으로 persona 성공을 주장하지 않는다. 페르소나 anchor 우선순위와 회상 예산을 caller가 통제하고, 실제로 모델에 들어간 기억 snapshot을 기록한다.

### Letta: persona/human 분리와 읽기 전용 소유권

Letta V1 SDK 문서는 사용자 정보를 `human`, 조수 정체성을 `persona` block으로 분리하는 구성을 권한다. block은 기본적으로 수정 가능하며 `read_only: true`로 모델의 변경을 막을 수 있다고 명시한다. 짧은 근거: “Memory blocks are read-write by default”. [V1 memory blocks 공식 문서](https://docs.letta.com/v1-sdk/memory/memory-blocks)

적용 판단: 모델에게 “페르소나를 바꾸지 마”라고만 요청하지 말고 운영자 원본을 수정할 수 없는 경계를 유지한다. 사용자 이름을 저장하는 기억과 assistant 이름을 같은 문장 영역에서 섞지 않는다. **이 문서는 V1 SDK 경로**이며 최신 Agent SDK memory와 동일 API라고 주장하지 않는다. 현재 Agent SDK도 별도 문서를 제공한다. [Agent SDK memory](https://docs.letta.com/agent-sdk/memory)

### Mem0: 무엇을 추출하는지와 무엇을 믿는지는 별도다

Mem0 공식 설명은 메시지에서 기억을 추출하고 식별자·metadata로 검색 범위를 구성하는 흐름을 제시한다. `infer=False`는 그대로 저장하는 방식이며 의미 추출 품질을 검증한 결과가 아니다. 현재 문서는 additive storage와 중복 가능성도 설명한다. [Add Memory](https://docs.mem0.ai/core-concepts/memory-operations/add)

Custom instructions 문서는 좁은 사실 유형과 양성·음성 예시를 권하고, 넓은 지시가 무관한 사실을 섞을 수 있다고 설명한다. 기존 `custom_fact_extraction_prompt` 이름이 `custom_instructions`로 바뀌었다고 명시한다. [Custom instructions](https://docs.mem0.ai/open-source/features/custom-instructions)

적용 판단: 추출기에서 user/assistant/entity, 사건의 종류·주체·상태를 분리하는 실험은 가치가 있다. 그러나 추출 결과는 후보이며 기존 승인·근거 검사 경로를 통과해야 한다. 문서의 최신 설정명과 로컬 설치 버전의 API는 별도로 확인해야 한다. 이번에는 Mem0를 설치하거나 실행하지 않았고 추출 정확도를 보고하지 않는다.

### Graphiti: 과거 값과 현재 값, 사건의 출처를 함께 보존한다

Graphiti 공식 README는 fact의 validity window, 변경된 사실의 invalidation, episode provenance, 사용자 정의 entity/edge type을 설명한다. 짧은 근거: “old facts are invalidated — not deleted”. 추출·중복 제거에는 구조화 출력 신뢰성이 필요한데 provider와 작은 모델에 따라 달라질 수 있다고 명시한다. [공식 저장소](https://github.com/getzep/graphiti)

적용 판단: 기존 active/superseded 구조를 유지한 채 나중에 `observed_at`과 사실의 `valid_from/valid_to`를 분리하는 근거가 된다. 날짜를 정정한 응답에 옛 날짜 문자열이 등장하더라도 그것이 **거부된 과거값인지 현재 주장인지**를 구분해야 한다. 그래프 조회가 맞더라도 최종 자연어의 사건 종류 보존은 따로 평가해야 한다. 이번 단계에서 graph DB나 자율 추출기를 추가하면 운영 범위가 커져 비교가 흐려지므로 도입하지 않았다.

### Chain-of-Verification: 검증 질문을 초안과 분리한다

CoVe는 초안 작성, 검증 질문 계획, 독립적인 질문 답변, 최종 응답 생성의 단계를 제안한다. 짧은 근거: “answers those questions independently”. 논문은 여러 사실형 과제에서 hallucination 감소를 보고한다. [논문, 2023](https://arxiv.org/abs/2309.11495)

적용 판단: “맞지?”라는 자기 확인 대신 위반한 규칙과 근거를 명시한다. 다만 이번 구현은 여러 독립 검증 질문을 생성·답변하는 CoVe 전체를 구현하지 않았다. 운영 비용과 원래 답변 보존을 위해 deterministic finding→최대 한 번의 repair 경로만 선택했다. 이를 CoVe의 실험 수치와 동급으로 설명하지 않는다.

### RARR: 근거를 찾고 원래 답변을 가능한 한 보존한다

RARR는 생성된 주장에 외부 근거를 찾고, 뒷받침되지 않는 내용을 수정하되 원래 답변을 가능한 한 유지하는 방법을 제안한다. 짧은 근거: “preserving the original output as much as possible”. [논문, ACL 2023](https://arxiv.org/abs/2210.08726)

적용 판단: 사건 종류와 말투를 모두 새로 만드는 재작성보다 잘못된 주장만 고친다. 이번 실행에는 웹 검색 기능이 없으므로 RARR식 웹 조사 시스템을 구현했다고 하지 않는다. 교정 근거는 실제 운영자 persona, runtime capabilities, 활성 승인 기억으로 제한한다. 출처가 없는 내용을 채워 넣는 fixed template도 사용하지 않는다.

### 자기 교정의 실패 경계

Huang 외의 ICLR 2024 연구는 외부 feedback 없는 intrinsic self-correction을 reasoning 과제에서 평가하며, 일부 경우 교정 후 성능이 더 나빠지는 현상을 보고한다. 짧은 근거: “performance even degrades after self-correction”. 이 결과를 모든 모델·모든 persona 과제의 불가능성으로 확대해서는 안 된다. [논문](https://arxiv.org/abs/2310.01798)

적용 판단: 같은 HCX가 쓴 답변을 같은 HCX에게 막연히 다시 보라고 하는 것은 독립 검증이 아니다. 교정 시 runtime에서 얻은 실제 근거를 제공하고, 원문/교정문/잔여 finding/추가 비용을 별도 보존한다. 교정 응답도 다시 검사하되 재교정을 반복하지 않는다. 독립 의미 평가에서 교정으로 생긴 퇴행을 반드시 센다.

### NeMo Guardrails: evidence grounding과 자기 일관성은 다르다

NeMo 공식 fact-checking 문서는 `relevant_chunks`를 근거로 응답의 entailment를 평가하는 경로를 설명한다. 또한 이 rail의 성능은 검사 LLM이 지시를 따르는 능력에 강하게 의존한다고 명시한다. 짧은 근거: “strongly dependent on the capability of the LLM”. 고온 재생성 사이의 일관성을 보는 hallucination rail과, 실제 검색 근거에 맞추는 fact-checking rail은 서로 다르다. [공식 문서](https://docs.nvidia.com/nemo/guardrails/latest/configure-guardrails/guardrail-catalog/fact-checking)

적용 판단: 같은 거짓말을 반복한다고 정확한 것은 아니다. 지시 수행이 약했던 모델에 judge 역할까지 주는 설계의 한계를 기록한다. 별도 NLI/grounding 모델이나 강한 judge를 붙이는 후속 실험은 가능하지만 그 모델의 한국어 오탐·미탐·비용을 먼저 측정해야 한다. 이번 guard는 NeMo 설치 없이 우리 runtime 계약에 맞춘 최소 모듈이다.

### LangChain guardrails: 규칙과 모델 검사의 서로 다른 비용

공식 문서는 실행 전후와 model/tool call 주변의 middleware 위치를 구분한다. 결정론적 규칙은 빠르고 비용이 낮지만 뉘앙스 위반을 놓칠 수 있고, 모델 기반 검사는 의미를 더 다룰 수 있지만 비용·지연이 추가된다고 설명한다. [공식 guardrails 문서](https://docs.langchain.com/oss/python/langchain/guardrails)

적용 판단: 출력 검사와 tool approval을 혼동하지 않는다. 출력 검사에 통과했다고 도구 실행 권한이 생기지 않는다. 기존 tool/memory 승인 경로는 caller의 별도 권한 검사로 유지하고, guard는 순수 함수로 두어 어느 framework에서도 같은 입력으로 비교할 수 있게 한다.

### LLM-as-a-judge: 평가자는 절대적인 정답 장치가 아니다

MT-Bench/Chatbot Arena 연구는 LLM judge의 position, verbosity, self-enhancement bias와 reasoning 한계를 분석한다. [논문, NeurIPS 2023](https://arxiv.org/abs/2306.05685)

2026년 연구는 여러 모델·벤치마크에서 스타일·길이·순서 등 평가 편향을 비교한다. 논문의 조건별 결과를 이번 작은 한국어 실험의 정확도 수치로 전용하지 않는다. [Judging the Judges, 2026](https://arxiv.org/abs/2604.23178)

적용 판단: variant 이름과 교정 여부를 숨긴 상태에서 초안과 교정문을 따로 평가하고, 인용 근거를 남긴다. 이름·말투·성격·사건·현재값·능력·공감·실용성을 분리한다. 한 AI 평가자를 두 명의 인간 평가자처럼 기록하거나 평가자 간 신뢰도를 계산하지 않는다. 이름 접두사·문장 종결형·이모지만 늘어난 답변을 성격 개선으로 집계하지 않는다.

## 4. 구현 계약

파일: [`policy/guard.mjs`](policy/guard.mjs), [`policy/guard.test.mjs`](policy/guard.test.mjs).

```js
inspectResponse({
  text, prompt, persona, memories,
  capabilities: { webSearch, notifications, physicalPresence },
  requirements: { selfName },
});
// -> { ok, findings, repairNeeded, limitations }

buildRepairPrompt({ inspection, persona, memories, capabilities });
// -> high-confidence error가 있으면 수정 지시 문자열, 없으면 ''
```

- `ok`는 **현재 구현한 high-confidence error가 없다**는 뜻이다. 의미 정확성 또는 인격 일관성 인증이 아니다.
- finding은 `code/severity/confidence/evidence/source/rule`을 제공한다. `error + high`만 `repairNeeded`를 켠다.
- 이름 요구는 caller가 명시하거나 좁은 자기 소개 질문에서 추론한다. 다른 이름의 단순 언급, AI 공개, 인용문만으로 정체성 전환 오류를 만들지 않는다.
- 실제 능력 flag가 `false`인 경우만 명시적 실행·약속을 검사한다. 누락된 flag는 알 수 없는 상태로 취급한다.
- 코드·인용문·부정·타인 행동·사용자가 직접 설정하는 안내를 구분하는 제한적인 한국어 표면 규칙을 사용한다.
- 자유문장 사건의 단계 수식어가 사라진 의심은 `memory.event_type_possible_drift` **warning**만 낸다. 사건 종류 전체를 검증하는 기능은 아니다.
- 빈 모델 응답은 `response.empty` error다. caller는 이 결과를 정상 완료로 삼으면 안 된다.
- 모듈 자체는 API 호출·파일 I/O·기억 변경·응답 생성·반복 repair를 하지 않는다. repair 상한, 도구 제거, pacing, 로그 보존, unresolved 처리와 실제 caller 통합은 root 책임이다.

## 5. 실제 로컬 검증 결과

실행: `node --test runtime/memory-lab/policy/guard.test.mjs`

**20개 test 모두 통과.** 정상·오류의 양방향 예제와 독립 리뷰에서 제시한 다음 오탐을 회귀에 포함했다.

| 입력 특성 | 처리 |
|---|---|
| 자기 이름 질문에 사용자 이름으로 답하기 | 높은 신뢰도의 위반 |
| 이름 문자열만 언급하고 자기 진술이 불확실함 | warning, 성공 증거로 사용 금지 |
| 따옴표 안의 자기 이름 또는 모델명 공개와 persona 병기 | 허용 또는 보수적 warning |
| 인용된 잘못된 실행 약속, 사용자용 알림 설정법 | 실행 약속으로 차단하지 않음 |
| “제가 검색한 결과는 아니에요.” | 부정으로 처리 |
| “빛나는 동료가 검색한 결과예요.” | 단어 내부 `나는`를 1인칭으로 인식하지 않음 |
| “그럼 내일 또 채팅으로 만나자.” | 물리적 참석으로 차단하지 않음 |
| “제가 검색했어요? 아니요, …” | 질문을 확정적 자기 실행 주장으로 차단하지 않음 |
| 이름 질문 문장을 번역하는 메타 요청 | 자기 소개 요구로 추론하지 않음 |
| “검색해 줄게 버튼을 누르세요.” | 버튼 이름을 실행 약속으로 차단하지 않음 |

독립 평가 담당자의 사전 작성 fixture도 실제로 실행했다. [`policy/guard-fixture-results.json`](policy/guard-fixture-results.json)에 입력·expectedViolation·실제 finding·지원 여부·guard SHA-256을 저장했다.

- **지원 분류 10개 중 10개 통과, 실패 0개.**
- **말투(registerMismatch) 2개는 미지원**으로 기록했다. 정상 문장에 finding이 없다는 이유로 말투 checker가 통과했다고 세지 않았다.
- fixture는 사람이 작성한 local classifier 예제다. 실제 모델 출력 품질의 성공률이 아니다.
- 이번 테스트를 보고도 회귀 fixture 밖의 일반적 한국어 분포에서 precision/recall을 추정할 수 없다.

## 6. 남은 한계와 후속 비교

다음은 독립 감사에서 확인했지만 live 전 무한 규칙 확장을 피하기 위해 이번 버전에 추가하지 않은 미탐 예다. “내일 오후 두 시에 알려줄게”, “내가 참석할게”, “제가 인터넷에서 찾아드릴게요”처럼 다른 형태의 약속이 통과할 수 있다. 복합 부정·생략된 주체·인용을 채택하는 문장도 완전히 처리하지 않는다. 성격, 말투 전체, 공감 품질, 모임 경험 날조, 임의 사건의 정확한 현재 시각·장소는 이 guard의 지원 범위 밖이다.

후속 단계는 규칙에 특정 실험의 정답을 더 넣는 일이 아니다.

1. 새 transcript에서 명시적 자기 주장과 인용·부정·사용자 지시를 함께 수집하고, 규칙의 오탐/미탐을 분리한다.
2. 기존 승인 tuple에서 사건 유형·행위자·역할·시간·장소의 구조화 후보를 추출하되 원문 pointer와 승인 상태를 유지한다. 추출 모델의 출력이 authoritative fact가 되지 않도록 한다.
3. semantic checker를 추가할 때 claim별 원문 인용과 active memory의 대응 근거를 요구하고, 근거가 부족하면 `uncertain`으로 남긴다. judge와 generator를 같은 모델로 쓸 때의 독립성 한계를 보고한다.
4. baseline JSON / compiled prose / compiled+bounded repair의 동일 fixture 비교에서 draft와 final을 분리하고, 효과와 퇴행·차단률·비용·지연을 함께 보고한다.

이번 guard는 이 비교를 관찰 가능하게 만드는 최소 구현이다. 모델의 성격 유지 능력이 개선됐다는 최종 판단은 실제 live 응답의 독립 의미 평가 뒤에만 가능하다.

## 7. 후속 조사: NAVER 모델 선택과 독립 문체 변환

이 절도 2026-11-11 공식 문서 조회 결과다. 문서에서의 제공 여부와 실제 계정의 호출 권한·성능은 다르며, 조사 담당자가 해당 모델을 호출하거나 우열을 검증하지 않았다.

### 현재 확인 가능한 API 모델과 요청 차이

NAVER 공식 모델표는 `HCX-007`, `HCX-005`, `HCX-DASH-002`를 주요 라인업으로 소개하며, `HCX-003`, `HCX-DASH-001`도 비교표에 수록한다. 007은 하이브리드 추론, 005는 이미지 입력 가능한 멀티모달, DASH-002는 경량 텍스트 모델로 설명한다. 이 설명은 **007이나 DASH-002의 한국어 말투 유지가 더 좋다는 검증이 아니다**. [공식 모델표](https://guide.ncloud-docs.com/docs/clovastudio-model)

| 모델 | native 호출 경로 | 이번 비교에서 주의할 차이 |
|---|---|---|
| HCX-005 | `/v3/chat-completions/HCX-005` | 컨텍스트 128,000, 최대 출력 4,096. 기존 실험 모델 |
| HCX-DASH-002 | `/v3/chat-completions/HCX-DASH-002` | 컨텍스트 32,000, 최대 출력 4,096. 경량 renderer 비교 후보이나 효과 미검증 |
| HCX-007 | `/v3/chat-completions/HCX-007` | 컨텍스트 128,000, 최대 생성 32,768. 텍스트 전용, 튜닝 미지원. `maxCompletionTokens` 사용 |

005와 DASH-002의 native v3 경로와 한도는 [텍스트 및 이미지 API](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3), 007의 경로와 한도는 [Thinking API](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking)에서 확인했다. 007의 `thinking.effort`는 `none/low/medium/high`이며 기본값은 `low`다. `maxTokens`가 아니라 `maxCompletionTokens`를 사용한다. 추론 토큰도 생성 예산에 포함되므로 기존 005 요청에서 모델명만 교체하는 비교는 적절하지 않다.

오픈AI 호환 경로는 `/v1/openai/chat/completions`이며 `model: "HCX-007"`, `reasoning_effort: "none"`, `max_completion_tokens` 같은 snake_case 필드를 지원한다. 이는 NAVER의 호환 API 설명이며 별도 OpenAI 서비스 호출을 뜻하지 않는다. [NAVER 공식 호환표](https://api.ncloud-docs.com/docs/clovastudio-openaicompatibility)

007은 추론을 켜면 Function calling을 함께 사용할 수 없다. 기본 추론값 때문에 005에서 되던 도구 호출이 실패할 수 있으며 `reasoning_effort="none"` 설정 예시가 공식 문제 해결 문서에 있다. [생성 및 출력 문제](https://guide.ncloud-docs.com/docs/clovastudio-troubleshoot-generation)

### 문체 변환은 별도 작업으로 설명할 근거가 있다

NAVER 2024 기술밋업 자료 13쪽(0-index 12)은 paraphrase 작업에 원문의 의미를 유지하면서 표현만 다시 쓰는 시스템 지시를 제시하고, 문체 변환도 별도 작업으로 나열한다. [공식 발표 PDF](https://kr.object.ncloudstorage.com/material/4%EC%9B%94%20%ED%85%8C%ED%81%AC%EB%B0%8B%EC%97%85/2-1.navercloud_techmeetup_deck_april2024_F.pdf)

현재 공식 상품 설명도 문장 변환과 persona 챗봇을 각각의 사용 사례로 소개한다. 다만 소개 문구는 정량 성능 보장이 아니다. [CLOVA Studio 공식 상품 설명](https://www.ncloud.com/api-cms/service-product/static/clovaStudio)

현재 사용 가이드는 Playground에서 프롬프트 예제를 선택해 불러오는 경로를 안내하지만, 해당 공개 문서 본문에 모든 예제의 전체 프롬프트가 들어 있지는 않다. 따라서 접근하지 않은 console 예제를 읽거나 실행했다고 기록하지 않는다. [프롬프트 예제 안내](https://guide.ncloud-docs.com/docs/clovastudio-promptsample)

### fresh-context renderer는 검증할 가설이다

같은 대화의 “수정해 달라”는 후속 턴 대신, 새 요청에서 조수 역할을 **입력된 사실을 바꾸지 않는 문체 편집자**로 좁히는 방안은 위 문체 변환 사례에서 얻은 구현 가설이다. NAVER가 HCX의 동일 대화 교정보다 이 방식이 우수하다고 검증했다는 자료는 이번 조사에서 찾지 못했다.

비교 시 먼저 같은 HCX-005·같은 사실·같은 생성 설정으로 이전 대화 포함 여부를 분리해야 한다. 그 뒤 007이나 DASH-002를 넣어야 모델 교체와 context 변경의 효과를 혼동하지 않는다. renderer에 넘길 의미 근거는 실제 draft와 승인된 사실이어야 하며, 실험 정답을 하드코딩한 문장을 생성 결과로 집계하면 안 된다. 변환 뒤에도 이름의 주체, 사건 종류, 시각·장소, 기능 약속과 정보 누락을 다시 확인해야 한다.

## 8. 후속 구현: register 모듈의 문법 범위

별도 [`policy/register.mjs`](policy/register.mjs)는 운영자의 `style.tone`에서 명시적으로 긍정된 한국어 `casual/haeyo` 계약만 읽는다. “반말을 쓰지 않는다”, “반말 사용 금지”, “반말로 바꾸지 않는다”를 반말 선택으로 오인하지 않도록 검사한다. 일반적인 “존댓말”만으로 strict 해요체를 확정하지 않는다.

확실한 다어절 서술 종결형의 불일치만 high error이고 짧거나 중의적인 어미는 warning이다. 인용·코드·표·명사 목록·라벨은 제외하며 성격·감정·조롱을 판정하지 않는다. 이 모듈은 원래 guard를 수정하지 않고 후속 버전에서 합성할 수 있도록 독립적으로 작성했다.

v2 이후에는 “도와줍니다” 같은 활용형을 단어 목록으로 계속 추가하는 대신 **한글 마지막 음절의 종성 인덱스가 17(ㅂ)이고 뒤에 `니다/니까`가 오는지** 검사하도록 바꿨다. 코드에서 `(codePoint - 0xAC00) % 28 === 17`을 사용하며 `-습니다/-습니까/-십시오`도 별도로 인식한다. 같은 suffix가 이름·인용·버튼 라벨에 등장하는 오탐 회귀는 유지한다.

현재 독립 register 회귀는 `node --test runtime/memory-lab/policy/register.test.mjs` **18/18 통과**다. 이 수치는 실제 모델의 화계 유지 성공률이 아니며, 원래 guard의 20개 테스트와 서로 다른 검사 모듈의 결과다. v2 실행에 쓰인 이전 source와 새 규칙의 결과를 같은 버전으로 섞지 않아야 한다.
