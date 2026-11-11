# Pi 기억·페르소나 독립 실험

Node 24.15.0, 실제 `@earendil-works/pi-agent-core@1.5.1`, `@earendil-works/pi-ai@1.5.1`, `node:sqlite`로 구현했다. Pi 패키지는 기존 `runtime/harness-lab/pi/node_modules`의 고정된 설치를 읽기 전용으로 재사용한다. 기존 하네스 파일·루트 package·프로덕션 DB·레퍼런스·배포는 변경하지 않았다.

## 실행

저장소 루트에서 자체 검사를 실행한다. fixture·SQLite·작업장·결과물은 이 폴더의 `.smoke/` 아래 생성된다. 자체 검사는 scripted 모델과 loopback HTTP mock만 사용하며 외부 LLM API나 실제 키는 사용하지 않는다.

```bash
node --check runtime/memory-lab/pi/cli.mjs
node --check runtime/memory-lab/pi/store.mjs
node --test runtime/memory-lab/pi/smoke.test.mjs
```

공통 runner는 다음 진입점을 사용한다. STORE/PERSONA/SCRIPT는 이 저장소 안의 절대 경로여야 한다.

```text
node runtime/memory-lab/pi/cli.mjs --store STORE --principal alice --conversation c1 --persona PERSONA --script SCRIPT
```

선택 옵션은 `--scope session|long_term`, `--context-chars 6000`, `--max-turns 4`, `--timeout-ms 120000`, `--max-tokens 2048`, `--tools none|artifacts`이다. session과 artifacts가 기본이다. long_term은 합성 fixture에만 사용하는 명시적 실험이며 자동 학습을 켜는 옵션이 아니다.

실제 모델은 `--script SCRIPT` 대신 `--model clova:HCX-005`로 선택한다. 두 옵션은 상호 배타이며 자동으로 실제 API로 넘어가지 않는다. CLOVA 키는 기존 Brain 계약의 `CLOVA_API_KEY_FILE` mode 600 파일로 전달한다. 기존 Brain이 허용하는 Groq/OpenRouter/Z.ai selector도 같은 adapter를 사용할 수 있으나 이번 연결 검증은 CLOVA loopback HTTP를 대상으로 했다. 각 공급자의 키·모델 allowlist·endpoint 정책은 기존 Brain을 따른다. CLOVA에 artifact tools를 제공할 때 max-tokens 최소값은 1024이며 최대 2048이다. `--tools none`이면 Agent.tools와 Brain tools는 빈 배열이며 HTTP 요청에서 tools 필드를 생략한다. 이때 max-tokens는 1..2048이다. MCP 초기화와 종료는 동일하게 유지한다.

```text
node runtime/memory-lab/pi/cli.mjs --store STORE --principal alice --conversation c1 --persona PERSONA --model clova:HCX-005 --tools none --max-turns 1 --max-tokens 2048
```

실제 API 호출과 말투·성격 품질 평가는 루트의 별도 runner가 담당한다. 이 adapter 구현 작업에서는 실제 네이버 API를 호출하지 않았다.

기존 Pi 패키지를 별도로 준비해야 하는 새 checkout에서는 원래 harness-lab/pi의 package-lock과 설치 절차를 사용한다. 이 구현은 다른 버전이 감지되면 시작하지 않는다.

## 어느 계층이 제공하는가

- **Pi SDK:** 실제 Agent 모델/도구 반복, tool schema 검증, 순차 실행, `beforeToolCall` 차단 hook, 중단 signal, 실제 모델 callback의 메시지 배열.
- **이 adapter:** namespace, SQLite schema/transaction/revision, evidence digest, 검색·문맥 조립, immutable persona 검증/hash, JSONL 승인 ID·대기·거절, literal 출력 검사와 1회 교정.
- **기존 MCP:** artifact_list/read/write/undo와 실제 파일 효과·undo. 파일 기능을 복제하지 않는다. 모델 키가 없는 최소 환경으로 stdio 서버를 실행한다.

