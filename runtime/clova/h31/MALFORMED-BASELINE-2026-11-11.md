# 잘못된 도구 인자 — 수정 전 세 실행기 비교

실제 네 개 artifact MCP와 세 실행기를 사용하되, 모델은 loopback 모의 native CLOVA 공급자로 고정했다. **외부 모델 호출0회**, 모의 공급자 요청34회,6사례×3실행기18세션이다. [원시 기준 결과](../results/h31-malformed-baseline-2026-11-11.json)를 수정 전 기록으로 보존한다. 이 결과를 후속 패치의 성공 결과로 덮어쓰지 않는다.

고정 응답은 첫 요청에 `artifact_write` 하나를 반환하고, 다음 모델 요청에는 진단 종료 문장을 반환한다. 후속 응답은 잘못된 인자를 고쳐 쓰지 않는다. 따라서 파일이 생기면 해당 실행기가 처음의 인자를 그대로 또는 변환해서 실행한 것이다. 모든 승인 요청에 테스트 드라이버가 true로 답하며, 검증이 승인 전에 일어나는지도 별도로 센다. 사용자 입력 과제는 모든 사례에서 `artifact.txt=SAFE` 쓰기로 동일하다.

| 모델 인자 | Elda native | LangGraph | Pi |
| --- | --- | --- | --- |
| 필수 text 누락 | 승인0·효과0, 수정 가능한 tool_result | **승인1** 뒤 MCP 거절·효과0 | 승인0·효과0, SDK 검증 오류 |
| 추가 속성 unexpected:true | 승인0·효과0 | **승인1·SAFE 파일 생성** | 승인0·효과0 |
| text 숫자42 | 승인0·효과0 | **승인1** 뒤 MCP 거절·효과0 | **숫자를 문자열로 바꿔 승인1·42 파일 생성** |
| 깨진 JSON 문자열 `{"path":` | 승인0·효과0, invalid_json tool_result 뒤 다음 모델 요청 | 승인0·효과0, 제공자 단계에서 턴 전체 api_error | 승인0·효과0, 제공자 단계에서 턴 전체 api_error |
| 정상 객체 | 승인1·SAFE 파일 생성 | 승인1·SAFE 파일 생성 | 승인1·SAFE 파일 생성 |
| 정상 객체의 JSON 문자열 | 승인1·SAFE 파일 생성 | 승인1·SAFE 파일 생성 | 승인1·SAFE 파일 생성 |

잘못된 인자12사례 중 효과 없는 경우10/12, 승인 전에 막힌 경우8/12다. 정상 대조군6/6은 파일 내용까지 맞았다. 이는 전체 적합성 통과율이 아니라 이번 입력 집합의 관측이다. `executionValid:true`는 프로세스·JSONL·소스 안정성이 정상이라는 뜻이며 인자 정책을 통과했다는 뜻이 아니다. 원시 보고서의 `strictInvalidNoWrite:false`와 `strictInvalidBeforeApproval:false`가 결함을 그대로 남긴다.

## 수정 지점

1. LangGraph는 MCP 호출 전에 실제 tools/list 스키마로 required·additionalProperties·원시 자료형을 검증해야 한다. 검증 실패에 승인 질문을 띄우거나 실제 MCP 함수를 호출해서는 안 된다. 개별 호출의 `tool_result`에 수정 가능한 오류와 `sideEffect:not_started`를 기록해야 한다.
2. 공통 artifact MCP도 스키마 경계를 확인해야 한다. 하네스를 우회한 직접 tools/call에서 추가 속성이 허용되지 않도록 한다. 도구 함수의 일부 인자 검사만으로 전체 스키마가 적용됐다고 볼 수 없다.
3. Pi SDK가 승인 훅에 넘기는 인자는 이미 coercion됐을 수 있다. 실제 관측에서 tool_call에는 숫자42, approval.input에는 문자열42가 있었다. 승인 훅의 정규화된 args만 검사하면 원시 자료형 오류를 놓치므로 모델의 원래 toolCall.arguments도 검증해야 한다. 기존 null→객체 및 JSON 객체 문자열 해석과 숫자→문자 자동 변환은 구분해야 한다.

## 깨진 JSON은 별도 계약 차이

Elda는 깨진 인자를 해당 call ID의 실패 결과로 돌려준다. category=invalid_json, retryable=true, sideEffect=not_started이며 이후 모델 응답을 받을 수 있다. 여기서 retryable은 모델이 인자를 고칠 수 있다는 정보로 읽으며 같은 HTTP 요청의 자동 재시도와 구별한다.

현재 공통 Brain은 normalizeToolCalls에서 깨진 JSON을 발견하면 응답 전체를 `Fault(api_error)`로 거절한다. Graph/Pi는 해당 호출의 tool_call/tool_result를 만들지 않고1회의 모델 요청 후 턴을 종료한다. 사용량100/20은 보존되고 파일 효과는0이다. 따라서 실행 안전 경계는 지키지만, H41의 호출별 수정 가능한 결과와는 다르다. 이번 단일 호출 시험은 잘못된 호출 옆에 정상 호출이 있는 혼합 응답의 처리까지 검증하지 않는다.

후속으로 이를 고칠 경우에는 잘못된 JSON을 임의 빈 객체로 바꿔 실행해서는 안 된다. 원래 call ID와 인자 오류를 보존하고 실행 전 실패 결과를 만든 뒤, 모델이 실제로 새 올바른 인자를 보냈을 때만 승인·실행하는 경로를 별도로 시험해야 한다.

## 증거 경계

각 worker 실행 전후의 랩·설치 CLI 소스 해시를 기록했고18/18에서 일치했다. 이번18세션은 같은 소스 묶음을 사용했다. 모든 프로세스 그룹은 exit0으로 정리됐고 실제 작업장 파일 목록과 바이트를 기록했다. 가짜 인증 파일은 프로젝트 `.local`에 만들고 종료 시 제거했다. 실제 키·환경 파일·CLAUDE.md는 읽지 않았고 외부 저장소를 수정하지 않았다.

Pi의 이 기준 실행은 병렬 작업 중 먼저 완료된 복구 종료 처리 변경을 포함한다. 정확한 버전은 원시 보고서의 sourcesBefore/After를 기준으로 하며 과거 H31 실모델 실행 코드와 같다고 간주하지 않는다. 다음 패치 뒤 동일 명령을 **새 출력 파일**로 실행하면 수정 전·후 차이를 보존할 수 있다.

```bash
node runtime/clova/h31/malformed.mjs --output runtime/clova/results/h31-malformed-new-run.json
```

이 명령에는 live 옵션이나 외부 HTTP 전달 구현이 없다. 모든 모델 요청은 테스트의 loopback 서버로만 가며 provider의 실제 요청 직렬화·오류 처리는 사용한다. `synthetic:false`라는 개별 worker 필드가 있더라도 실제 API 크레딧을 사용했다는 뜻이 아니다. report.externalModelCalls=0과 loopback 경로로 구분한다.
