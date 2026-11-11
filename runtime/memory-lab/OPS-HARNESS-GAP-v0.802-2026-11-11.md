# Elda-Spec v0.802 ② 운영 하네스 보충 감사 — 2026-11-11

**현재 memory-lab Pi·옛 비교 Pi·LangGraph 어느 경로도 v0.802 ② 전체 적합 상태로 판정할 수 없다.** 기억 Pi의 거절 후 `ok:false` 처리는 있으나 같은 응답의 남은 도구 호출 차단, 사람 대기 시간 분리, 결과·비용 출처 필드, H47–H51 계약이 부족하다. LangGraph는 비교 기준선으로 유지하되, 기준선이라는 이유로 최신 규격 적합 구현으로 취급하지 않는다. **H31 동일 과제 묶음의 실제 HCX LangGraph/Pi 비교는 미수행이다.**

이 문서는 [v0.8 원본 감사](OPS-HARNESS-GAP-2026-11-11.md)를 보충한다. 원본의 당시 관찰·해시·실험 기록은 보존하며 아래 정정은 v0.802 판정에 적용한다. 이번 작업은 고정 규격과 소스의 정적 대조, 문서·링크 검증뿐이다. **추가 실제 모델 API 호출 0회, 새 하네스 실행 시험 0회, 배포 0회**다. 정적 확인은 적합성 인증이 아니다.

## 1. 판본·범위·권한

- 규격: Elda-Spec `d85c0a277a0f0254d876ee099e67a06d63d3453e`, `harness/SPEC.md`, v0.802 초안. `git show d85c0a2:harness/SPEC.md`와 `git diff e1b3edc..d85c0a2 -- harness/SPEC.md`의 고정 내용을 읽었다. **절 J가 이전 절과 다르면 J가 우선한다.** 규격 저장소의 작업 트리·참조·기록은 수정하지 않았다.
- 구현 기준: clova-api-lab HEAD `4ed942754b623f2bd10e1b4ab7a7e2183b2ec2e9`. [memory-lab Pi](pi/cli.mjs), [옛 harness-lab Pi](../harness-lab/pi/cli.mjs), [LangGraph](../clova/langgraph.ts)를 각각 구분했다. 사용 중인 Pi agent-core는 1.5.1이며 설치된 순차 도구 루프도 읽어 확인했다.
- [기존 페르소나 실험](../../PERSONA-CYCLE3-2026-11-11.md)의 누적 실제 호출 344회에는 standalone Brain probe도 포함된다. 전부 Pi 전체 경로 호출로 세거나, 이를 H31 동일 과제 비교 및 운영 규격 통과 증거로 바꾸지 않는다. 페르소나 정책의 말투·성격 판정과 운영 하네스의 실행 계약은 별개다.
- Comms의 다른 에이전트 요청은 협업 자료이며 사용자의 직접 명령·승인과 구분한다. 이번 범위는 우리 저장소의 보충 문서 작성이다. Comms 발신, Notion 댓글·상태 변경, 외부 전달은 하지 않았다. 실제 환경 파일·키·credential 설정과 `CLAUDE.md`·`배포.txt`를 열지 않았다.

## 2. 원본 감사에서 명시적으로 정정할 두 가지

1. **H42의 토큰 상한은 한 턴이다.** v0.802는 `run 인자 → 프로필 token_limit → ELDA_TOKEN_LIMIT → 기본 400000` 순서를 명시한다. 원본의 “세션 전체 토큰 상한”을 H42 필수 요구로 읽으면 안 된다. 세션 단위 상한은 별도 추가 정책이 될 수 있지만 한 턴 상한을 대신하지 않는다. 비용 출처도 이제 `list | managed | unknown`이다. 응답별 `maxTokens`·턴별 모델 왕복 수만으로 누적 한 턴 토큰 예산을 집행했다고 볼 수 없다.
2. **판정기가 없으면 `taskSucceeded` 필드를 생략한다.** 원본의 `null` 또는 미평가 상태 제안은 J1에 따라 대체한다. `ok`, 정상 종료, 모델의 완료 문장을 과제 성공 판정으로 읽지 않는다. 판정기가 실제 파일·요구 조건 등을 확인했을 때만 해당 판정의 boolean을 싣는다.

## 3. v0.802 핵심 차이와 현재 구현