따라서 “Pi에 이 DB 기억 시스템이 기본 내장돼 있다”거나 “실제 모델이 페르소나에 맞는 대답을 했다”는 자체 검사 결과가 아니다. scripted Brain Answer와 loopback HTTP를 Pi 모델 stream으로 변환하여 실제 경계를 검증했다.

실제 모델 경로에서는 `provider-bridge.mjs`가 Pi SDK의 getCurrentSystemPrompt/getCurrentTools로 실제 transcript의 system section·tool 추가/제거를 재생한다. assistant toolCall ID, tool 결과 ID, 공급자별 reasoning metadata를 기존 Brain Message로 보존한다. 교정 시 SDK에서 도구를 비활성화하면 실제 Brain 요청에서도 tools가 제거된다. 도구 목록을 네 개로 고정해 다시 전달하지 않는다.

## 기억과 근거의 규칙

session identity는 principal + persona ID + conversation이며 scope도 구분한다. long_term identity는 principal + persona ID + scope이고, 근거에는 원래 conversation이 남는다. CLI identity는 운영자가 고르는 구분 값이며 로그인·인증·권한 관리 구현은 아니다.

`observe`는 원문을 DB에 쓰지 않는다. SHA-256과 `turn://` pointer만 메모리에 등록한다. 같은 범위의 turn ID에 다른 원문이 들어오면 evidence_conflict다. 승인된 remember transaction에서 필요한 evidence digest/pointer와 기억 tuple을 함께 저장한다. 따라서 observe·거절·승인 대기 중 interrupt는 DB 데이터의 변경을 일으키지 않는다. DB schema는 모든 persona/input 설정 검증을 통과한 후 ready 이전에 초기화한다.

기억 입력은 fact/preference/promise/event의 닫힌 tuple이다. slot·thing 각 128자, 문자열 value 4096자, evidence text 100000자까지 받는다. 문자는 Unicode code point 수다. value는 null을 제외한 string/finite number/boolean이며 polarity와 timezone이 있는 ISO observed_at을 검증한다. tuple에 principal·scope·approval·authority 같은 추가 필드를 넣을 수 없다. 자유 텍스트의 사실 추출이나 embedding 검색은 구현하지 않았다.

같은 namespace의 slot + thing이 현재 기억의 identity다. kind/value/polarity가 같으면 승인 후에도 idempotent로 처리하고 revision을 올리지 않는다. 근거/관측 시간이 새로 들어와도 값이 같으면 기존 provenance를 유지한다. value·polarity·kind가 달라지면 기존 row는 superseded, 새 row는 active로 저장하며 revision이 증가한다. transaction 안에서 현재 row를 다시 읽으므로 동시에 승인된 정정도 순서대로 처리된다.

forget은 slot, 선택적으로 thing으로 지정하며 승인 후 일치하는 모든 revision을 삭제한다. evidence digest/pointer registry는 원문 ID 충돌 검사를 위해 남는다. 원문 transcript는 저장하지 않는다. SQLite 페이지나 이미 남은 테스트 산출물의 포렌식 삭제를 보장하지 않는다.

승인 payload는 미리 복사·동결한다. 잘못된 승인 값과 stale/중복 ID는 거부한다. 승인 대기 중 recall은 가능하지만 추가 변경 요청은 busy로 처리한다. correction/forget 승인 뒤에는 대화 history도 비워 예전 검색 결과나 모델 응답이 다음 요청에 남지 않도록 했다. `new`는 history만 비우며 namespace·기억·evidence registry·script cursor는 보존한다.

`idle`은 활성 작업과 승인 대기가 모두 끝난 뒤에만 출력한다. 공통 검사에서 승인 대기 중 잘못된 승인 입력 뒤의 `idle{busy:true}`가 완료로 오해될 수 있음을 발견해 제거했다. 수정 후 `stale_duplicate_boolean_approval` 공통 재검사가 통과했다. 대기 중 입력 오류는 error만 내며 기존 승인은 그대로 유지한다.

