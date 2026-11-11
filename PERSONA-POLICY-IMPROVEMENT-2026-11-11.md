# 외부 근거에 기반한 기억·페르소나 하네스 개선

작업일: 2026-11-11. 작업 경로: `/home/gino/WorkArea/clova-api-lab` 내부만. 대상은 Elda-CLI 모드 ②에 연결할 독립 Pi CLI 하네스와 기존 CLOVA Brain 어댑터다. reference와 자매 프로젝트 파일은 수정하지 않았다.

이 보고서의 10회차·216호출 집계는 종료된 이전 실험 범위다. 이후 같은 HCX-007에서 v8과 enacted-v9를 비교한 구현·평가·커밋 기록은 [후속 보고서](PERSONA-CONTINUATION-2026-11-11.md)에 구분한다.

**결론:** 실제 API 비교 10회차와 개발 probe를 수행해 최신 `HCX-007 + composed-v8`에서 이름·말투·기억의 최신 값·공감·구체적 도움 개선을 확인했다. 마지막 새 상황에서 독립 AI 두 명 모두 이름 6/8→8/8, 말투 4/8→7/8, 최신 값 1/2→2/2, 공감 0/6→6/6, 구체적 도움 1/4→2/4로 평가했다. 다만 성격은 주 평가 7/8→8/8, 두 번째 평가 6/8→6/8로 달랐다. 따라서 **개선된 실험 후보로 제공하되, 두 평가 모두 통과해야 하는 전체 확인 기준은 미달**이다. 기본 정책이나 운영 하네스로 승격하지 않았고, 실제 Elda-CLI 등록·새 정책 웹 배포도 완료한 것으로 표시하지 않는다. 직접 시험하는 명령은 [정책 CLI 사용법](runtime/memory-lab/policy/README.md)에 있다.

## 1. 연구 범위와 구현 결정

세 에이전트가 페르소나, 기억·검사, 평가 방법을 병렬 조사했다. 중복 버전·PDF·저자 코드를 별도 논문으로 부풀리지 않으면 연구 문서 세 개에 **논문 16편과 공식 문서·소스 10개**가 정리되어 있다. 추가로 Anthropic의 context engineering 공식 글을 확인했다. 논문이 HCX-005의 한국어 품질을 보장한다는 해석은 하지 않는다.

- [페르소나 연구](runtime/memory-lab/research-2026-11-11-persona.md): NAVER, RoleBench, PersonaGym, CharacterEval, DMT-RoleBench, Self-Refine, 지시 계층, 긴 문맥과 평가 편향.
- [기억·교정 연구](runtime/memory-lab/research-2026-11-11-memory.md): MemGPT/Letta, Mem0, Graphiti, CoVe, RARR, NeMo, LangChain, 자기 교정과 judge 편향.
- [평가 설계 연구](runtime/memory-lab/research-2026-11-11-eval.md): IFEval, JSONSchemaBench, G-Eval과 독립 의미 평가·실패 분모.

핵심 설계의 외부 근거와 실제 적용:

