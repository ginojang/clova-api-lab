# H31 후속 사이클 — 복구 응답·원시 인자·공식 키트

Elda CLI ②가 사용할 CLOVA 하네스 비교를 이어갔다. 이번 순서는 Pi 오류 복구 뒤 최종 응답 수정 → 잘못된 도구 인자 비교·수정 → 공식 키트 실행 → 실제 CLOVA 복구 재검증이다. 모든 구현·결과·임시 작업장은 `clova-api-lab` 안에 두었고, 설치 Elda CLI와 Elda-Spec은 읽기만 했다. 운영 배포나 외부 Comms 전송은 하지 않았다.

## 확인한 개선

| 항목 | 이전 관측 | 이번 관측 |
| --- | --- | --- |
| Pi 복구 이후 최종 응답 | 파일은 복구했지만 `tool_error`로 답변 차단 | 실제 CLOVA에서 답변 출력, `ok/runCompleted:true`, `toolFailed:true` 보존 |
| 잘못된 인자로 파일 효과 차단 | 10/12 | 12/12 |
| 잘못된 인자를 승인 전에 차단 | 8/12 | 12/12 |
| 정상 객체·객체 문자열 저장 | 6/6 | 6/6 유지 |
| 공식 kit FAIL | Elda0 / Graph1 / Pi2 | 모두0 |
| 공식 kit WARN | Elda0 / Graph3 / Pi6 | Elda0 / Graph3 / Pi5 |

이는 제한된 과제의 관측이다. persona 말투·성격 품질이 추가로 향상됐다는 실험은 이번에 수행하지 않았다. 기존 정책 회귀156개를 다시 통과한 것과 실제 모델의 persona 품질 증거를 구분한다.

## 구현과 근거

Pi는 개별 도구 오류를 최종 종료 오류와 분리했다. 복구 가능한 `isError`는 `toolFailed:true`와 원문 결과로 남고, 뒤따르는 정상 최종 응답은 기존 persona·구조 검증을 거쳐 출력한다. API 실패, 빈 응답, 잘림, 거절, 취소, 시간·토큰·턴 상한은 계속 실패로 끝난다. 모델이 “완료”라고만 말하면 루프 완료일 수 있지만 작업 성공을 뜻하지 않는다. `taskSucceeded`를 만들어 넣지 않고 실제 파일·도구 결과로 별도 판정한다.

LangGraph에는 승인 전 JSON Schema 검사를 추가했고, Pi에는 SDK가 가공하기 전 원시 인자 검사를 추가했다. 설치된 `@earendil-works/pi-ai`1.5.1의 validation은 복제된 인자에 coercion을 적용하므로 숫자42가 문자열로 변환돼 쓰기까지 진행될 수 있었다. 이제 원시값을 확인하고 수정 가능한 오류로 돌려준다. 누락·추가 필드가 Pi SDK에서 먼저 거절되는 경우에는 SDK 오류 형식을 그대로 보존한다.

