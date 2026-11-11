# 잘못된 도구 인자 — 수정 후 재검증

Graph·공통 artifact MCP의 엄격 스키마 검사와 Pi의 SDK coercion 전 원시 인자 검사를 반영한 뒤, [수정 전 기준](MALFORMED-BASELINE-2026-11-11.md)과 동일한6사례를 세 실행기에 다시 적용했다. 이어 서로 다른 도구의 같은 `$id`가 충돌하지 않도록 Ajv `addUsedSchema:false`를 적용한 최종 코드로 같은18사례를 재검증했다. 각 실행은 **외부 모델 호출0회**, loopback 모의 공급자34요청,18세션이다. [중간 수정 후 원문](../results/h31-malformed-final-2026-11-11.json)과 [최종 스키마 보정 후 원문](../results/h31-malformed-schema-final-2026-11-11.json)을 각각 새 파일로 보존했다. 아래 수정 후 수치는 최종 코드에서도 동일하게 확인됐다.

| 관측 축 | 수정 전 | 수정 후 |
| --- | ---: | ---: |
| 잘못된 인자로 파일을 쓰지 않음 | 10/12 | **12/12** |
| 잘못된 인자를 승인 질문 전에 차단 | 8/12 | **12/12** |
| 정상 객체·JSON 객체 문자열의 정확한 SAFE 저장 | 6/6 | **6/6** |
| worker/source 안정성·정상 종료 | 18/18 | **18/18** |
| 실제 외부 모델 요청 | 0 | 0 |

필수 필드 누락·추가 속성·숫자 text의 세 사례는 이제 모든 실행기가 승인0·파일 효과0이다. Graph의 추가 속성 요청으로 SAFE 파일이 생성되던 문제와 Pi가 숫자42를 문자열로 바꾸어 저장하던 문제는 동일 fixture에서 재현되지 않았다. 숫자 사례의 Graph/Pi 결과에는 `category:wrong_type`, `badField:text`, `retryable:true`, `sideEffect:not_started`가 기록됐다. 도구 오류와 모델 요청의 재시도는 별개다.

정상 객체 및 정상 JSON 객체 문자열은 세 실행기 모두 승인1회 후 `artifact.txt=SAFE`를 저장했다. 인자 검사를 강화하면서 정상 도구 경로가 막히지 않았는지 확인한 대조군이다. 필수 작업을 모델의 완료 문장으로 판정하지 않고 실제 파일 내용·도구 결과를 확인했다.

## 여전히 남은 깨진 JSON 처리 차이

깨진 JSON 문자열은 세 실행기 모두 승인·파일 효과가 없지만, 복구 경로는 같지 않다.

- Elda native: `invalid_json`이라는 호출별 tool_result를 내고 다음 모델 요청을 받는다. 총2모의 요청이며 정상 stop으로 루프가 끝난다.
- Graph: 공통 Brain에서 응답 전체를 거절해 `error/api_error`로 끝난다. 총1요청이며 해당 call ID의 tool_result가 없다.
- Pi: 같은 제공자 거절 때문에 `api_error`로 끝난다. 총1요청이며 해당 call ID의 tool_result가 없다.

따라서 **12/12 안전 차단은 H41의 수정 가능한 호출별 오류 계약까지 모두 구현됐다는 뜻이 아니다.** malformed JSON의 개별 호출 오류 보존·모델 수정 유도, 정상 호출과 잘못된 호출이 섞인 응답, 반복 실패 한도는 후속 범위다. 잘못된 구조를 임의 빈 객체로 바꿔 실행하지 않는 경계를 유지해야 한다.

## 동일 조건·무결성 검증

수정 전·후의 cases/settings와18개 최초 native 요청 body가 모두 동일했다. 최신 runner에는 새 `tool-schema.ts`와 package.json/package-lock.json 해시를 추가했다. 이는 의존성 식별을 보강한 변경이며 fixture·모델 응답·판정 조건은 바꾸지 않았다.

수정 후18세션의 소스 묶음은 같고 각 worker 실행 전후 해시도 일치했다. 검토 시 랩15개·설치 CLI6개, 합계21개 해시를 다시 확인했다. Pi CLI는 부모가 고정한 `dc7877d7454e08318185e69852df1ea06ce4f7fffb6f2226ac1dd891a5cbb5f5`다. 외부 CLI는 읽기만 했다.

중간 수정 후 실행과 최종 재검증 사이 이 기록의 소스 목록에서 바뀐 파일은 `tool-schema.ts` 하나다. 최종 SHA는 `caa527522650861f89d9d731174cb7e6f0fa89c361bb59e3019e21ff1677c81b`다. 동일 `$id` 충돌 자체는 부모가 추가한 별도 격리 회귀의 검증 대상이며, 이18사례는 그 보정이 기존 인자 경계를 퇴행시키지 않았는지 확인한다. 이 fixture에 `$id` 충돌 사례가 포함됐다고 주장하지 않는다.

18작업장의 실제 최종 파일을 다시 읽어 원시 보고서와 일치함을 확인했다. 모든 worker는 exit0·processGroupClean:true이고 강제 종료가 없었다. 테스트용 synthetic.key는 종료 후 제거됐다. 인증 헤더·실제 키를 보고서에 기록하지 않았다.

원시 결과 SHA-256:

- 수정 전: `a1dddac9330b87fb3d7ee88487b7d27873989604bd7c9432cc580fc20769b078`
- 중간 수정 후: `da3242094bada3ba32291f5e773283f1e1e7aceb0798ca4c7994ba03b9d8e31c`
- 최종 스키마 보정 후: `95c586918ebd1ba50d93eb7eef56cb01ae304c1f37d9bd6190f6724103fc2185`

세 실행 합계는 모의 공급자102요청이며, 실제 HCX 품질·usage·요금의 측정이 아니다. 원시 `executionValid`는 프로세스/기록/소스 안정성 축이고, 인자 정책 성공은 별도 `strictInvalidNoWrite`, `strictInvalidBeforeApproval`, `controlWritesValid`로 읽는다. 이번 결과를 공식 적합성 키트 전체 통과로 승격하지 않는다.