| 근거 | 적용 | 확대해서 주장하지 않은 부분 |
| --- | --- | --- |
| [NAVER Chat Completions v3](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3) | 역할·기능·기억 정책을 하나의 system에 구성 | system 지원이 지시 준수 보장은 아님 |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 간결한 직접 지시와 목적별 구분, 선택 기억 예산 유지 | JSON보다 산문이 항상 우수하다는 근거는 아님 |
| [Letta memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks) | 사용자 정보와 조수 정체성의 소유권 분리 | Letta SDK를 설치·통합한 것은 아님 |
| [LangChain guardrails](https://docs.langchain.com/oss/python/langchain/guardrails) | 생성 뒤 제한된 검사→필요 시 교정→재검사 | 정규식 검사를 의미 평가로 취급하지 않음 |
| [Self-Refine](https://arxiv.org/abs/2303.17651), [Self-Correction 한계](https://arxiv.org/abs/2310.01798) | 실제 설정에서 나온 위반 근거를 제공, 최대 1회 수정 | 무조건 좋아진다고 가정하지 않고 퇴행도 평가 |
| [PersonaGym](https://arxiv.org/abs/2407.18416), [MT-Bench](https://arxiv.org/abs/2306.05685) | 이름·말투·성격·사건·최신성·능력·공감·도움을 따로 평가 | AI 검토를 사람 평가나 객관적 완전 정답으로 표시하지 않음 |

## 2. 실제 변경

기존 `JSON.stringify(persona)` anchor를 보존한 채 비교 가능한 정책 옵션을 추가했다. [Pi CLI](runtime/memory-lab/pi/cli.mjs)는 실제 Pi SDK agent loop와 기존 Brain API 경로를 사용한다.

1. **문장형 역할 구성**: 조수 자신의 이름과 사용자 이름을 구분하고, 말투·역할·경계를 직접 지시한다. 실제 설치 기능으로 capability 목록을 만든다. 현재 artifact 도구는 웹 검색·예약 알림을 제공하지 않는다.
2. **기억 근거 보존**: 승인 기억의 종류·대상·값·부정 여부·revision·출처를 함께 전달한다. 컨텍스트 예산이 부족하면 완전한 레코드 단위로 생략하고 개수를 기록한다. 자연어 기억을 임의의 확정 사건 스키마로 재해석하지 않는다.
3. **제한된 출력 검사**: 명시적 이름 요청의 누락·주체 혼동, 지원하지 않는 검색·알림·물리 참석 주장 일부를 검사한다. 인용·부정·타인 행동 오탐을 별도 회귀로 점검한다.
4. **1회 교정과 이력 관리**: 실패 근거로 한 번만 다시 생성하고, 교정 중 도구를 제거한다. 통과한 실제 모델 원문만 내보낸다. 교정 성공 후 버린 초안과 내부 교정 지시는 다음 대화에 남기지 않는다. 재위반은 `persona_violation`으로 드러내고 원문을 보존한다.
5. **관측성과 실패 처리**: 빈 출력은 `empty_response`, 교정 시도와 실제 추가 모델 호출은 별도 집계한다. API 요청 간격·사용량·원문·코드 해시·프로세스 종료를 기록한다.
6. **2차 정책**: 말투 계약을 명시한 한국어 페르소나에만 제한적인 종결형 검사를 붙이고, 평가 정답과 무관한 말투 예시 및 도움 방식 지시를 추가했다. 긴 JSON 피드백 대신 필요한 수정 사항을 자연어로 짧게 제시한다.

[사용법과 재실행 명령](runtime/memory-lab/policy/README.md), [compiler](runtime/memory-lab/policy/compiler.mjs), [초기 guard](runtime/memory-lab/policy/guard.mjs), [2차 compiler](runtime/memory-lab/policy/compiler-v2.mjs), [말투 검사](runtime/memory-lab/policy/register.mjs), [2차 guard](runtime/memory-lab/policy/guard-v2.mjs).

## 3. 1차 실험: 실패도 보존

사전 계획: [eval-plan.json](runtime/memory-lab/policy/eval-plan.json), SHA-256 `faa28f278aff6b9ae5eee331561eda5c575580c4375ff619a3a0402f66dae657`.

- 조건: baseline / compiled / guarded, 인물 2개, 질문 6개씩, 총 36개 첫 시도.
- 실제 API **38회**: 36개 초안과 교정 2회. HTTP 오류 0, 전달 34, 차단 2.
- 알려진 사용량: 입력 **34,288**, 출력 **4,699** 토큰. 모든 요청의 사용량을 받았다. 실제 금액·무료 크레딧 차감액은 조회하지 않았다.
- 모든 worker/MCP 프로세스가 정상 종료했고 잔존 프로세스가 없다.
- temperature 0, maxTokens 1024, 도구 없음, seed 미지정, 호출 시작 간격 10초. 완전 결정성은 주장하지 않는다.

차단 두 건은 기능 경계 질문에서 요청한 자기 이름을 초안과 교정 답변 모두 누락한 경우다. 차단을 올바른 페르소나 답변으로 세지 않는다. 또한 “해요체”인데 사실 설명에서 “합니다체”가 섞이는 현상이 남았고, 미래 일정에 대해 근거 없이 곧 시작한다고 말하는 사례도 있었다. 따라서 첫 구현으로 작업을 끝내지 않고 별도 2차 후보를 만들었다.

원본: [policy-live JSON](runtime/memory-lab/results/policy-live-2026-11-11.json). 원본 JSON 내부에 모든 호출·초안·교정·검사 근거·기억·해시와 raw artifact 경로가 있다. 현재 코드와 다른 당시 소스도 `.local/policy-live/.../source`에 보존되어 있다.

조건명·교정 여부를 가린 38개 답변을 독립 AI가 평가했다. [원문 근거가 포함된 검토](runtime/memory-lab/results/policy-review-2026-11-11.json)와 [검증·집계 결과](runtime/memory-lab/results/policy-summary-2026-11-11.json)를 보존했다. 아래는 충분 판정 수이며 부분 판정은 충분에 포함하지 않았다.

| 축 | baseline | compiled | guarded 최종 |
| --- | --- | --- | --- |
| 이름 | 6/10 | 6/10 | 7/10, 차단 2개 포함 |
| 말투 | 6/12 | 7/12 | 6/12, 차단 2개 포함 |
| 성격·접근법 | 9/12 | 9/12 | 9/12, 차단 2개 포함 |
| 사건 의미 | 6/6 | 6/6 | 6/6 |
| 최신 값 | 6/6 | 6/6 | 6/6 |
| 기능 정직성 | 10/12 | 11/12 | 10/12, 차단 2개 포함 |
| 공감 | 4/6 | 3/6 | 2/6, 차단 2개 포함 |
| 구체적 도움 | 3/4 | 3/4 | 2/4, 차단 2개 포함 |

**1차 사전 개선 기준은 미달했다.** compiled의 말투 충분 수는 +1, 성격은 변화가 없고 자발적 일정 임박 오류가 1개 늘었다. guarded의 교정 2개는 이름 누락을 해결하지 못해 둘 다 차단됐다. 반말 인물의 교정은 성격·공감도 부분 점수로 내려갔다. 일부 축의 작은 개선만으로 전체 하네스 개선을 선언하지 않았다.

## 4. 실패 후보를 끝까지 확인한 추가 비교

계획은 각 실행 전에 고정했고, 원본을 덮어쓰지 않았다. 매번 새 인물·새 활동·새 날짜를 사용했다. 인물당 조건 순서를 반대로 배치했지만 완전 무작위 실험은 아니다.

| 회차 | 비교 | 실제 호출 | 전달 / 차단 / 오류 | 사전 기준 |
| --- | --- | ---: | --- | --- |
| 1차 | 005 baseline / compiled / guarded | 38 | 34 / 2 / 0 | 미달 |
| 2차 | 005 baseline / guarded-v2 | 21 | 13 / 3 / 0 | 미달 |
| 3차 | 005 baseline / voiced-v3 | 24 | 13 / 3 / 0 | 미달 |
| 4차 | compiled-v2 고정, 005 / 007 | 16 | 16 / 0 / 0 | 미달 |

**2차:** 윤슬·가온과 낭독 연습 모임. 짧은 자연어 피드백과 한국어 종결형 검사를 추가했지만, 후보가 8개 중 5개만 전달됐다. 전체 시도 분모의 말투 충분 수는 2→4, 성격은 3→5였으나 차단 때문에 기억·이름·기능 축의 충분 답변 수가 줄었다. 같은 대화에서 다시 쓰게 하면 오히려 더 격식적인 말투가 되거나 자기 이름이 사라졌다. [계획](runtime/memory-lab/policy/eval-plan-v2.json), [원문](runtime/memory-lab/results/policy-v2-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-v2-review-2026-11-11.json), [집계](runtime/memory-lab/results/policy-v2-summary-2026-11-11.json).

**3차:** 이안·보라와 보드게임 규칙 연습. 원래 초안을 새 문맥의 표현 전담 호출로 항상 한 번 다시 쓰게 했다. 실제 Pi SDK의 system message를 교체하고 기존 대화·실패 초안은 최종 이력에 남기지 않았다. 후보 8개 중 5개만 전달됐고 유효 쌍의 말투 +1, 성격 -1이었다. 일부 답변에서 미확인 현장 설명·시범을 프로그램 사실로 만들거나 물리적으로 만나겠다는 약속이 나타났다. API 비용을 두 배로 늘리는 상시 재작성도 해결책으로 채택하지 않았다. [계획](runtime/memory-lab/policy/eval-plan-v3.json), [원문](runtime/memory-lab/results/policy-v3-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-v3-review-2026-11-11.json), [집계](runtime/memory-lab/results/policy-v3-summary-2026-11-11.json).

**4차:** 현우·로아와 사진 구도 연습. 하네스를 compiled-v2로 고정하고 HCX-005와 HCX-007을 비교했다. 둘 다 1024토큰 상한, temperature 0, 도구 없음, 007의 thinking은 none이었다. 16개 모두 응답했지만 말투 충분 수는 6/8→6/8, 이름은 6/8→5/8이었다. 정정된 시간이 이전과 ‘동일하다’는 오류로 최신성도 2/2→1/2였다. 최신 모델을 붙인 사실과 페르소나 개선을 구별했다. [계획](runtime/memory-lab/policy/eval-plan-models.json), [원문](runtime/memory-lab/results/policy-models-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-models-review-2026-11-11.json), [집계](runtime/memory-lab/results/policy-models-summary-2026-11-11.json).

1·2차의 기존 요약은 전체 시도 분모를 사용한다. 3차부터 요약에 양쪽 모두 전달된 동일 인물·동일 질문의 짝 비교를 추가했고, 전체 시도의 전달·차단 수는 계속 별도로 보존했다. 차단으로 좋은 답변만 남기는 효과를 방지하기 위해 최소 전달 수와 보호 축의 하락 금지를 함께 요구한다. 이전 원본·요약을 새 기준으로 소급 덮어쓰지 않았다.

## 5. NAVER API와 하네스의 추가 구현

[007 Thinking 공식 규격](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking), [Structured Outputs 공식 규격](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-so), [모델 안내](https://guide.ncloud-docs.com/docs/clovastudio-model)를 확인하고 다음을 구현했다.

- `clova-model-config.ts`: 005의 기존 `maxTokens`를 보존하고, 007에는 `maxCompletionTokens`와 명시적 `thinking.effort`를 보낸다. 실험의 기존 최대 2048토큰 상한은 유지했다. 공식 low/medium/high 기본 예산을 최소값으로 오해하지 않는다.
- Brain: 007의 추론 결과 필드를 사용자 답변이나 다음 대화에 넣지 않는다. 사용량의 thinkingTokens를 completionTokens에 다시 더하지 않는다. 지원하지 않는 모델·thinking·도구·구조화 출력 조합은 요청 전에 거절한다.
- HTTP Wrapper: `--models HCX-005,HCX-007`로 명시적으로 허용할 수 있다. 기본 허용 모델은 기존 005이며 운영 배포 설정을 자동 변경하지 않았다.
- `structured-v5`: 007의 네이티브 `responseFormat: {type: "json", schema: ...}`을 사용한다. OpenAI 호환 API의 `json_schema` 형식을 네이티브 API에 잘못 보내지 않는다. thinking none·tools none 조건만 허용한다.
- 구조화 필드는 조수 이름·말투·실제 기능, 승인 사실 요약, 불확실성, 작은 다음 행동, 최종 `reply`다. 이름·기능 enum은 운영자 설정에서 만들어지고 평가 질문의 정답을 코드에 박아 넣지 않는다. 사실 요약은 모델 생성 보조 항목이며 승인 기억으로 자동 저장되지 않는다.
- 표시하는 내용은 모델이 생성한 `reply` 문자열 그대로다. 이름 접두사·정답 템플릿·fallback을 붙이지 않고 공백도 보존한다. 다른 JSON 항목은 다음 대화에서 제거한다. JSON/enum 유효성은 의미적 정답을 보증하지 않으므로 `semanticVerified:false`를 기록한다.
- 이 구조화 비교에서는 의미 guard를 관찰용으로 둔다. 잘못된 실제 답변도 그대로 평가하되, JSON 계약 오류·잘림·빈 응답·명시적 금지 문자열 위반은 실패로 남긴다. 앞선 교정 후보의 기준을 통과한 것처럼 표시하지 않는다.

형식 구조와 별도 지시가 동시에 달라지는 패키지 비교이므로 스키마 제약만의 단독 인과 효과라고 주장하지 않는다. 응답 스키마는 system 문자 예산과 별도 전송된다. 실제 사용량과 정확한 schema를 로그에 보존하며 문자 예산을 전체 토큰 예산으로 표현하지 않는다.

개발 중 실패 사례를 다시 시험한 작은 probe들은 별도 [개발 실험 기록](runtime/memory-lab/research-2026-11-11-probes.md)에 정리한다. 최초 AbortSignal 누락은 fetch 전 로컬 실패로 외부 호출 0회다. 이후 전체 개발 probe의 실제 호출은 **21회**다. low/high thinking·사용자 입력 끝의 역할 강조도 충분하지 않았다. 초기 구조화 출력 3개에서 이름·말투가 나아졌으나 미확인 진행 보장이 남아 불확실성과 다음 행동 필드를 추가했다. 이 개발 사례를 새 질문에서의 검증 성공으로 합산하지 않는다.

## 6. 동일 모델 구조화 출력 비교

[사전 계획](runtime/memory-lab/policy/eval-plan-structured.json): HCX-007 compiled-v2 일반 출력 대 HCX-007 structured-v5. 유진·세나, 종이접기 순서 연습 모임, 새로운 7월 일정. 양쪽 모두 2048토큰 상한·temperature 0·thinking none·tools none, 총 16호출, 재시도/교정 0회.

관찰 전 요구 조건은 16개 모두 정상 전달, 유효 쌍 8개, 말투 충분 수 +2, 성격 +1, 이름·사건·최신성·기능 정직성 하락 없음, 중대 실패 증가 없음이다. 추가로 말투 변화 이외의 구체적인 도움 개선을 원문으로 확인해야 한다. [실제 원문](runtime/memory-lab/results/policy-structured-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-structured-review-2026-11-11.json), [무결성을 검증한 집계](runtime/memory-lab/results/policy-structured-summary-2026-11-11.json).

16회 모두 전달, 차단·오류·교정 0회. 입력 26,912 / 출력 2,917토큰. **말투 6/8→8/8로 개선됐으나 전체 기준은 실패했다.** 성격 6/8→5/8, 실제 도움 3/4→2/4였다. 이름은 양쪽 6/8로 그대로이고, 모델이 metadata에는 이름을 썼지만 reply에서는 생략했다. 조회할 수 없는 모임을 ‘계획대로 열릴 가능성이 크다’며 안심시키는 사례도 남았다. 중대 조롱 실패는 baseline 1→후보 0으로 줄었으나 다른 퇴행을 감추지 않았다.

한 baseline 답변은 ‘지금 내 이름은 세나야’ 뒤에 이름을 잠깐 바꾸겠다고 말하고 직접 조롱했다. 이름 축은 주 검토자 2, 별도 감사자 1로 이견이 있었다. 조롱·기능 축의 실패와 중대 오류는 일치했다. 주 평가를 사후 변경하지 않았으며 이름 점수를 더 엄격하게 바꿔도 성격 저하로 전체 기준 실패라는 결론은 같다.

### 요청별 출력 계약 후보

reply만 남기는 축소 계약을 개발 사례 3개에서 시험했지만 말투가 다시 격식체로 흔들려 채택하지 않았다. 이어 이름·말투 metadata는 보존하고, 실제 사용자 질문의 명시 요구를 `reply.description`에 연결한 `taskContract`를 구현했다. 이름 요청이면 본문 첫 문장의 자기소개를 지시하고, 도구가 없는 검색·알림·참석 요청이면 실제 한계를 명시한다. 작업 수행이 불안한 질문에는 자료 검색이나 일정 기록만으로 끝내지 않고 작업의 한 단계를 짧게 연습하는 방법과 이유를 요구한다. 벤치마크 일정·장소·정답 문구는 넣지 않는다.

이는 [NAVER 공식 구조화 출력 예시](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-so)의 필드 description 활용을 참고한 자체 가설이다. 자연어 description 자체가 의미 준수를 강제하지 않는다. [공식 Playground 가이드](https://guide.ncloud-docs.com/docs/clovastudio-playground01)와 [RoleLLM](https://arxiv.org/html/2310.00746v3)의 대화 예제 접근도 조사했지만, 이번 요청별 계약 후보에는 새 few-shot 대화 예제를 섞지 않았다. 효과 원인을 더 늘리지 않기 위해 별도 후속 선택지로 남겼다.

개발 사례 3개에서 이름·해요체가 유지됐지만 개발 데이터 재시험이므로, 새 인물·새 상황의 별도 16회 비교로 검증한다. [6차 사전 계획](runtime/memory-lab/policy/eval-plan-task.json)의 SHA-256은 `31183265b731c86f4dd8f79d6f2d35b0de0d3edd95207340e8be0feac8d7fa7a`다. 서원·리오와 실매듭 순서·느슨함 연습을 사용하고 HCX-007 compiled-v2 대 structured-v6를 비교한다. 신규 계획 작성자는 이전 실험의 단일 답변 감사를 본 사실을 limitations에 기록했다.

6차도 16회 모두 전달됐지만 전체 기준은 미달했다. [원문](runtime/memory-lab/results/policy-task-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-task-review-2026-11-11.json), [집계](runtime/memory-lab/results/policy-task-summary-2026-11-11.json). 말투 충분 수 +2, 성격 변화 0으로 사전 기준의 성격 +1에 닿지 못했다. 이름 누락은 줄었지만 실제 매듭 순서 연습 대신 준비물만 챙기는 답변이 남았다.

이때 영문 `basic cord-knot`를 Basic 인증으로 잘못 마스킹하는 기존 공통 serializer의 오류를 발견했다. 영향은 저장된 계획의 의미 경계와 practicalHelp 평가 문구 두 곳이며, 실제 모델 답변에는 없었다. 검토자는 승인 기억과 질문에 명시된 매듭 연습으로 해석한 사실을 각 근거에 남겼다. 이전 원문을 고치지 않고, 새 serializer에서 일반 산문을 보존하도록 수정했다. 명시적 인증 헤더와 실제 Basic Base64(user:password), Bearer·등록 비밀값은 계속 마스킹한다. 새 회귀 6개와 기존 마스킹 회귀를 통과했다.

### 대화 예제를 사용하는 별도 후보

`structured-v7`은 요청별 계약에 책상 정리·수첩 그림의 가상 대화 예제 두 쌍을 추가한다. 실제 시험의 날짜·장소·정답은 들어가지 않는다. 현재 페르소나의 이름과 명시적 한국어 해요체/반말에 맞춰 역할 압력에도 존중하는 응답, 기능 한계, 작은 실행과 이유를 보여 준다. 외부 기능이 없는 이 두 말투 설정만 지원한다. 다른 언어·말투는 조용히 바꾸지 않고 거절한다.

예제는 Brain에 전달하는 요청에만 삽입한다. 실제 SDK 대화 이력이나 승인 기억에는 저장하지 않는다. 호출 로그의 `providerMessages`, `demonstrationCount`, `demonstrationChars`로 실제 전송 내용을 검증할 수 있다. 예제는 system+기억 문자 예산 밖의 추가 입력이며 토큰 비용에는 포함된다. 예제 비용을 숨기거나 같은 컨텍스트 크기라고 표현하지 않는다.

[7차 사전 계획](runtime/memory-lab/policy/eval-plan-demonstrated.json)은 하린·태오와 손뼉 리듬 연습 상황에서 HCX-007 compiled-v2 대 structured-v7을 16회 비교한다. 모델·토큰 상한·도구 조건은 고정하고 기존 통과 기준을 유지한다.

[7차 원문](runtime/memory-lab/results/policy-demonstrated-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-demonstrated-review-2026-11-11.json), [집계](runtime/memory-lab/results/policy-demonstrated-summary-2026-11-11.json). 16회 모두 전달, 입력 33,548 / 출력 2,749토큰. **전체 기준은 다시 실패했다.** 양쪽 말투가 모두 8/8로 충분해서 이 표본에는 추가 말투 개선 여지가 없었고, 성격 충분 수는 -1이었다. 이름 누락은 후보에서 해결됐지만 일부 연습 제안은 수행 방법이 모호했다. 예제를 더 넣었다고 성격이 좋아진다고 주장하지 않는다.

동일 007 모델의 하네스만 바꿔 우월함을 입증하는 질문과, 초기 실험에서 사용하던 005+기본 JSON 정책을 전체 설정으로 업그레이드할 때 유익한지를 구별한다. 후자는 별도 사전 계획과 새 상황으로 비교하며, 앞선 동일 모델 실패를 뒤집거나 모델·하네스 중 어느 요소가 원인인지 단정하지 않는다. CLI는 모델 인자를 필수로 받으며, 자동 기본 모델이 있다는 뜻은 아니다.

[8차 전체 업그레이드 계획](runtime/memory-lab/policy/eval-plan-upgrade.json), [원문](runtime/memory-lab/results/policy-upgrade-live-2026-11-11.json), [독립 검토](runtime/memory-lab/results/policy-upgrade-review-2026-11-11.json), [집계](runtime/memory-lab/results/policy-upgrade-summary-2026-11-11.json). 유하·찬우와 기초 암산 연습 상황에서 16회 모두 전달됐다. 입력 29,181 / 출력 3,442토큰.

| 축 | 기존 005+baseline | 007+v7 |
| --- | --- | --- |
| 이름 | 4/8 | 8/8 |
| 말투(이번 엄격 판정) | 4/8 | 6/8 |
| 성격·접근법 | 5/8 | 5/8 |
| 사건 의미 | 2/2 | 2/2 |
| 최신 값(사전 적용 문항) | 2/2 | 2/2 |
| 기능 정직성 | 6/8 | 8/8 |
| 공감 | 4/6 | 6/6 |
| 구체적 도움 | 2/4 | 3/4 |
| 자발적 오류 포함 중대 실패 | 1 | 1 |

**여러 축의 실제 개선은 확인했으나, 사전 전체 기준은 성격 +1 미달로 실패했다.** baseline은 현장에 함께할 수 있다고 했다가 뒤에서 불가능하다고 말하는 모순이 있었다. 후보는 승인 일정이 2027년인데 근거 없이 ‘내일 모임’이라고 했다. 해당 질문에 currentness 축을 소급 추가하지 않고 별도 중대 오류로 기록했으므로 최신 값 2/2와 모순되는 집계가 아니다.

주 검토자는 이번 2개 -답니다/-랍니다 응답을 엄격 해요체 혼합으로 부분1 처리했지만, 이전 일부 평가에서는 자연스러운 변주로 충분2 처리했다. 이 불일치를 원문과 검토 근거에 공개했다. 이전 해석을 적용한 민감도에서는 후보 말투가 8/8이지만 성격이 그대로라 전체 기준 실패는 바뀌지 않는다. 사람 평가나 평가자 간 신뢰도 계수는 주장하지 않는다.

9차 [사전 계획](runtime/memory-lab/policy/eval-plan-composed.json)은 이 어미의 처리를 관찰 전에 엄격하게 고정했다. baseline과 후보 모두 해요체에 -답니다/-랍니다가 섞이면 부분1이며, 이전 평가 파일을 소급 수정하지 않는다. 기존 005+baseline 대 007+composed-v8의 전체 설정 비교이고 같은 수치 기준을 유지한다. 다솔·해준과 가벼운 컵 탑 쌓기·순서/균형 연습을 사용한다.

[composed 계약](runtime/memory-lab/policy/composed.mjs)은 reply를 identity·acknowledgement·answer·next_step 네 문자열로 받는다. 자기소개·공감·사실 답변·다음 행동을 모델이 각각 생성하고, 비어 있지 않은 원문을 고정 순서의 빈 줄로만 연결한다. 원문 내부의 공백·개행·단어·문장부호를 보존한다. 프로그램이 이름·사실·답변 라벨을 만들어 붙이지 않는다. 렌더링된 전체 문장이 평가 대상이며 단일 raw reply 문자열과 같다고 주장하지 않는다. 다른 metadata의 정확성은 여전히 의미 점수가 아니다.

v8은 가상 대화 예제를 사용하지 않는다. 잘못된 자기소개나 기능 주장을 모델이 쓰면 그대로 노출·평가하며, 계약 metadata가 맞다는 이유로 고치거나 성공으로 표시하지 않는다. 전체 빈 내용·잘못된 필드·JSON 오류는 실패다. 현재 질문에서 이름 요구를 찾는 좁은 규칙과 일반 연습 조언의 한계는 남는다.

### 9차: 첫 수치 기준 통과와 독립 평가의 불일치

[실제 원문](runtime/memory-lab/results/policy-composed-live-2026-11-11.json), [주 평가](runtime/memory-lab/results/policy-composed-review-2026-11-11.json), [주 집계](runtime/memory-lab/results/policy-composed-summary-2026-11-11.json), [두 번째 전체 평가](runtime/memory-lab/results/policy-composed-secondary-review-2026-11-11.json), [두 번째 집계](runtime/memory-lab/results/policy-composed-secondary-summary-2026-11-11.json). 실제 호출 16회, 모두 전달, 재시도·교정·오류 0회. 입력 35,119 / 출력 3,778토큰.

아래 숫자는 충분 판정 수이며, 각 칸은 기존 005+baseline → 007+v8이다.

| 축 | 주 평가 | 두 번째 전체 평가 |
| --- | --- | --- |
| 이름 | 6/8 → 8/8 | 6/8 → 8/8 |
| 말투 | 4/8 → 8/8 | 4/8 → 8/8 |
| 성격·접근법 | 4/8 → 6/8 | 6/8 → 7/8 |
| 사건 의미 | 2/2 → 2/2 | 1/2 → 0/2 |
| 최신 값 | 2/2 → 2/2 | 2/2 → 2/2 |
| 기능 정직성 | 6/8 → 7/8 | 6/8 → 7/8 |
| 공감 | 5/6 → 6/6 | 3/6 → 6/6 |
| 구체적 도움 | 1/4 → 2/4 | 4/4 → 2/4 |
| 중대 실패 | 2 → 0 | 1 → 0 |

주 평가의 **수치 기준은 통과**했다. 두 번째 평가도 이름·말투·성격·기능 정직성 개선을 확인했지만 사건 의미의 충분 수 감소로 수치 기준은 실패했다. 두 번째 평가자는 사건 종류를 바꿨다는 뜻이 아니라 실제 연습 내용의 설명이 덜 완전해서 감점했다고 설명했다. 세부 연습 내용을 반드시 열거하는 조건은 사전에 명시되지 않았으므로 이는 평가 해석의 모호성이다. 기존 점수를 유리하게 수정하지 않고 두 결과를 모두 보존했다.

구체적 도움도 평가자에 따라 기존 답변의 충분 판정이 1/4와 4/4로 크게 달랐다. 새 후보의 지도 검색·친구 연락 제안은 요청한 컵 연습을 직접 돕지 못했고, 다른 답변의 단순 연습 권유도 약했다. 따라서 주 수치 통과만으로 전체 합격이나 실용적 도움의 확실한 개선을 선언하지 않는다. 중대 실패 차이는 미래의 실시간 정보 제공 가능 주장까지 중대로 볼지, 실제 실행·현장 참석 약속으로 제한할지에 따른 경계 차이도 포함한다.

### 10차: 코드를 고정한 새 상황 확인

[확인 계획](runtime/memory-lab/policy/eval-plan-confirmation.json)의 SHA-256은 `0fc6c0104c6e2f896abc5af7047d19ba7a28601c053693833627797466f3bf95`다. 소담·여울과 기초 키보드 자리 연습을 사용했다. 9차 이후 생성 코드·프롬프트·스키마를 바꾸지 않고 같은 v8로 16회 실행했으며, 모두 전달됐다. 입력 35,366 / 출력 3,911토큰. 오류·재시도·교정은 없었다.

독립 AI 두 명의 전체 평가를 미리 등록했다. 답변을 보기 전에 실용적 도움은 실제로 수행 가능한 연습 행동과 요청한 이유를 요구하되 임의의 횟수나 상세 강좌를 추가 요구하지 않도록 명료화했다. 사건 의미는 실제 사건 종류의 보존으로 판단하며, 미등록 세부 활동의 전부 열거를 새 필수 조건으로 만들지 않는다. 실제 사건 종류가 불명확하면 부분 점수로 남긴다. 양쪽 조건에 같은 해석을 적용하고, 수치 합격선은 변경하지 않았다.

[실제 원문](runtime/memory-lab/results/policy-confirmation-live-2026-11-11.json), [주 평가](runtime/memory-lab/results/policy-confirmation-review-2026-11-11.json), [주 집계](runtime/memory-lab/results/policy-confirmation-summary-2026-11-11.json), [두 번째 평가](runtime/memory-lab/results/policy-confirmation-secondary-review-2026-11-11.json), [두 번째 집계](runtime/memory-lab/results/policy-confirmation-secondary-summary-2026-11-11.json).

| 축 | 주 평가: 기존 → 후보 | 두 번째 평가: 기존 → 후보 |
| --- | --- | --- |
| 이름 | 6/8 → 8/8 | 6/8 → 8/8 |
| 말투 | 4/8 → 7/8 | 4/8 → 7/8 |
| 성격·접근법 | 7/8 → 8/8 | 6/8 → 6/8 |
| 사건 의미 | 2/2 → 2/2 | 2/2 → 2/2 |
| 최신 값 | 1/2 → 2/2 | 1/2 → 2/2 |
| 기능 정직성 | 7/8 → 8/8 | 7/8 → 7/8 |
| 공감 | 0/6 → 6/6 | 0/6 → 6/6 |
| 구체적 도움 | 1/4 → 2/4 | 1/4 → 2/4 |
| 중대 실패 | 1 → 0 | 1 → 0 |
| 수치 기준 | 통과 | 성격 +1 미달 |

두 평가자는 서로의 점수나 조건 매핑을 보지 않고 전체 16응답을 채점했다. **전체 확인 기준은 미달**이다. 주 평가만 골라 합격으로 선언하지 않는다. 9차에서는 양쪽 평가자가 성격 향상을 보았지만, 고정 코드를 다른 상황에 적용한 10차에서는 두 번째 평가자가 같은 충분 수를 줬으므로 성격 개선의 재현성은 아직 부족하다. 기능 정직성의 차이는 ‘모임 정보를 다시 확인해보니’라는 표현을 대화 기억 재확인으로 볼지, 출처가 모호한 확언으로 볼지에 따른 차이다.

실질적 도움 개선은 두 평가 모두 1/4→2/4로 확인했다. 기존의 기준 없는 손가락 위치 확인·불특정 영상 따라 하기에서 후보의 실제 키보드 글쇠 위치 탐색·회상으로 구체화된 두 첫 답변이 개선 근거다. 반대로 기능 한계 질문에서는 기존 반말 답변이 ‘ㄱ·ㅏ를 입력해 가를 만들기’라는 실행 가능한 연습을 제안했는데 후보는 단순 연습 권유로 약해졌다. 네 도움 문항 모두 해결됐다는 뜻이 아니며 이 퇴행도 보존했다. 기억에서는 기존 답변이 승인된 ‘글쇠연습실’을 ‘글쇠훈련실’로 바꾼 중대 오류가 후보에서 사라졌다.

최종 선택은 **v8을 명시적으로 선택할 수 있는 실험 프로필로 유지**하는 것이다. 모델과 하네스가 함께 바뀐 전체 설정의 개선 범위만 주장한다. 같은 007 모델에서 v8만의 우월성, 장기 성격 보장, H31 운영 승격은 이 자료로 입증하지 않았다. 자동 교정·thinking·예제 추가의 실패 기록과 모든 이전 원문도 남긴다.

### 검증 절차의 보강

새 검토 패킷은 조건 운영 설명을 제외한 점수 척도·축·중대 실패 정의만 포함한다. 임의 salt로 ID를 만들고 매핑 파일은 검토자에게 제공하지 않는다. 요약 도구는 원본 SHA와 패킷 SHA뿐 아니라 원본 응답↔조건 매핑↔평가 항목의 문장·페르소나·질문·평가 축·활성 기억·전달 상태가 1:1로 일치하는지 검증한다. 중대 실패의 빈 인용이나 빈 이유도 거절한다. 이 변경은 점수 기준을 완화하지 않고 결과를 다른 조건에 잘못 귀속하는 것을 방지한다.

검증 범위는 실제 Pi SDK 통합·정책/메모리·승인·provider wire와 HTTP 변환이다. 단순 scripted 통과를 모델 성격의 증거로 합치지 않는다. v8 실행 전 정책 검사는 **69/69**, 공통 Pi 기억·승인·격리 회귀는 **24/24**, provider/HTTP/Anthropic 호환 검사는 **40/40**다. TypeScript 검사도 통과했다. 로그는 [v8 정책 검사](runtime/memory-lab/results/policy-composed-final-unit-tests-2026-11-11.txt), [Pi 공통 회귀](runtime/memory-lab/results/pi-policy-composed-final-regression-2026-11-11.json), [provider 검사](runtime/memory-lab/results/policy-demonstrated-final-provider-tests-2026-11-11.txt)에 보존한다.

확인 시험 종료 후 진단기 오탐도 수정했다. 실제 개발 probe의 `저의 이름은 '**윤슬**'이에요.`를 기존 guard가 인용문으로 지워 이름 누락으로 잘못 판단했다. 현재는 운영자 이름 바로 주위의 균형 잡힌 단일·이중 강조만 검사 내부에서 해제한다. 전체 인용문·코드·타인 이름 귀속·부정·반박된 소개는 성공으로 인정하지 않고, 정상 소개와 무관한 다른 절의 인용 설명은 정상 소개를 지우지 않는다. 사용자에게 보여주는 모델 문자열은 변경하지 않는다.

후속 수정의 [정책·실제 SDK 검사 **77/77**](runtime/memory-lab/results/guard-identity-policy-tests-2026-11-11.txt), [Pi smoke 회귀 **9/9**](runtime/memory-lab/results/guard-identity-pi-regression-2026-11-11.txt)가 통과했다. [입력 불변성 검사](runtime/memory-lab/results/guard-identity-contract-invariance-2026-11-11.json)는 등록 계획 10개, 질문/페르소나 84쌍, 기능 설정 2개에서 빈 응답 검사 168건·생성 계약 672개가 수정 전후 같음을 확인했다. 실제 v8 시험은 수정 전 guard snapshot으로 실행됐고 과거 결과를 새 코드로 바꿔 적지 않았다. 이 검증은 해당 등록 계약의 불변성만 뜻하며 모든 입력의 동작 동등성을 보증하지 않는다.

## 7. 호출·증거·인계 정산

이 날짜의 비교 10회차는 **195 API 호출**, 첫 질문 시도 180개, 전달 172개, 검사 차단 8개, API 오류 0개다. 추가 호출 15개는 1~3차의 교정 또는 상시 재작성이다. 개발 probe 21회를 별도 합산하면 **실제 API 호출 216회**, 알려진 입력 **332,673**, 출력 **37,085**, 합계 **369,758토큰**이다. 최초 probe의 AbortSignal 누락 1회는 외부 요청 전에 실패했으므로 216회에 포함하지 않았다. 이전 날짜의 프로젝트 전체 실험을 합친 수치는 아니다.

모든 완료 비교의 worker/MCP 정리 기록, 원본과 평가 해시, 실행 당시 소스 snapshot을 [증거 원장](runtime/memory-lab/results/policy-evidence-ledger-2026-11-11.json)에 모았다. 소스 snapshot **153개**의 해시와 프로세스 정리 기록 **84개**를 확인했다. [소스 snapshot 묶음](runtime/memory-lab/results/policy-source-snapshots-2026-11-11.tar.gz)은 등록된 소스 파일만 포함하며 임시 인증 파일은 포함하지 않는다. 실제 답변·요청·사용량은 각 live JSON에 남아 있다. [최종 판단 JSON](runtime/memory-lab/results/policy-final-decision-2026-11-11.json)은 수치 기준과 수동 도움 판정을 구별한다. 원문과 예전 평가 파일은 수정하지 않았다. 실험 종료 후 임시 `clova-*.key` 파일은 0개다. 금액과 무료 크레딧 잔액은 조회하지 않아 미상으로 둔다.

운영 전환에는 다음 자료를 준비했다.

- [K1 제공자 인계](runtime/clova/OPS-PROVIDER-HANDOFF-2026-11-11.md): native v3, 005/007 wire, raw key 파일과 env bundle 차이, 오류·사용량·도구 계약, 기존 Elda 어댑터·등록 패치, 소스 SHA-256. 최초 인계 때는 미커밋이었으며, 이후 사용자 요청으로 기반 구현을 `5a363c34de0790d375f950f9e651dfc02beb57c2`에 커밋하고 push했다.
- [H38~H46 차이 분석](runtime/memory-lab/OPS-HARNESS-GAP-2026-11-11.md): 새 memory-lab Pi의 승인·종료 상태·비용 근거·세션 토큰 한도 등 운영 규격의 남은 차이와 완료 검증 순서.
- [Comms 답장·전달 확인 기록](runtime/clova/COMMS-REPLY-DRAFT-2026-11-11.md): **풀스택이 K1을 대신 전달했음을 `09f4371279` 원문으로 확인**했다. 이 세션의 직접 발신은 아니다. mars 읽기용 사본은 풀스택의 제공 보고로 남기며 사본의 바이트 일치나 C1/A3 실행 완료까지 검증한 것은 아니다. 전달 요약의 216회는 Pi 비교 195회와 독립 Brain probe 21회의 합계다.

인프라의 `c5c2f0bd7e` 메시지는 A1·A2 완료를 알리는 타 팀 보고로 읽었다. Elda-Ops 및 인프라의 배포·타이머 완료 보고는 이 프로젝트에서 재검증한 사실과 구별한다. 자매 저장소를 수정하거나 인증 키를 다른 프로젝트에 배포하지 않았다. Pi에 실제 HCX 호출 증거가 생겼지만 LangGraph와 같은 운영 과제 묶음의 H31 비교는 수행하지 않았으므로 운영 기준선은 LangGraph로 유지한다.

후속 수신 상태: 코딩고래는 새 Elda CLI native 제공자·runner C1/C2를 **be96b89**, runner H20을 **e053ae1**로 push하고 모의 시험을 통과했다고 보고했다. 사용자의 A3 직접 키 배치 완료 보고 뒤 **a6d2031**의 mars `elda job _ai`에서 HCX-005 도구 호출 → 결과 → 최종 답변과 runner 결과 파일까지 성공했다고 알렸다(`8bb0c80e39`). 첫 요청의 빈 도구 설명 400 오류와 최종 답변의 근거 없는 계산도 보고됐으므로, 연결 성공을 의미적 과제 성공으로 취급하지 않는다. mini-api 등록 Task → `elda job run <id>` → 실제 보고의 전체 경로는 아직 모의 검증뿐이며 첫 운영 Task의 등록·실행 완료는 확인되지 않았다. 새 Pi 정책의 통합·배포를 뜻하지 않고, 타 팀 시험을 이 랩의 216회 원장에 합산하지 않는다. 자세한 진행은 [Comms 전달 기록](runtime/clova/COMMS-REPLY-DRAFT-2026-11-11.md)을 따른다.

같은 보고에서 드러난 랩 provider의 빈 도구 설명 문제는 이후 별도로 수정했다. native 전송에서 설명이 비었으면 도구 이름으로 보완하며, 전용 3/3·관련 회귀 34/34와 TypeScript 검사를 통과했다. [후속 패치 보고서](runtime/clova/TOOL-DESCRIPTION-FIX-2026-11-11.md)에 수정 전후 소스 해시와 실패/성공 로그를 남겼다. 실제 API 추가 호출은 0회이며, 이 문서의 페르소나 비교 당시 코드 snapshot과 216회 원장은 그대로 보존한다.

## 8. 범위와 남는 한계

연구 자료를 참고한 자체 구현이며 LangChain/Letta/Graphiti/NeMo 전체를 설치·이식한 결과가 아니다. 이번 변경은 **독립 Pi CLI 경로와 공용 CLOVA Brain/HTTP Wrapper의 007 지원**이다. 이번 페르소나 정책을 Agno, 실제 Elda-CLI 레지스트리, 운영 웹페이지에 연결·배포하지 않았다. 이전 모드별 통합 실험과 이번 신규 정책의 통합 상태를 혼동하지 않는다. 기존 배포 서버는 이 프로젝트의 API 자격증명을 읽는 용도로만 사용했다.

자동 guard는 자유문장 사건 의미, 한국어의 모든 주체·부정·인용, 성격·공감 전체를 검증하지 않는다. `랍니다` 등 종결형은 실제 한국어에서 친근한 높임으로도 쓰이지만 이번 엄격한 해요체 검사에서 위반으로 분류될 수 있다. [국립국어원 사전](https://krdict.korean.go.kr/jpn/dicSearch/SearchView?ParaWordNo=76427&nation=jpn)의 문법 설명과 구별하며, 독립 의미 점수와 자동 차단 결과를 혼합하지 않는다.

검토자는 독립 AI이며 사람 평가가 아니다. 새 구조화 비교 패킷은 조건명·모델명·메타데이터를 숨기고 임의 salt로 답변 ID를 만든다. 이전 패킷은 공통 rubric의 reporting에 전역 모델·조건 설명이 포함될 수 있었고 ID도 재사용 가능했다. 개별 답변의 조건 매핑은 숨겼지만 이를 완전 맹검으로 주장하지 않는다. 새 패킷도 문체에서 조건을 짐작할 수 있다. 새 질문도 구현자가 볼 수 있었으므로 비공개 벤치마크는 아니다. 반복해서 후보를 개선·선택한 소규모 공학 파일럿으로, 통계적 유의성·모든 모델·장시간 대화의 보증이 아니다. 기억 정정 시 기존 worker는 이력을 비우고 재시작도 새 이력으로 시작하므로 중단 없는 긴 대화와 다르다.

요청별 계약의 현재 작은 실습 지침은 작업 준비 대화에 특화되어 있다. 이름/기능 요청 감지는 좁은 정규식이며 모든 한국어 우회 요청을 잡지 못한다. 일반 상담·창작·장시간 도구 작업까지 검증한 범용 페르소나 솔루션으로 해석하지 않는다.

금액·무료 크레딧 잔액은 조회하지 않았다. 알려진 토큰과 외부 요청 수를 기록하고 과금 금액은 추정하여 확정하지 않는다. 모든 파일 변경은 이 프로젝트 안에서 수행했다.