## 페르소나와 모델 문맥

persona JSON은 시작 시 검증한 읽기 전용 객체다. 원본 파일 bytes의 SHA-256을 ready/model_context에 공개하며 파일을 다시 쓰지 않는다. 알 수 없는 필드는 모두 거부하고, persona의 outputRules 역시 운영자 파일에만 존재한다. 기억 value가 역할·권한·승인 변경을 요구해도 실행 정책을 변경하는 코드 경로는 없다.

회상은 active row를 slot/thing/revision으로 정렬하는 결정적 조회다. 정확한 slot 필터도 지원한다. anchor를 먼저 보존하고, 전체 row를 넣을 수 있을 때만 추가한다. anchor 자체가 한도를 넘으면 명시적인 context_budget 오류로 시작을 중단한다.

`--context-chars`는 **조립한 persona + memory 문자열의 Unicode code point 수**를 제한한다. 도구 선언, 사용자 입력, 대화 history까지 포함한 전체 모델 context/token 한도는 아니다. model_context에는 selectedCount/omittedCount/contextChars와 한도 단위를 함께 기록한다. 모델 callback이 실제로 받은 `context.messages`와 재생한 systemPrompt를 노출하므로 주입 근거를 검사할 수 있다. 공개 산출물에는 합성 평가 입력만 사용한다.

## 실제 모델 이벤트 계약

- ready: `model`, `syntheticOnly`, `providerTransport`(`none`/`loopback`/`remote`), `toolMode`(`none`/`artifacts`), `maxTokens`.
- model_context: 실제 Pi `messages`, 실제 system text인 `systemPrompt`, 활성 `toolNames`, `model`, `requestIndex`, `phase`, `synthetic`, `providerTransport`. Pi 1.5.1은 system을 `context.messages` 안에 두며 `context.systemPrompt`를 별도로 제공하지 않는다.
- **model_response**: Brain 경로의 요청마다 `requestIndex`, `phase`(initial/correction), `model`, `providerTransport`, `synthetic:false`, `ok`, `content`, `toolCalls`, `finishReason`, `usage`. 실패하면 content 대신 typed error와 확보한 usage 또는 null을 남긴다. 이는 승인된 최종 표시 텍스트와 구분되는 원시 응답 진단 이벤트다.
- turn_end: `model`, `synthetic`, `providerTransport`, `providerCallAttempts`, `externalModelCalls`, `modelResponses`, `finishReason`, `usage`, `usageComplete`, `costStatus`, 기존 종료/도구/시간/교정 필드.

providerCallAttempts는 loopback을 포함한 Brain 호출 시도 수이고 externalModelCalls는 remote endpoint를 향한 Brain 호출 시도 수다. 별도 패킷 계측 수치는 아니다. 정상 Brain call은 HTTP 요청 한 번을 수행하며 이 adapter에 자동 재시도는 없다. script에서는 두 값 모두 0이다. 오류로 토큰을 확인할 수 없으면 usageComplete:false로 표시하여 부분 합계를 총 사용량으로 오해하지 않게 한다. costStatus는 not_calculated이며, SDK model 객체 내부의 cost 0 필드는 실제 API가 무료라는 의미가 아니다.

length 종료도 model_response에 원시 부분 content와 토큰을 보존한다. turn_end.finishReason은 length, endReason은 truncated이며 정상 최종 text로 출력하지 않는다. 원시 품질 평가자는 model_response를 검사해야 한다. literal persona 규칙으로 차단된 출력도 진단 model_response에는 존재할 수 있으므로 text 이벤트와 구분한다.

