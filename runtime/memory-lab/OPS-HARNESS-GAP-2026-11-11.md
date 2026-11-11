> 최신 보충: [v0.802 운영 하네스 감사](OPS-HARNESS-GAP-v0.802-2026-11-11.md). H42는 한 턴 토큰 한도이며, 판정기 없는 taskSucceeded는 생략한다.
> 아래 본문과 해시는 v0.8/e1b3edc 시점 원본 기록으로 보존한다. 최신 조항·구현 차이·미수행 H31 계획은 보충 문서를 따른다.

# Elda-Spec v0.8 ② 운영 하네스 차이 분석 — 2026-11-11

**현재 Pi 기억 런타임은 H38–H46 전체 적합 상태가 아니다.** 일회용 승인 ID, 순차 승인, null 인자 정규화 등은 있으나, 무인 실행 즉시 거절, 사람 대기 시간 분리, 네 가지 턴 결과, 비용 출처와 누적 토큰 한도가 빠져 있다. 실제 HCX 호출 증거가 생겼어도 **LangGraph와 동일 과제 묶음의 실제 비교 H31을 통과하기 전에는 기준선을 Pi로 승격하지 않는다.**

이 문서는 읽기 전용 감사와 파일·네트워크 효과 없는 인자 검증을 바탕으로 작성했다. 이 감사에서 수정한 것은 이 새 Markdown 파일뿐이다. Elda-Spec·자매 저장소 수정, fetch, commit, 배포, 외부 API 호출, 메시지 전송은 하지 않았다. 감사 당시 진행 중이던 live 평가 출력은 읽지 않았다. 이후 완료된 페르소나 실험 결과는 [별도 보고서](../../PERSONA-POLICY-IMPROVEMENT-2026-11-11.md)에 있으며 이 감사의 운영 규격 판정을 실험 성공으로 대체하지 않는다.

## 1. 규격과 구현의 정확한 범위

- 규격: 로컬 `/home/gino/WorkArea/Elda-Spec/harness/SPEC.md`, 커밋 **`e1b3edc365d7608059c61826056ed7ee6e947912`**, 제목 **서빙 하네스 규격 v0.8 (초안) — ③ 서빙 + ② 구동 프로필**. 감사 시 로컬 HEAD도 같은 커밋이며 작업 트리 문서 바이트가 `git show e1b3edc:harness/SPEC.md`와 같았다. 원격 조회는 필요하지 않았다.
- [절 I, H38–H46](/home/gino/WorkArea/Elda-Spec/harness/SPEC.md:107)는 ② 운영·개발 보조 실행의 추가 계약이다. A–H의 ③ 계약을 전부 같은 의미로 적용하지 않고, ② 예외와 덮어쓰기를 함께 봐야 한다. 문서 자체는 아직 v0.x 초안이다.
- 주 감사 대상: [memory-lab Pi CLI](pi/cli.mjs), 실제 Pi agent-core **1.5.1** + 자체 SQLite + 공통 Brain + MCP. 새 페르소나 실험에서 쓰는 코드다.
- 비교 대상: [harness-lab Pi 프로토타입](../harness-lab/pi/cli.mjs), [LangGraph 실행기](../clova/langgraph.ts), 공통 [provider](../clova/provider.ts)와 [MCP](../clova/mcp.ts). 서로 다른 구현을 하나의 “Pi” 결과로 합치지 않았다.
- memory-lab CLI의 `--policy` 기본값은 `baseline`이다. 모델은 `--model` 또는 `--script` 중 하나를 **명시해야 하므로 자동 기본 모델은 없다**. 기존 실험에서 HCX-005를 사용했다는 사실과 CLI 기본 설정을 구별한다.

아래 판정에서 **부분**은 일부 하위 조건만 확인한 상태다. **정적 확인**은 실행 적합성 시험 통과를 뜻하지 않는다. 이번 감사는 전체 H1–H46 적합성 인증이나 Elda CLI·운영 웹 통합 점검이 아니다.

## 2. 조항별 차이