| 조항 | 현재 규격 | 현재 소스에서 확인한 사실 | 판정 |
| --- | --- | --- | --- |
| H31 | 같은 과제 묶음에서 모델·하네스를 바꾸어 오류·비용·시간·산출물 비교. 같은 묶음에서 뒤처지지 않아야 기준선 교체 | 페르소나 정책 비교와 예전 scripted 51/51은 이 비교가 아니다. 새 matched HCX 실행 결과 없음 | **미수행**. LangGraph 기준선 유지 |
| H38 / J1 H2 | 실행기 발급 일회용 approvalId, strict boolean, 잘못된 답은 대기 유지. responder·승인 범위·도구 정책 등 | 세 CLI 모두 boolean/ID 기본 검사가 있다. 기억 Pi는 입력 snapshot과 UUID를 보존한다. 기억 Pi는 responder 필드도 strict keys에서 거절하며 결과 타입·만료·승인 기억 범위는 없음. 오류명은 `bad_input` 대신 `invalid_input`/`no_such_approval` 등 | **부분**. SDK `defaultToNo`는 화면 기본 선택 설명이며 시간 초과 자동 거절 근거가 아님 |
| H39 | 사람 대기 동안 턴 실행 시계 정지, 별도 기본 1800초 대기 한도. 무인 Task에서 승인 필요 작업은 즉시 거절 | 세 경로 모두 턴 타이머가 승인 대기 중 흐름. 기억 Pi의 remember/forget 승인은 모델 턴 타이머 밖에서 기다릴 수 있음. 무인 실행과 대화형 실행의 별도 승인 처리 없음 | **미구현**. LangGraph `approve:never`의 허용 도구 무질문 실행을 무인 ②의 즉시 거절로 간주할 수 없음 |
| H40 / J1 | runCompleted / taskSucceeded(판정 있을 때만) / policyRejected / toolFailed 분리. denied이면 같은 응답의 남은 호출을 묻지도 실행하지도 않음. tool_result.sideEffect 필요 | 기억 Pi는 `state.failure='denied'`를 보존해 마지막 ok:false는 가능하나 다음 승인·실행을 차단하지 않음. 옛 Pi·LangGraph는 거절 뒤 정상 모델 종료 시 ok:true가 될 수 있음. 세 경로 모두 네 결과 필드와 sideEffect 없음 | **부분 또는 미구현**. 거절 결과와 실제 도구 실패를 따로 집계해야 함 |
| H42 / J1 H5 | costBasis=list/managed/unknown, 한 턴 토큰 한도. usage 네 칸과 미보고 칸 usageUnreported 구별 | 기억 Pi는 usageComplete·costStatus:not_calculated만 제공. 세 경로 모두 costBasis·usageUnreported·규격의 token_limit 우선순위/집행 없음. LangGraph는 단가 없는 요약에 costUsd:0을 쓸 수 있음 | **미구현**. SDK의 가격 0 placeholder와 실제 비용 0을 구분해야 함 |
| H47 필수② | **waiting state를 approval보다 먼저** 전송, 해결 시 running, 대기 중 같은 state를 60초마다 전송 | 기억 Pi approve()는 바로 approval만 전송. 옛 Pi·LangGraph에도 해당 state/heartbeat 없음 | **미구현**. 상태 이벤트와 H39 실행 타이머 정지를 함께 검증해야 함 |
| H48 필수② | approval_result: allowed/denied/timeout/cancelled/unavailable. 모델 문구도 구별. 같은 대화 거절 3회 뒤 추가 질문 중단. 인자 기반 승인 요약과 따옴표·KEY=VALUE 가림 | 현재 승인은 boolean 중심이며 결과 이벤트·대화별 거절 횟수 정책 없음. 일반 비밀값 가림 유틸리티 존재만으로 승인 전용 요약 계약을 충족하지 않음 | **미구현**. 취소·시간 초과를 사용자의 명시 거절로 바꾸지 말 것 |
| H49 필수② | 도구·글 모두 없는 답은 동일 요청 1회, 짧은 재촉 1회, 이후 stalled. 답 없이 출력 상한이면 기존 한도 안 1회 | 현재 length는 즉시 truncated. 운영용 빈 응답 복구 사다리 없음. 일부 페르소나 정책의 교정 호출은 다른 조건·목적 | **미구현**. 기존 동결 평가의 재시도 0회 기준을 소급 변경하지 않음 |
| H50 필수 | apiError를 인증/요금/속도/요청/서버/모델 없음/미상으로 분류, 공급자 본문 요약 최대160자·키/요청 본문 제외 | 공통 Brain·HTTP Wrapper는 주로 api_error와 HTTP status만 제공. 응답 본문은 경계에서 가리지만 규격의 분류가 없음 | **미구현**. 안전한 요약과 재시도 분류를 함께 정의해야 함 |
| H51 필수② | tools allow/ask/deny, deny 숨김. **도구 명시 allow/deny > 실행에서 명시한 --approve ask > readOnlyHint 기본 > 프로필 기본**. 잘못된 값은 bad_input | 기억 Pi는 도구 all/none과 모든 호출 승인, LangGraph는 MCP allowlist·전체 approvalMode·hook 권한을 사용. 새 프로필 정책 및 우선순위 없음 | **미구현**. readOnlyHint라도 명시적 --approve ask를 무시하면 안 됨 |