optional outputRules.forbiddenPhrases는 exact, case-sensitive literal 검사다. 최종 text를 먼저 buffer하고, 위반 시 한 번만 실제 Agent.prompt를 추가 실행한다. 교정 호출은 도구를 비활성화하며 다시 위반하면 persona_violation으로 막고 text를 출력하지 않는다. 정상·교정된 최종 텍스트만 text 이벤트로 나간다. 진단 model_context에는 실제 이전 assistant 메시지와 operator rule도 포함될 수 있다. 이 검사는 의미·말투·인격 일관성을 평가하는 semantic judge가 아니다.

## 검증 결과

기존 자체 프로세스 smoke 네 항목:

1. observe/거절 후 SQLite bytes가 변경되지 않음. 승인 저장 후 새 프로세스 복원, principal/persona/conversation 세 격리축, 다른 evidence 충돌, 정정 revision 2, 반복 idempotence, forget의 전체 revision 삭제와 새 프로세스 model_context 누락 확인.
2. 명시적 long_term만 다른 conversation에서 회상하며 originating conversation을 유지. 기본 session에는 long_term 데이터가 나타나지 않음.
3. 실제 Pi callback에 공격적인 기억 문자열이 들어가도 MCP write 전에 승인을 요구. 승인 후 실제 파일 바이트가 바뀌며 persona 파일 bytes는 불변.
4. literal rule의 정상 응답, 1회 교정 성공, 2회 연속 위반의 출력 차단을 실제 Agent 호출로 확인.

실제 provider adapter 추가 후 검사 네 항목을 더했다: CLOVA loopback의 system/기억/네 schema/tool ID 이력/다음 prompt 이력/1024 토큰 설정/usage/교정 시 도구 제거, length 원시 응답·usage 보존, 진행 중 HTTP 취소·usage 불확실성, Pi system section/tool delta와 공급자 reasoning 변환.

`--tools none` 추가 검사는 실제 SDK 문맥과 HTTP 요청에 도구가 없는지, 페르소나 system이 보존되는지, max-turns 1에서 mock 응답이 전달되고 승인·도구 실행이 없는지 확인한다. 이 검사는 모델의 성격 유지 품질을 증명하지 않는다.

마지막 전체 자체 smoke 실행은 **9/9 통과**했다. 외부 모델 호출 수는 0이며 HTTP 요청은 로컬 mock에서만 처리했다.

live 경로를 처음 추가했을 때 공통 scripted 회귀는 **24/24 통과**했다. 결과는 [pi-live-regression.json](../results/pi-live-regression.json)에 별도 저장했으며 이전 결과를 덮어쓰지 않았다. 해당 CLI source SHA-256은 기존 `b96f7c000924d62eb46d2a3d377a72c1c739a839fa451ec21abeb81a3a0f8bb4`에서 `d2e50b47e4f6add59b7abf64533f8031dbef3b772ccd698380781b0f627207bb`로 바뀌었다. 이후 `--tools none` 추가와 자체 9/9 smoke를 마친 최종 CLI SHA-256은 `57044f9cef663a7b78f99399115e3ec8be5ce906f9f28c6a74d7372a2408f588`이다. provider-bridge SHA-256은 `3c40a91ae4340ef1b361ef1b998f3c5d808aae420f2e0952b0fc24998ca52f74`이며 도구 선택 옵션 추가 시 변경하지 않았다.

root의 공통 runner 결과는 상위 보고서에 통합한다. 이 문서의 자체 결과와 모델 품질·실서비스 결과를 구분한다.

도구 선택 옵션을 포함한 최종 동결 소스에서도 공통 scripted 회귀 **24/24 통과**를 재확인했다. 새 결과는 [pi-live-final-regression.json](../results/pi-live-final-regression.json)에 보존했으며 앞선 회귀·실제 모델 평가 산출물은 덮어쓰지 않았다.

## 제한