| 조항 | v0.8 요구 | memory-lab Pi의 현재 근거 | 판정·남은 일 |
| --- | --- | --- | --- |
| **H38 필수** | 실행기 발급 일회용 승인 ID, 잘못된 답 거절, 기본 거절, responder 기록, 승인 기억 범위, 도구별 always_ask/always_deny, 호출별 승인 | `cli.mjs:131`에서 UUID를 만들고 입력 snapshot을 보존한다. `:354`에서 ID와 boolean을 검사하고 중복·오래된 ID를 거절한다. `:209`는 sequential, `:264`는 각 호출 앞 승인. workspace·MCP 경계는 승인 뒤에도 유지 | **부분**. responder·승인 범위·도구별 정책·독립 대기 만료 없음. 현재는 모두 매번 묻는 형태이며 세션 기억 허용 정책은 없음. `approve`에 responder를 추가하면 현재 strict keys 검사에서 거절됨 |
| **H39 필수** | 사람 대기 동안 실행 시계 정지, 기본 1800초 별도 대기 한도, 무인 실행은 즉시 거절 | `cli.mjs:283`의 전체 120초 기본 타이머가 승인 대기 중에도 흐른다. `approve()` 자체에는 대기 타이머가 없다. `remember/forget`의 `mutate()`는 모델 턴 타이머 밖에서 기다림 | **미구현**. 무인/대화형 실행 모드 구분 없음. 도구 승인은 턴 timeout까지 기다리고 기억 승인은 입력·취소가 없으면 계속 대기할 수 있음. `--tools none`도 기억 승인 문제를 해결하지 않음 |
| **H40 필수** | runCompleted / taskSucceeded(판정 있을 때) / policyRejected / toolFailed 분리, denied·stalled·output_limit, 거절 뒤 ok:true 방지 | `cli.mjs:267`은 승인 거절을 `failure='denied'`로 기억하므로 마지막 `ok:false`는 개선돼 있음. 그러나 `:343`은 `ok/endReason`만 내고 네 상태가 없음. `:278`은 도구 실패·차단 모두 tool_error 범주로 다룸 | **부분**. 네 상태와 판정 근거 필요. `truncated`는 output_limit으로 정규화되지 않고 stalled 정책 없음. 루프 완료, 과제 성공, 승인 거절, 도구 실패는 서로 다른 축이며 `ok` 하나로 추정할 수 없음 |
| **H41 필수** | null→{}, 스키마 밖 인자 실행 금지·수정 가능한 오류, 답 없이 잘린 출력은 한도 내 한 번 재요청 | `provider.ts:83` 정규화가 null을 {}로 바꾸고 배열·잘못된 JSON·중복 ID를 거절한다. SDK `agent-loop.js:498`은 도구 인자를 검사한 뒤 승인 훅을 부른다. `cli.mjs:253`은 모든 length 종료를 즉시 truncated 처리 | **부분**. null·추가 필드·필수 필드 누락 검사는 확인. SDK는 coercion을 하므로 원시 인자 엄격 검증과 다름. 빈 잘림 1회 재요청은 없음. 공통 MCP 자체에는 JSON Schema 전체 검사가 없어 다른 하네스 경로까지 같은 보장을 확대할 수 없음 |
| **H42 필수** | usage 옆 costBasis=list/unknown, 단가 없으면 비용 추정 없이 토큰 한도로 제한 | `cli.mjs:343`은 `costStatus:'not_calculated'`, usageComplete를 기록. SDK 내부 모델·응답 cost는 모두 0 placeholder. 응답별 maxTokens와 턴별 maxTurns만 있음 | **미구현**. costBasis 없음. 누적 입력·출력·전체 세션 토큰 상한 없음. 0 placeholder는 무료 또는 실제 비용 0 증거가 아님. 기존 비용 미상 표시는 유지하되 규격 필드·실제 예산 집행 추가 필요 |
| **H43 권장** | 한 곳의 맥락 창 설정, 유효 요약만 반영, 창 초과 실패, 원본 보존 | `cli.mjs:200` 모델 contextWindow는 128000 상수, 별도 context-chars 기본6000. `store.mjs:165`는 persona+memory를 문자 수로 선별하며 omittedCount를 공개함. 전체 대화 압축이나 요약 교체 경로 없음 | **미구현/별도 기능**. 문자 예산의 기억 선별은 대화 압축이 아님. 전체 history·도구 schema·추가 예제를 포함한 실제 모델 입력 한도와 단일 설정 필요. 평가 결과용 summarize.mjs는 대화 압축기가 아님 |
| **H44 권장** | 초기 도구 수·시스템 크기 제한, 나머지 필요 시 검색, 작업 지시는 user 역할로 한 번 | `cli.mjs:178` 허용 도구는 네 개, tools none은 0개. persona+memory 문맥 한도와 크기 로그 존재 | **부분**. 일반화된 도구 수 상한·tool_search 없음. 현재 문자 예산은 전체 대화나 schema·추가 예제를 모두 포괄하지 않음. AGENTS류 파일 로딩 기능과 user 1회 주입 계약은 없음. persona를 system으로 둔 사실만으로 작업 지시 계약을 충족했다고 볼 수 없음 |
| **H45 권장** | 특정 턴으로 되감아 잇기에서 선언 범위 밖 기록 손실 시 재개 거절 | `cli.mjs:337`은 실패 시 전체 대화 history를 비움. 기억 변경도 `:171`에서 history를 비움. `new`는 대화 이력 초기화. MCP artifact_undo는 파일 쓰기 스택만 되돌림 | **기능 미지원**. 특정 턴 resume/checkpoint와 삭제 범위 검증 없음. 파일 undo와 대화 rollback을 혼동하지 말 것. 추후 재개 기능에는 원본 snapshot·턴 ID·범위 비교 필요 |
| **H46 필수** | 사용자 문자열의 @경로 읽기·/명령 자동 실행 금지 | `cli.mjs:375`는 JSON prompt.text를 그대로 `agent.prompt(text)`로 전달하고 provider-bridge는 텍스트 역할을 변환한다. agent-core만 사용하며 CLI 확장·슬래시 명령·@파일 로더를 붙이지 않음 | **정적 경로상 일치**. 전용 H46 통합 회귀는 확인하지 못함. 사용자 지시를 모델이 해석해 승인된 MCP 호출을 요청하는 경우와, 입력 파서가 자동 확장하는 경우를 구분해야 함 |