H47과 H51은 v0.802에서 순서를 명확히 한 항목이다. 규격의 Elda CLI e332e3b 및 규격 키트 경고 0 기록은 **그 구현의 결과**이며 이 저장소의 Pi·LangGraph 시험 결과가 아니다.

### H40: 마지막 ok:false만으로 남은 호출을 막지는 않는다

[기억 Pi의 beforeToolCall](pi/cli.mjs:272)은 거절을 failure에 저장하고 `{block:true}`를 반환한다. 다음 호출의 approve()와 execute()는 그 failure를 차단 조건으로 쓰지 않는다. 설치된 Pi 1.5.1 `agent-loop.js`의 순차 루프는 각 호출을 계속 처리하며 signal abort에서만 중간 break한다. `terminate`도 배치 종료 판정에서 모든 결과를 검사하므로 **첫 거절에 terminate:true 한 줄만 추가해서 같은 배치의 남은 호출이 사라진다고 가정하면 안 된다.** 대기 질문·실행 양쪽에서 거절 이후 경계를 보장하고, 호출/결과 쌍과 종료 이벤트가 맞는지 별도 회귀가 필요하다.

[옛 Pi](../harness-lab/pi/cli.mjs:167)는 거절을 턴 failure로 유지하지 않는다. [LangGraph toolNode](../clova/langgraph.ts:144)는 거절된 호출을 `ok:false` 도구 결과로 추가한 뒤 다음 호출과 모델 단계로 진행하며, 정상 모델 종료 시 turn_end는 completed/ok:true가 된다. 따라서 “Pi 거절 처리 문제는 해결됐다” 또는 “LangGraph는 최신 계약을 충족한다”는 범용 결론을 내릴 수 없다.

sideEffect는 `not_started`(실행 전 거절·검증 실패), `completed`, `unknown`으로 구분한다. 도구에 전달된 뒤 연결이 끊긴 경우를 무조건 not_started로 처리하거나 실행을 재시도하면 안 된다. 현재 기억 Pi의 불확실한 MCP 효과 시 poisoned/restart 처리와 별개로, 공식 이벤트에 해당 구분을 실어야 한다.

### H20: HTTP 200 본문 오류의 두 경로를 구분한다

[provider.ts](../clova/provider.ts:68)는 CLOVA `status.code != 20000`을 status 없는 `Fault('api_error', ...)`로 바꾼다. [LangGraph 직접 Brain 경로](../clova/langgraph.ts:125)는 status가 429/500/502/503/529일 때만 도구 실행 전 한 번 재시도하므로 **이 본문 실패를 지금 직접 자동 재시도하지는 않는다.** 다만 공급자 코드를 잃으므로 실제 일시 코드인지 판단할 수도 없다.

반면 [HTTP Wrapper errorDetails](../clova/http.ts:114)는 status 없는 Fault를 **502**로 응답한다. 외부 소비자는 인증·요금·잘못된 요청에 해당할 수 있는 본문 실패를 일시 서버 오류로 오분류할 수 있다. 규격 J1의 502 위험은 이 경계까지 살펴야 한다. provider 코드와 정규화된 apiError·retryable 분류를 안전하게 유지하고, `Retry-After`와 `retry{attempt,status,delayMs}` 이벤트를 추가해야 한다. 현재 LangGraph 재시도는 지연/헤더 처리·retry 이벤트가 없다. 재시도는 도구 실행 전 일시 오류 최대1회 조건을 유지해야 한다.

native CLOVA의 도구 description 누락은 이 감사의 미해결 항목이 아니다. [현재 provider](../clova/provider.ts:48)는 공백/누락 description을 outbound 요청에서 도구 이름으로 대체한다. H20 오류 분류와 이 이미 반영된 호환 수정은 구분한다.

## 4. 절 J에서 함께 추가·정정된 범위

