# 후속 페르소나 비교 기술 감사

2026-11-10 13:12:45 UTC에 실행 중인 [followup 결과](results/followup-ab-2026-11-10.json), [runner](live.mjs), [실험 계획](followup-plan.json), worker 소스와 저장된 JSONL을 읽기 전용으로 대조했다. 감사자가 수행한 추가 API 호출은 0회이며, 이 문서 외의 소스·fixture·결과는 변경하지 않았다. 아래 실행값은 그 시점의 부분 결과이며 80회 완료 판정이 아니다.

| 확인 항목 | 설계와 관측 근거 |
| --- | --- |
| 변형별 격리 | 저장 경로는 `runRoot/framework/persona/variant/memory.sqlite`다. baseline과 explicit의 persona id, principal, conversation은 같아도 DB 파일이 다르다. 당시 생성된 Pi의 4개 DB 모두 inode가 달랐다. 재시작만 같은 group DB를 재사용한다. Agno를 포함한 전체 8개 경로는 같은 구성 규칙으로 분리된다. |
| 호출 상한 | 이번 결과의 `callLimit=80`, `plannedPrompts=80`이다. 2 framework × 2 persona × 2 variant × 10 scenario를 순차 실행하고 매 worker에 `--max-turns 1`을 전달한다. 두 worker 모두 provider 호출 직전에 횟수를 검사하며 Brain에는 자동 재시도가 없다. 다음 prompt 전 전역 예산 검사와 `model_context` 계수도 있다. |
| 같은 모델·질문 | 모델은 `clova:HCX-005`로 고정되고 공식 HTTPS origin을 사용한다. 모든 조합에 같은 scenario 배열과 같은 승인된 합성 기억을 전달한다. 관측한 기존 8개 질문은 이전 32회 결과의 질문과 문자 단위로 같으며, 새 2개 질문은 plan snapshot과 같다. 생성 설정은 temperature 0, maxTokens 2048, tools none이다. seed와 topP는 보내지 않는다. |
| 자동 교정 없음 | 네 persona JSON에 outputRules가 없고 runner는 모든 step에 correctionAttempts 0을 요구한다. 당시 31개 저장된 step 모두 교정 0회·도구 실행 0회·model request 1회다. |
| 출력 동일성 | 당시 31개 step 모두 remote·synthetic false·정상 stop인 provider 이벤트가 정확히 하나 있으며 content와 최종 response가 같다. 별도 JSONL의 provider content와 text 이벤트도 31개 모두 같았다. |
| worker 불변 | 이전 도구 없는 32회 실행의 source snapshot과 현재 Pi/Agno 진입점 및 관련 adapter 6개 파일의 SHA-256이 모두 같다. 현재 실행의 runner·worker·fixture·plan 12개 snapshot도 기록된 hash, 보관 파일, 현재 파일이 모두 일치했다. |

당시 완료 저장된 응답은 31개, modelRequests와 externalModelCalls는 각각 31이었다. Pi calm baseline/explicit와 playful baseline의 각 10개가 완료됐고 Pi playful explicit은 1개가 저장돼 있었다. 31개 step 모두 operationalSuccess였으며 이는 요청·응답 경로의 성공을 뜻하고 말투·기억 의미 정확성의 성공률이 아니다. 최종 전체 호출 수·usage·cleanup·8개 group의 완료 여부는 실행 종료 후 루트가 확인해야 한다.

호출 상한은 이번 설정과 검증된 worker 제어 흐름을 합친 보장이다. runner 일반 옵션 자체는 최대 96회를 허용하며 전역 `model_context` 감시는 이미 시작된 호출 이후 이벤트를 관측하는 방식이다. 독립된 네트워크 차단 장치나 공급자 청구 상한을 구현한 것으로 표현하면 안 된다. 현재 단일 요청 worker 제한과 순차 80개 prompt에서는 81번째 요청 경로가 없다.

provider 이벤트는 기존 Brain이 해석한 응답으로, 원시 HTTP 응답 전체를 별도로 서명하거나 저장한 증거는 아니다. SDK 출력의 추가 교정이 없고 실제 provider content와 최종 텍스트가 같다는 범위를 확인했다. 공급자 측 청구 기록·크레딧 소비량·서버 내부 model revision까지 검증한 것은 아니다.