## 3. 반드시 분리해야 할 구현 차이

### H40: 새 기억 Pi와 옛 비교 Pi의 결과가 다르다

옛 [harness-lab Pi](../harness-lab/pi/cli.mjs:150)는 거절 시 SDK에 `block:true`만 반환한다. 도구 결과 이벤트에서도 실패 상태를 누적하지 않으므로, 모델이 이후 정상 답변을 내면 `turn_end.ok`가 true일 수 있다. 규격의 “Pi 거절 뒤 ok:true” 근거는 이 경로와 맞는다.

반면 [memory-lab Pi](pi/cli.mjs:264)는 거절 상태를 먼저 저장하므로 같은 결과를 성공으로 내보내지 않는다. 그러나 SDK 루프는 도구 거절을 결과로 받은 뒤 계속 실행할 수 있고, 마지막 `ok:false`만으로 루프가 정상 종료했는지·과제 검증이 있었는지·어떤 도구가 실패했는지는 알 수 없다. 네 필드 추가는 아직 필요하다.

권장 결과 계약은 아래처럼 서로 독립적인 의미를 유지하는 것이다. 이는 **설계 제안**이며 현재 출력 형식이 아니다.

- `runCompleted`: 선택한 루프 종료 경계에 정상 도달했는지. 승인 거절의 도구 결과를 처리하고 종료한 경우에도 true일 수 있다.
- `taskSucceeded`: 독립 과제 판정이 있을 때만 boolean. 모델의 “완료했어요”, SDK 종료, JSON 파싱 성공을 판정으로 대체하지 않는다. 판정이 없으면 null 또는 명시적인 미평가 상태로 둔다.
- `policyRejected`: 승인·도구 정책에 의해 요청 효과가 거절됐는지. 거절 뒤 자연스러운 텍스트가 나와도 false로 되돌리지 않는다.
- `toolFailed`: 실제 도구 실행 또는 입력 검증 실패를 기록한다. SDK의 `isError`에는 승인 차단도 섞이므로 이를 무조건 복사하면 policyRejected와 혼동한다. 검증 실패·승인 차단·실행 실패의 분류와 집계 규칙을 고정해야 한다.