- **H4/H33/H34:** output_limit 등 오류 이름을 통일해야 한다. 중단은 error{interrupted}+idle이며 turn_end는 내지 않는 계약을 유지한다. 기억 Pi는 finally에서 turn_end를 항상 내므로 이 차이도 남아 있다. SDK query의 max_turns와 우리 한 턴의 모델 왕복 상한은 같은 단위가 아니다. 상한 도달 시 마무리 보고1회는 권장 사항이다.
- **H36/H37:** 훅 병합 deny>ask>allow, 막을 수 없는 훅에서 deny 설정 거절, Stop/SubagentStop on_failure 예외, UserPromptSubmit timeout 차단과 Stop timeout 무결정, updatedMCPToolOutput 계약을 별도로 맞춰야 한다. LangGraph의 단일 훅·일반 onFailure 처리를 이 계약 전체로 확대할 수 없다. SDK allowed_tools는 무질문 허용 의미이며 우리 attached MCP allowlist와 구별한다.
- **H41:** 적용 기준은 tier가 아니라 provider≠anthropic이다. null→{} 이후 문자열 객체·배열은 해당 schema에 맞게만 정규화하며 구조를 지어내지 않는다. 실행 전 오류는 `{category,badField,validShape,retryable,sideEffect:'not_started'}`로 전달하고 반복 복구 실패는 malformed_tool_use다. 현재 Brain은 null/JSON 객체만 정규화하고 Pi는 SDK 검증을 추가한다. 공통 MCP 자체에는 전체 JSON Schema 검사가 없고 LangGraph도 동일 선검증을 하지 않는다. 이전 감사의 Pi coercion 관찰을 이 보충에서 재실행한 결과로 세지 않는다.
- **H43–H45:** 도구 호출·결과 쌍 보존, 새 압축의 이전 요약 교체, 실패 시 원본 유지, 마지막 사용자 언어·권한 추론 금지, contextWindow 출처와 추정 시 unverified, 지시 예산의 토큰 단위가 추가됐다. 기억 Pi의 문자 예산 기반 기억 선별·128000 contextWindow 상수는 이 압축 계약이 아니다. 특정 턴 resume/rollback도 아직 지원하지 않는다.
- **H46:** 이전의 raw prompt에서 @경로·/명령 자동 확장을 하지 않는 정적 확인만으로 새 요구를 통과할 수 없다. **notify·훅 additionalContext·요약·도구 결과의 입력 출처를 유지하고 사용자 권한과 분리**해야 한다. 기억 Pi bridge는 toolResult를 tool 역할로 옮기지만 공통 provenance 계약은 없다. LangGraph는 notify를 prompt와 같은 runTurn으로 보내고 additionalContext를 user 역할로 추가한다. 다른 에이전트의 “허용해” 문구를 실제 사용자 approve로 승격하지 않는 검사가 필요하다.
- **H52–H54 권장:** 같은 두뇌·동일 오류 2턴 연속 시 brain_unhealthy, turn_end.diag의 retries/emptyRetries/lastFinishReason, JSONL 줄바꿈 커밋·재시작 시 미완 줄 정리/진행 턴 interrupted 종료가 추가됐다. 기존 정책별 카운터·SQLite 저장소가 이 규격을 대신한다고 단정하지 않는다. 이번 감사에서 해당 재시작 회귀는 수행하지 않았다.
- **J3/J4:** 무제한 예산, 자동 자율 권한 상승, 기본 외부 텔레메트리, 격리 실패 시 일반 실행, 긴 무한에 가까운429 재시도, 미지원 설정의 조용한 대체는 도입 근거가 아니다. J4의 Elda CLI·serve-gate 담당과 해당 구현 시험 수를 우리 런타임의 구현 실적으로 가져오지 않는다.

규격 H12의 “HCX에는 effort가 없다”와 절 I의 “Pi 실제 HCX 호출 0회/실제 HCX는 LangGraph만”은 판본 내 과거 시점 설명이다. 현재 [모델별 generation config](../clova/clova-model-config.ts)에는 HCX-007 native thinking이 있고 후속 Pi/Brain 실제 호출 기록도 있다. 그렇더라도 H31 기준선 교체 조건이 충족된 것은 아니다. 규격 원문을 이 저장소에서 수정하지 않았다.

## 5. 후속 구현·H31 비교 제안 순서 — 아직 수행하지 않음