이전 결과 두 파일은 각각 해당 실행의 `rawArtifacts/report.json` 보관본과 byte hash가 같다. 현 감사에서 확인한 SHA-256은 다음과 같다. 과거 외부 서명이나 별도 신뢰 저장소를 이용한 변조 불가능성 검증은 수행하지 않았다.

- `results/live-2026-11-10.json` — `187240f2ee5a88644d891e7149fb84b9eaef44232a1405a6fd4b2b62b69709b0` (23회 시도 기록).
- `results/live-no-tools-2026-11-10.json` — `52ddb3322034b7322596e98b58666565e02793fe90be763a903c7c8d6a7bf4e5` (32회 기록).

현재 핵심 코드 hash는 Pi `57044f9cef663a7b78f99399115e3ec8be5ce906f9f28c6a74d7372a2408f588`, Agno `01f85ba04f49cce9e26144153b70727de499363f518c579aceff0f17a3a300bf`, 공통 provider `51f0d07668450a873f665378739283fb3f5752dad298124ebfac4c12492397b4`다. provider hash는 이전 실행 기록과도 같다. 후속 runner hash는 `ebd61ffba6e1ee94676193f738e460b52886fe763551cf6c0174825a6bf67fd8`, plan hash는 `be021fdc84319cfd54382d627573d8a19505978d46bb6e75a70da76c3e2ce663`다.

fixture 작성 시 평가 질문·응답·holdout을 열람하지 않았고 동결 hash를 먼저 보고했다. 이 감사 단계에서는 허용된 read-only 검토를 위해 처음으로 runner와 plan의 질문을 열람했다. 그 뒤 fixture 변경은 없으며 두 explicit fixture hash는 [설계 문서](fixtures/persona-explicit-design.md)의 동결값과 같다. 정책 방향 자체는 앞선 실패 관찰과 루트의 요구에 영향을 받았으므로 새 질문 두 개를 강한 독립 벤치마크로 해석하지 않는다.

변형 순서는 고정이며 무작위화하지 않았다. 원본과 explicit의 지시 길이와 여러 정책이 함께 달라지고, framework별 문맥 포장과 history 초기화도 다르다. 따라서 이 실험은 동일 질문에서 관측한 해당 지시 묶음의 비교이며, 일반적인 framework 순위나 개별 문장의 인과 효과를 입증하지 않는다.


## 실행 종료 후 루트 검증

최종 근거: [followup-summary.json](results/followup-summary.json), [최종 실행](results/followup-ab-final-2026-11-10.json).

- 총 80회 요청 시도, 실제 텍스트 78개, HTTP 429 2개. 오류는 unscorable이며 사용량 미상이다.
- 첫 33회, 다음 17회, 마지막 30회를 합산했다. 실패 질문은 재호출하지 않았다.
- 마지막 30회는 요청 시작 사이 최소 10초를 두었다. 이 구간에서 추가 HTTP 오류는 없었다.
- 모든 정상 응답은 provider 텍스트와 최종 텍스트가 일치하며 요청 1회·자동 교정 0회·도구 호출 0회다.
- 두 중간 보고서의 모든 기존 step 객체가 최종 보고서에서 그대로 보존됐다.
- 마지막 실행의 source snapshot과 현재 파일 hash가 일치한다. worker/adapter 6개는 이전 실제 모델 평가와도 동일하다.
- Pi 재개 시 복사한 원 DB의 hash가 보존됐고, 기존 결과 파일을 덮어쓰지 않았다.
- worker/자식 프로세스 정리와 임시 키 사본 0개를 확인했다.
- 알려진 usage는 입력 114,500 / 출력 10,517토큰이다. 429 2개의 실제 사용량이나 요금은 확정하지 않았다.

전체 작업이 끝났다는 `executionCompleted:true`와 모든 API 요청 성공을 뜻하는 `operationalSuccess`는 구분한다. 후자는 두 429를 보존하여 false다. 이번 종료 코드 1도 그 실패 기록을 숨기지 않은 결과다.