`ok`를 남긴다면 네 상태와 충돌하지 않는 호환 규칙을 정의해야 한다. H40은 문항별 성격·말투 점수를 CLI의 성공 값으로 포장하라는 요구가 아니다.

### H39: 무승인 서빙과 사람이 없는 운영 Task는 다르다

[LangGraph](../clova/langgraph.ts:65)의 `approve:'never'`는 ③ 서빙에서 허용된 도구를 승인 질문 없이 실행하는 정책이다. 이를 ② 무인 운영 Task의 “승인 필요 작업 즉시 거절”로 재사용하면 의미가 반대가 된다. ②에서 사람이 없고 작업이 승인을 요구한다면, 요청을 대기열에 남기거나 자동 허용하지 않고 즉시 거절해야 한다.

구현 시 실행 시간과 사람 대기 시간을 나누고, 승인·사용자 입력의 각 대기 구간에 상한을 둬야 한다. 만료·취소·EOF는 같은 일회용 pending 상태를 확정 종료해야 하며, 늦게 온 승인은 유효해지면 안 된다. responder와 이유를 기록하더라도 작업장 검사와 도구 한도는 이후에 다시 적용해야 한다.

### H41: 선언된 schema와 실제 검증은 다르다

파일·API 효과 없이 현재 `normalizeToolCalls`와 설치된 Pi SDK `validateToolArguments`를 직접 호출한 결과는 다음과 같다. 도구 함수·Brain 생성자·MCP 프로세스는 실행하지 않았다. 임시 파일도 만들지 않았다.

| 원시 인자 | 관찰 결과 | 의미 |
| --- | --- | --- |
| `null` | 정규화 후 `{}`, 필수 path/text 누락으로 검증 거절 | null 정규화와 수정 가능한 스키마 실패 경로 존재 |
| `{path:'a.txt', text:'x', unexpected:true}` | 검증 거절 | `additionalProperties:false` 준수 |
| `{path:'a.txt'}` | 검증 거절 | 필수 필드 누락 거절 |
| `{path:'a.txt', text:42}` | `{path:'a.txt', text:'42'}`로 변환 후 허용 | SDK `coerce:true`. 원시 타입 엄격 거절과 다름 |
| `{path:'a.txt', text:'x'}` | 그대로 허용 | 정상 입력 |

SDK는 검증한 인자를 승인 훅에 전달한다. 승인 화면이 원시 모델 인자와 달라질 수 있으므로, 허용할 정규화 범위를 정하고 **원시 인자·정규화 인자·승인 snapshot**을 구분해 남기는 편이 안전하다. 이 자료만으로 숫자→문자 변환이 규격 위반이라고 확정하지는 않지만, null 정규화 이외의 자동 변환도 있다는 사실은 공개해야 한다.

공통 [MCP](../clova/mcp.ts:20)는 schema에 `additionalProperties:false`를 선언하지만, [실제 tools/call 처리](../clova/mcp.ts:117)는 object 여부만 검사한 뒤 `tool.run(args)`를 부른다. 필수 path/text는 각 함수가 검사하지만 추가 필드는 공통 검사로 막지 않는다. Pi에는 SDK 선검증이 있으나 [LangGraph toolNode](../clova/langgraph.ts:144)는 MCP 호출 전에 동일한 JSON Schema validator를 적용하지 않는다. H41을 공유 런타임 전체의 보장으로 만들려면 MCP 경계에서도 일관된 검증이 필요하다.

빈 잘림 재요청도 별개다. 현재 Pi와 LangGraph는 finishReason=length를 즉시 실패로 처리한다. H41 적용 시 “사용 가능한 답변 없이 잘림”에만 한정해 남은 호출·토큰 예산 안에서 한 번 재요청하고, 이미 수행된 도구를 반복하지 않는 계약이 필요하다. 현재 페르소나 평가 계획의 **교정·재시도 0회** 조건을 소급 변경해서는 안 된다. 새로운 운영 프로필과 새 평가 계획에서 따로 검증해야 한다.