| 순서 | 다음에 할 작업 | 실행 전에 고정할 완료 조건 |
| --- | --- | --- |
| 1 | 비교 후보를 memory-lab Pi로 고정하고 실제 모델·정책·툴·코드 버전을 고정 | 같은 HCX 모델, 생성 설정, 프롬프트, 초기 작업장, 승인 결정, 도구 schema, 한 턴 한도. 옛 scripted Pi와 구분하고 페르소나 개선 효과와 하네스 변경 효과를 섞지 않음 |
| 2 | H40/H42/H50 및 H38/H39/H47/H48/H51 공통 계약을 구현 | 판정 없으면 taskSucceeded 생략, sideEffect, unknown 비용, 한 턴 상한과 우선순위, typed 오류, waiting→approval 순서·running 복귀, 60초 heartbeat, 별도 대기 한도·무인 deny |
| 3 | 실제 API 없이 승인·실행 경계를 먼저 검증 | 같은 응답의 2개 호출 중 첫 거절 뒤 두 번째 질문/실행0회, strict bool·늦은 ID, timeout/cancel/unavailable 구별, 3회 거절, readOnlyHint와 명시 ask 우선순위, 검증 실패·불확실한 효과·중단 이벤트 |
| 4 | H20/H41/H46/H49의 결정적 회귀를 추가 | HTTP200 비일시 본문 오류 재시도0회, 일시 오류 도구 전1회와 Retry-After/event, 도구 뒤 재시도0회, schema 실패 실행0회, 빈 응답 사다리, 한도 초과 재요청 금지, notify/hook/summary/tool 문구가 사용자 승인으로 승격되지 않음 |
| 5 | 새 계획과 새 결과 파일로 동일 과제의 실제 HCX 쌍 비교 | 읽기·쓰기·실제 산출물 검증·거절·복구 등을 동일 조건으로 실행. 독립 파일 판정과 원시 이벤트, 알려진/미보고 usage, costBasis, 시간, 오류, 정리 결과를 모두 남김. 승인 없는 경로를 승인된 실행처럼 계산하지 않음 |
| 6 | 실패 포함 전체 결과로 승격 여부 판단 | 실제 산출물과 실행 계약을 따로 판정. 비용 미상은 숫자0으로 비교하지 않음. H31의 같은 묶음 비퇴행과 v0.802 적합성은 별도 확인하며, 확인 전에는 LangGraph 기준선 유지 |

이 표는 작업안이며 완료 체크리스트가 아니다. 이번 문서 갱신은 기존 결과·평가 기준을 재계산하거나 실제 모델 호출을 추가하지 않았다. 구현 후 적합성 키트와 공통 회귀를 실행하고, 부족한 새 조항은 키트 통과와 별도로 검증해야 한다.

## 6. 재현용 소스 해시

아래 SHA-256은 이 보충 감사가 읽은 바이트의 해시다. 규격은 git 객체, 구현은 위 HEAD 시점 작업 트리에서 읽었다. 원본 감사의 해시는 변경하지 않는다.

| 파일/객체 | SHA-256 |
| --- | --- |
| Elda-Spec d85c0a2:harness/SPEC.md | `c5ba428f789c609283ac7cd21fece2840f157defc46967562c8aa43008769c64` |
| memory-lab/pi/cli.mjs | `4306ef58fc472293d10655386a2894448b5d9806631a24f8e103ab8901c00c7d` |
| memory-lab/pi/provider-bridge.mjs | `3c40a91ae4340ef1b361ef1b998f3c5d808aae420f2e0952b0fc24998ca52f74` |
| memory-lab/pi/store.mjs | `2b53eaf041cb875b3e185de96f1d043735b3832a2f7288e76fedac166ac3a162` |
| harness-lab/pi/cli.mjs | `29adeaaab954b0b892c1896faf8e3da13ec805fd4689fd432cf74a6c1e4ab998` |
| clova/langgraph.ts | `b3fd4c2f6b3b56ab2d0db985a70d20702410c1da17f22bfd718620181abb1779` |
| clova/provider.ts | `e32d06471d11d30f43192d23e136300f50db01eae115d646534e2d262b500649` |
| clova/http.ts | `28ef1adaa16c89b1cab17899333eb68e45a8c71a6fa85c95f4f89b27b8b931b5` |
| clova/mcp.ts | `c110f48aa4704f982e1dbf32f80256dc4d19928f5af37e967f6d0e37abe0e1fe` |
| clova/common.ts | `214642e57dd634c4fb51aba0f0f5245af1d9ea784a2efbdd1b283593bd8c7a1e` |
| clova/clova-model-config.ts | `8b6950a7bae2eafd6eac25fcd900ce40804c321f86d9526c1887ed8dd33b7440` |
| 설치된 pi-agent-core/dist/agent-loop.js | `22ee81f9977e211044c1ad41a763876c793ca7fc1c5b39b9fa7f76f3cb281129` |