검사기는 Ajv8.20.0을 고정해 `coerceTypes/useDefaults/removeAdditional:false`로 사용한다. 타입 변환, 기본값 주입, 추가 필드 삭제 없이 검증하려는 선택이다. 공식 [Ajv 옵션](https://ajv.js.org/options.html)과 [JSON Schema 버전 문서](https://ajv.js.org/json-schema.html)를 확인했다. draft7과 명시적 draft2020-12는 별도 엔진으로 처리한다. 미지원 dialect/format/ref는 실행을 차단하며 원격 스키마를 가져오지 않는다. 임의 입력값·모르는 속성명은 오류 요약에 넣지 않는다.

독립 검토에서 동일 `$id`를 가진 다른 MCP 서버의 스키마가 전역 Ajv 등록 때문에 충돌하는 문제도 발견했다. `addUsedSchema:false`와 객체별 캐시를 사용해 격리했고, 동일 ID·다른 제약·내부 `$defs` 참조의 회귀검사를 추가했다. Graph는 네 번 연속 잘못된 인자가 나오면 나머지 배치 호출도 `not_started`로 기록하고 중단한다.

직접 MCP `artifact_*` 호출에도 같은 검사를 추가했다. **기존 MCP `batch` 내부의 `tool.run` 전체까지 감싸는 변경은 아니다.** 이번 프로필은 네 artifact 도구만 노출하고 batch는 비활성화한다. 모든 MCP 도구·모든 JSON Schema 구현의 완전 검증을 주장하지 않는다.

JSONL 입력 오류는 Graph/Pi에서 `bad_input`으로 맞췄다. Pi는 ready/start/end/idle에 sessionId를 넣고, `new`에서 세션과 대화 기록을 새로 시작하되 기억 namespace는 유지한다.

## 잘못된 인자 비교

[수정 전](MALFORMED-BASELINE-2026-11-11.md)과 [최종 분석](MALFORMED-FINAL-2026-11-11.md)에 원문·조건·해시가 있다. 필수 필드 누락, 추가 속성, 숫자 text, 깨진 JSON, 정상 객체, 정상 JSON 객체 문자열의6사례를 실행기3개에 적용했다.

첫18세션 → 수정 후18세션 → 스키마 ID 격리 수정 후18세션을 각각 보존했다. 매회 모의 요청34회, 합계102회이며 외부 API는0회다. 최종12개 잘못된 입력은 모두 승인0·파일 효과0, 정상6개는 정확한 SAFE 저장을 확인했다. 최초 요청 조건은 동일했다.

**남은 차이:** 깨진 JSON은 native Elda가 호출별 `invalid_json` 결과를 남기고 모델 수정을 이어가지만 Graph/Pi는 공통 제공자 단계에서 응답 전체를 오류로 끝낸다. 안전 차단12/12를 H41 전체 구현으로 읽으면 안 된다. 다음 작업은 호출 ID를 보존하는 개별 오류, 정상·잘못된 호출 혼합 응답, 일관된 반복 실패 한도다.

## 공식 키트

[실행 방법과 전체 판정](kit-README.md). Elda-Spec HEAD `89ee1ce50e05d513c1e1f419298806c98c7e61fd`의 원본 키트를 실행했다. SPEC 본문은0.808, **키트 자체는0.805**다. 최신 본문 전체 인증을 뜻하지 않는다.

최종 Elda FAIL0/WARN0, Graph FAIL0/WARN3, Pi FAIL0/WARN5, SKIP은 모두0이다. H56 거절·허용6경로와 실제 파일을 확인했고,15 workers가 정상 종료·정리됐다. 외부 모델 호출은0회다. 첫 실행·중간 수정·스키마 격리 후 최종 실행의 원문을 모두 보존했다. 마지막 실행에는 새 스키마와 package/lock 해시까지 기록했다. 앞선 두 키트 결과에는 이 세 해시가 빠져 있었다.

남은 경고는 Graph/Pi의 H47 waiting, H48 approval_result, H53 diag이며 Pi에는 추가 debug 이벤트와 approvalId 접두어 경고도 있다. wrapper가 이벤트를 고치거나 경고를 숨기지 않았다. 기본 단계의 승인은 테스트 operator가 답했으므로 기본 무인 운영 정책의 적합성을 증명하지 않는다.

## 실제 CLOVA 복구 재검증

[사전 계획](PLAN-RECOVERY-NEXT-2026-11-11.md), [실제 원문](../results/h31-recovery-next-live-2026-11-11.json), [독립 검토](REVIEW-RECOVERY-NEXT-2026-11-11.md).

HCX-005, temperature0, maxTokens2048, maxTurns6, tokenLimit20000, 동일 system·사용자 요청·네 artifact 도구를 사용했다. 각 실행기 새 작업장에서 없는 recovered.txt 읽기 → RECOVERED 쓰기 → 다시 읽기를 수행했다. 요청마다 테스트 operator가 승인했다.

| 실행기 | 실제 API | 대응 승인 | 복구 파일 | 마지막 도구 뒤 최종 답변 | ok / runCompleted / toolFailed |
| --- | ---: | ---: | --- | --- | --- |
| Elda native | 4 | 3 | RECOVERED | 있음 | true / true / true |
| LangGraph | 4 | 3 | RECOVERED | 있음 | true / true / true |
| Pi | 4 | 3 | RECOVERED | 있음 | true / true / true |

실제12회, 알려진 입력1,830·출력360토큰, 입력·출력 사용량 누락0회, API 오류0회다. 세 실행기의 최초 wire가 같았고 프로세스 정리·작업장의 실제 파일도 확인했다. 금액 비용과 남은 크레딧은 조회하지 않아 unknown이다. 이전 H31의79회와 별도이며 H31 실제 호출 누계는91회다. 다른 persona/provider 실험 호출은 이 숫자에 포함하지 않는다.

**엄격한 전체 프로토콜은 통과하지 못했다.** 실제 전달 간격 두 곳이5,999ms로 계획의6,000ms에1ms 못 미쳤다. 또한 측정 당시 판정기는 live parity를 종료 코드에 반영하지 않았고, 최종 text 위치와 호출별 승인을 충분히 검사하지 않았다. 원시 `boundaryPass:true`는 그대로 보존하되 이를 전체 조건 통과라고 보고하지 않는다.

독립 검토와 [강화 판정의 별도 감사](../results/h31-recovery-next-live-final-audit-2026-11-11.json)는 실제 실행의 승인·인자·파일·도구 이후 답변·wire 일치를 확인했다. `executionPass:true`, `parityPass:true`, **`pacingPass:false`, `protocolPass:false`**다. 허용 오차를 사후 추가하지 않았다.

측정 후 러너/판정기를 보완했다. 승인 ID·call ID·입력·순서와 최종 출력 위치, live parity, 예산·간격을 모두 필수 조건으로 삼는다. 타이머가 일찍 깨어나면 시계를 다시 확인해 기다리며, 대기 후 닫힌 연결은 외부로 전달하지 않는다. ready/idle은 하나의 절대120초 deadline을 공유한다. 보강된 판정기는 실패 반례를 포함한3개 검사와 새 모의 preflight3/3을 통과했다. **이 보강 뒤 유료 API를 다시 호출하지 않았다.** 실제 측정 러너·판정기는 ZIP에 고정했고 CLOVA 실행기 자체의 소스는 실제 측정과 최종 모의 검증 사이에 바꾸지 않았다.

## 검증·재현·다음 순서

- CLOVA 런타임과 초기 복구 판정 회귀93/93, Pi smoke26/26, persona 정책 회귀156/156.
- 강화 복구 판정·간격 회귀3/3 및 최종 모의 복구3/3. 과거 판정기 검사를 현재 버전의 실제 측정으로 재표시하지 않는다.
- TypeScript 검사와 런타임 번들 빌드 성공. 번들된 MCP도 숫자 text를 파일 생성 전에 거절했다.
- 최초·수정·최종 결과와 측정 소스 아카이브를 보존했다. [증거 목록](../results/h31-next-evidence-ledger-2026-11-11.json)에 파일 해시·호출 수·최종 소스 차이를 기록했다.

[README](README.md)의 명령은 보강된 러너를 실행한다. 반드시 새 preflight와 새 output 파일을 사용한다. 다음 순서는 H41 깨진 JSON의 호출별 복구 → H47/H48 이벤트 계약 → H53 진단 필드 정렬이다. 이번 결과만으로 운영 승격이나 persona 품질 향상을 선언하지 않는다.