### H42: 단가 미상은 0원이 아니다

Pi의 내부 `usage.cost.total=0`과 모델 가격 0은 SDK 자료형을 채우는 값이며 실제 비용 증거가 아니다. 외부 요약은 `costStatus:not_calculated`로 구분하고 있어 미상 비용을 실제 0원이라고 주장하지는 않지만, H42의 `costBasis` 계약은 아직 없다.

[LangGraph](../clova/langgraph.ts:69)는 달러 비용 한도를 지정하면서 실제 모델의 단가표가 없으면 설정을 거절한다. 단가표 없이 실행할 수는 있으며 그때 내부 cost는 0으로 누적되고 [요약 기록](../clova/langgraph.ts:238)의 `costUsd`도 0이 된다. 이는 “단가 없음”과 “측정한 무료 비용”을 구분하지 못한다. H42에는 `unknown`과 토큰 한도 대체가 필요하다.

응답 한 번의 maxTokens, 한 턴의 maxTurns, 승인된 사용자 모임 기억, 실험 runner의 호출 한도는 **세션 전체 입력·출력 토큰 상한**과 같지 않다. 특히 history와 예제 입력은 반복 과금될 수 있다. 알려진 usage, usageComplete, 실제 모델/servedBy, 가격표 버전, 적용 단위와 한도 집행 지점을 구분해야 한다. 비용은 추정 숫자로 채우지 않는다.

## 4. 우선순위와 완료 판정용 작업 목록

다음은 구현 지시 완료 보고가 아니라 후속 작업안이다. 이번 감사에서는 코드를 변경하지 않았다.

| 순서 | 작업 | 완료를 확인할 회귀 사례 |
| --- | --- | --- |
| 1 | H40 결과 계약과 오류 분류를 Pi·LangGraph에 공통 정의 | 정상 종료/과제 판정 없음, 명시 승인 거절, invalid arguments, MCP 실행 실패, 모델 오류, 빈 잘림, 중단을 서로 구별. 거절 뒤 ok:true 없음. 원시 이벤트와 요약이 일치 |
| 2 | H38–H39 승인 관리자 | UUID·중복·문자열 true 거절, responder 기록, 만료 후 늦은 승인 거절, 1800초 대기 예산과 실행 예산 분리, 무인 즉시 deny, 여러 tool call 각각 승인, always_deny 우선, 세션 허용 뒤에도 경로/한도 검사 |
| 3 | H42 가격 근거와 세션 토큰 한도 | list/unknown 출력, 가격표 없는 비용 0 기록 금지, 누적 입력+출력 한도 도달 시 다음 호출 차단, 사용량 미상·실패 호출도 누락 없이 표시 |
| 4 | H41 공통 도구 경계와 제한된 빈 잘림 재요청 | null list 호출은 {}로 처리, null write는 수정 가능한 required 오류, 추가 필드/배열/잘못된 JSON은 실행 0회, coercion 정책 고정, 빈 length 한 번만 재요청, 도구 효과 중복 0 |
| 5 | H46 입력 경로 전용 검사 | prompt.text의 `@...`와 `/...`가 모델 입력에 그대로 남음. 입력 파서의 파일 읽기·프로세스 실행 0회. 도구 실행은 별도 승인 경로로만 |
| 6 | H43–H45를 지원 범위에 맞게 추가 | 단일 모델 문맥 예산, 빈/자리표시/생각 태그 요약 무반영, 초과 요약 실패와 원본 보존, 초기 도구 수/지시 크기 측정, 부분 되감기 선언 범위 밖 손실 차단 |
| 7 | H31 동일 묶음의 실제 HCX LangGraph/Pi 비교 | 같은 모델·질문·도구·승인·작업장·한도·산출물 판정. 오류·사용량·비용 근거·시간·파일 실제 내용·정리 결과를 모두 비교. 다른 주제의 Pi 페르소나 성공으로 대체하지 않음 |

새 운영 계약을 구현한 뒤 기존 공통 테스트와 규격 키트를 다시 통과시켜야 한다. 이 문서가 기존 기록의 “51/51”이나 별도 페르소나 평가를 새로운 H38–H46 적합성 결과로 승격시키지는 않는다.