기억 persistence는 재시작을 견디지만 진행 중인 Agent/승인 대기는 메모리 상태이며 재시작 복구하지 않는다. EOF/interrupt는 대기 중인 변경을 거절하고 MCP를 종료한다. 이미 완료된 파일 효과는 취소로 rollback되지 않는다. MCP 전송 중 오류·취소는 효과가 불확실하므로 poisoned/requiresRestart로 차단한다. 실제 Brain 경로도 비스트리밍 text-only 입력/도구 결과로 제한한다. 모델의 의미 이해·성격 준수·사실 정확도는 이 adapter smoke로 평가하지 않았다. EldaCore/DBA의 실제 API, 사용자 인증, production DB, CLI provider 등록, 기존 웹 UI, 배포는 구현 범위 밖이다.

## H31 비교 프로필과 H40 배치 거절 — 2026-11-11

명시적 `--comparison-profile /프로젝트/내부/profile.json`은 페르소나 평가와 구분하는 비교 전용 모드다. JSON은 `{"system":"공통 지시문","workspace":"/프로젝트/내부/workspace","tokenLimit":20000}` 형식이며 `system`과 `workspace`가 필수다. `tokenLimit` 생략 시400000, 명시 시양의 정수여야 한다. baseline 정책에서만 허용한다. 기존 `--store`, `--principal`, `--conversation`, `--persona`와 모델/대본 인자는 계속 필요하다.

이 모드에서는 입력 system을 그대로 사용하며 MCP 안내·페르소나·검색 기억을 덧붙이지 않는다. 저장소와 persona는 CLI 식별용으로 유지하지만 모델 입력에 넣지 않고, persona의 금지 문구 교정도 실행하지 않는다. 도구 이름은 `artifact_*` 원형이며 모델에 돌려주는 MCP 결과는 text 조각을 빈 구분자로 연결한다. 기존 기본 모드의 `clova__artifact_*` 및 MCP envelope 직렬화는 유지한다. `--max-turns 6 --max-tokens 2048`로 공통 한도를 명시할 수 있다. 비교 프로필 경로와 작업장은 이 저장소 내부여야 한다.

한 턴의 **보고된 입력+출력 토큰**이 tokenLimit 이상이면 다음 모델 요청을 막는다. 다음 요청의 입력 비용을 미리 추정하거나 단일 응답의 초과를 취소하는 기능은 아니다. 모델 응답에 따라 한 번의 초과는 가능하므로 실제 usage와 runner 요청 상한도 함께 기록해야 한다. 비교 조건 일치와 전체 H42 적합 판정은 별개다.

H40 수정은 기본·비교 모드 모두에 적용된다. 첫 거절은 턴의 policyRejected를 보존한다. 그 뒤 beforeToolCall은 승인을 묻지 않고 차단하고 execute도 거절 상태를 검사한다. finishTurn은 모델 재호출을 끝내며 SDK가 남은 호출에 대해 만든 차단 결과는 원래 callId와 짝을 유지한다. 단순히 terminate:true만 추가하는 것으로는 SDK의 순차 배치가 중단되지 않으므로 두 경계를 둔다. tool_result.sideEffect는 실제 호출 전 not_started, MCP 응답 확인 시 completed, 요청 후 효과 불확실 시 unknown이다.

turn_end의 runCompleted/policyRejected/toolFailed를 구분하며 판정기 없는 taskSucceeded는 생략한다. costBasis는 unknown이다. 이 변경은 승인 대기 시간 분리·상태 heartbeat·H1–H56 전체 적합성 선언이 아니다.

검증: `node --test runtime/memory-lab/pi/smoke.test.mjs`. 첫 거절 뒤 나머지 승인·효과0, 첫 허용 뒤 둘째 거절, 둘 다 허용, 두 번째 native 요청의 tool 결과 텍스트, 정확한 system·raw 도구 이름, 기억·literal repair 제외, 토큰 상한 및 잘못된 프로필의 DB 생성 전 거절을 확인한다. mock/대본만 사용하며 실제 API 호출은 없다.