## 5. 규격 서술의 시점 차이와 기준선

규격 [H12](../../../Elda-Spec/harness/SPEC.md:46)의 “HCX에는 effort가 없다”는 표현은 현재 모든 HCX 모델에 일반화할 수 없다. 기존 HCX-005에는 해당 설정을 거절하고, 현재 wrapper는 HCX-007의 native `thinking.effort`와 `maxCompletionTokens`를 지원한다. [generation config](../clova/clova-model-config.ts:53)와 앞서 확인한 [공식 NAVER Thinking 문서](https://api.ncloud-docs.com/docs/en/clovastudio-chatcompletionsv3-thinking)를 근거로 **모델별 능력 계약**으로 읽어야 한다. 이 차이를 이유로 규격 원문을 여기서 수정하지 않았다.

규격의 “Pi 실제 HCX 호출 0회”도 현재 기억·페르소나 실험 전체에는 더 이상 맞지 않는다. [memory-lab README](README.md:5), 실제 입력·응답·사용량이 있는 저장 자료와 [개발 probe 회고](research-2026-11-11-probes.md)가 Pi/Brain 실제 HCX 연결의 후속 증거다. 단, standalone Brain probe와 Pi 전체 경로도 구분해야 하며 단순 API 완료를 과제 성공으로 계산해서는 안 된다.

그럼에도 **현재 기준선은 LangGraph로 유지한다.** Pi 페르소나 비교는 LangGraph와 동일한 운영 과제 묶음의 실제 짝비교가 아니다. 새 모델·새 하네스 설정의 합산 개선, 같은 모델 안의 말투 개선, MCP 파일 과제의 운영 계약은 서로 다른 질문이다. 실제 호출이 존재한다는 이유로 H31을 통과했다고 말할 수 없다. 기존 실패·불완전 결과는 보존하고, 승격 여부는 새 공통 묶음 결과로 결정해야 한다.

## 6. 감사 시점 무결성 기록

행 번호는 감사 당시 소스 기준이다. 이후 구현 변경 시 해당 해시와 다른 소스를 이 감사의 확인 대상으로 오인하지 않도록 한다.

| 대상 | SHA-256 |
| --- | --- |
| Elda-Spec e1b3edc의 `harness/SPEC.md` blob | `c4963a8eaf681272fb3cbfa4cb1a3967f336f1fae001e20a3a8c0e272479c606` |
| `runtime/memory-lab/pi/cli.mjs` | `c61de4f81baa93a75c0c03f3e1b6a97494c80c5890e0dd8d3fde5cb06e08ed4a` |
| `runtime/memory-lab/pi/provider-bridge.mjs` | `3c40a91ae4340ef1b361ef1b998f3c5d808aae420f2e0952b0fc24998ca52f74` |
| `runtime/memory-lab/pi/store.mjs` | `2b53eaf041cb875b3e185de96f1d043735b3832a2f7288e76fedac166ac3a162` |
| `runtime/harness-lab/pi/cli.mjs` | `29adeaaab954b0b892c1896faf8e3da13ec805fd4689fd432cf74a6c1e4ab998` |
| `runtime/clova/langgraph.ts` | `b3fd4c2f6b3b56ab2d0db985a70d20702410c1da17f22bfd718620181abb1779` |
| `runtime/clova/mcp.ts` | `c110f48aa4704f982e1dbf32f80256dc4d19928f5af37e967f6d0e37abe0e1fe` |
| `runtime/clova/provider.ts` | `26fb934b0c91a65c379c72dfe3a212ad0c367358ad92102568c36d124b4bc224` |
| `runtime/clova/clova-model-config.ts` | `8b6950a7bae2eafd6eac25fcd900ce40804c321f86d9526c1887ed8dd33b7440` |

이번 검증은 규격 커밋·현재 소스·기존 테스트 정의의 읽기, 위 다섯 가지 순수 인자 검증, 해시 계산이다. 새 MCP/DB/CLI 실행 회귀나 실제 모델 호출은 하지 않았으며, “새 규격 전 항목 통과”라는 결과는 생성하지 않았다.
