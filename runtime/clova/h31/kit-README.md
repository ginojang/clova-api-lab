# 공식 harness kit 실행 — 격리된 모의 공급자

`kit-run.mjs`는 Elda-Spec의 `harness/kit/check.ts` 원본을 직접 실행한다. 규격 저장소를 수정·fetch·checkout하지 않는다. 키트의 `TMPDIR`, 결과 JSON, 작업장·모의 인증 파일·worker 기록은 모두 이 저장소 안에 둔다. 실제 CLOVA·Comms·Notion·운영 장비는 호출하지 않는다.

현재 코드에 대한 최신 근거는 [스키마 수정 후 결과](../results/h31-kit-schema-final-2026-11-11.json)다. 아래 첫 실행과 이전 최종 실행은 변경 이력으로 보존했다.

```bash
node runtime/clova/h31/kit-run.mjs --output runtime/clova/results/h31-kit-new.json
```

출력 파일은 새 경로여야 한다. 설치 Elda CLI 경로는 `/home/gino/apps/elda-cli`, 공식 키트는 `/home/gino/WorkArea/Elda-Spec/harness/kit/check.ts`다. 부모 결과에는 kit SHA·규격 저장소 커밋·실제 config·공식 판정 전체·키트 stdout/stderr·각 worker 원시 stdin/stdout/stderr·mock 요청·파일 내용·소스 해시·프로세스 정리 여부를 보존한다. `kit-run.mjs`는 하나라도 공식 키트가 실패하면 exit1을 반환한다. 실패를 skip이나 성공으로 바꾸지 않는다.

`kit-driver.mjs`는 localhost의 모의 native CLOVA endpoint와 실제 각 CLI 사이의 JSONL 전달자다. stdout 이벤트를 생성·삭제·이름 변경하지 않는다. 모델 fixture는 각 사용자 prompt마다 artifact_write→stop을 반환하며, H56에서는 한 응답에 write 두 개를 반환한다. 과거 `scripted:` 소스 형식이 실행기마다 달라서 동일 모의 native transport를 사용했다. 실제 요청은 loopback 안에서만 처리하며 외부로 전달하는 fetch 코드는 없다.

정상 턴·왕복 상한 phase에서는 driver가 테스트 operator로서 승인 질문에 true를 답한다. 실제 approval 이벤트는 그대로 키트에 전달한다. 이 방법은 기본 무인 승인 정책의 적합성을 증명하지 않는다. `approvalArgs:["--approve","ask"]` phase에서는 자동 답변이 전혀 없고 공식 키트만 잘못된 boolean/ID, 거절, 중단, 두 호출 허용을 전달한다. 세 실행기에 같은 테스트 operator 방식을 적용한다.

native 경로는 `kit-native.py`가 설치된 진짜 `LoopAdapter`와 `events.run`에 명시적 프로필만 전달한다. 별도의 실행 루프나 이벤트 변환은 없다. Graph와 Pi는 H31 비교 프로필을 사용한다. Pi debug 이벤트나 누락 필드를 wrapper가 보완하지 않으므로 공식 판정에 그대로 드러난다.

## 첫 실행 결과

2026-11-11, **kit version0.805**, 규격 저장소 HEAD `89ee1ce50e05d513c1e1f419298806c98c7e61fd`. 해당 커밋의 SPEC 본문은 **v0.808**이지만 `check.ts` 자체는 `KIT_SPEC="0.805"`다. config의 spec0.805는 이 키트 대상이며 최신 본문 전체 적합성을 뜻하지 않는다. 키트 SHA-256은 `824ff38a70c85c0b17d4d4e96d8bc00fef92940d7083f28dbb5ec49b79297ef1`이다. [첫 원문](../results/h31-kit-first-2026-11-11.json).

| 실행기 | FAIL | WARN | SKIP | H56 거절/허용 |
| --- | ---: | ---: | ---: | --- |
| Elda native loop | 0 | 0 | 0 | 둘 다 PASS |
| LangGraph | 1 | 3 | 0 | 둘 다 PASS |
| Pi | 2 | 6 | 0 | 둘 다 PASS |

Graph·Pi는 문자열 `allow:"false"`를 실행하지 않고 error로 거절했다. 그러나 error code가 `invalid_input`이어서 키트가 요구하는 `bad_input`과 다르다. 키트의 메시지 “받아들였다(error)”를 실제 승인 허용으로 해석하면 안 된다. 원시 이벤트는 거절과 대기 유지를 보인다. Pi는 `turn_end.sessionId`가 없어 H5도 실패했다.

남은 WARN: Graph·Pi의 `state{waiting}`, `approval_result`, `turn_end.diag`; Pi의 new/sessionId, UUID approvalId에 ap 접두어가 없는 점, 추가 `model_context/model_response` 이벤트다. 추가 이벤트 WARN은 곧 실행 실패를 뜻하지 않는다. 출력의 차이를 숨기지 않았다.

총15 worker는 정상 exit0·프로세스 그룹 정리로 끝났다. 각 실행기의 다섯 worker에서 기록한 소스 해시는 동일했다. H56 거절 작업장3개는 모두 빈 파일 목록, 허용 작업장3개는 `kit-a.txt=ALPHA`·`kit-b.txt=BETA`였다. 승인 대기 중 중단 작업장도 비어 있었다. 공식 키트는 주로 이벤트를 검사하므로 이 별도 파일 확인과 구분한다.

이 결과는 키트가 실제 수행한 항목의 결과다. 키트가 H1–H56 모든 조항을 구현한 전수 인증이라는 뜻이 아니며, 실제 모델·유료 API 품질·운영 배포 성공을 증명하지 않는다. H56 설정을 명시했고 이번 실행에서 해당 검사를 skip하지 않았다. 후속 수정·재실행은 새 결과 파일에 보존한다.

## 런타임 수정 후 최종 재실행

부모 작업에서 Graph/Pi의 `bad_input`, Pi의 sessionId/new 계약을 보완한 후 동일한 무변경 키트·driver·loader로 재실행했다. [최종 원문](../results/h31-kit-final-2026-11-11.json). 첫 결과를 수정하거나 대체하지 않았다.

| 실행기 | FAIL | WARN | SKIP | 공식 kit `conforms` | H56 거절/허용 |
| --- | ---: | ---: | ---: | --- | --- |
| Elda native loop | 0 | 0 | 0 | true | 둘 다 PASS |
| LangGraph | 0 | 3 | 0 | true | 둘 다 PASS |
| Pi | 0 | 5 | 0 | true | 둘 다 PASS |

최종15 worker 모두 exit0·프로세스 그룹 정리 통과이며, 각 실행기의 다섯 worker에 기록한 소스 해시는 동일했다. H56 거절 작업장은 모두 파일0개, 허용 작업장은 정확한 두 파일을 남겼다. 실제 모델·외부 API 호출0회다. 키트 파일 SHA와 SPEC 저장소 커밋은 첫 실행과 동일하다.

남은 경고는 Graph/Pi의 H47 `state{waiting}`, H48 `approval_result`, H53 `diag`; Pi의 H4 추가 debug 이벤트와 H38 approvalId 접두어다. H47/H48은 실제 필요한 운영 계약이므로 키트가 WARN으로 표시한다는 이유로 전체 규격 적합성을 주장하지 않는다. 승인 ID는 실행기가 UUID로 발급하며 이 경고가 모델 callId를 승인 ID로 쓴다는 뜻도 아니다.

최종 결과 SHA-256: `96c4cc7765848689444d709024a56c0fedbf87f38da0e2f36de895dc9dce1fae`.

## 스키마 격리 수정 후 현재 결과

전역 Ajv에서 도구 스키마의 동일 `$id`가 충돌하지 않도록 `addUsedSchema:false`를 적용한 코드로 세 하네스를 다시 실행했다. [현재 결과 원문](../results/h31-kit-schema-final-2026-11-11.json). 공식 키트와 native loader는 그대로이며, driver는 기록할 소스 해시 목록에 `tool-schema.ts`, `package.json`, `package-lock.json`을 추가했다. 이벤트 전달과 모의 공급자 동작은 바꾸지 않았다. 동일 `$id` 자체를 이 키트가 검사하는 것은 아니며, 해당 회귀 검사는 별도 스키마 테스트에서 다룬다.

| 실행기 | FAIL | WARN | SKIP | 공식 kit `conforms` | H56 거절/허용 |
| --- | ---: | ---: | ---: | --- | --- |
| Elda native loop | 0 | 0 | 0 | true | 둘 다 PASS |
| LangGraph | 0 | 3 | 0 | true | 둘 다 PASS |
| Pi | 0 | 5 | 0 | true | 둘 다 PASS |

15개 worker 모두 exit0·프로세스 그룹 정리 통과, 공식 키트 stderr는 모두 비어 있다. H56 거절 작업장 세 개와 승인 대기 중 중단 작업장 세 개는 파일이 없고, 허용 작업장 세 개는 `kit-a.txt=ALPHA`·`kit-b.txt=BETA`를 남겼다. 실제 모델·외부 API 호출은 0회다. 남은 경고는 앞선 최종 결과와 동일하다. `conforms:true`는 kit v0.805의 실행 결과이며, SPEC v0.808 전체 적합성을 뜻하지 않는다. 키트 SHA와 규격 저장소 커밋도 앞선 두 실행과 같다.

첫 결과와 이전 최종 결과는 이 세 파일의 해시를 기록하지 않았다. 따라서 당시 결과만으로 스키마 소스와 의존성 manifest/lock 상태를 고정했다고 주장할 수 없다. 이번 결과의 15개 worker는 다음 해시를 모두 기록하며 실행 후 현재 파일과 일치했다. 각 하네스의 다섯 worker가 기록한 나머지 소스 해시도 서로 같았다. 이 기록은 manifest/lock 파일을 고정하며 설치된 전체 `node_modules`의 바이트 검증은 아니다.

| 파일 | SHA-256 |
| --- | --- |
| `runtime/clova/tool-schema.ts` | `caa527522650861f89d9d731174cb7e6f0fa89c361bb59e3019e21ff1677c81b` |
| `package.json` | `522742251ff739e7194841a3f57bd514a60d42a328f51f794aa991e2ba98983e` |
| `package-lock.json` | `ecfd94489bf65f3be9bccbf382ad7740f6075502403f016b8b9829babf88e9d5` |
| `runtime/clova/h31/kit-driver.mjs` | `53fe15ccd2dabc827fbb448264ca106c3d23491cb76f1d0211f45406c61e2833` |

현재 결과 SHA-256: `c7db5f74f3a7273bf997c12ee6ecbe4fdfce0f784a17dcab167c4a0794a6cb8d`. 이전 두 결과를 다시 기록하지 않았으며, 파일 해시도 재실행 전후 동일했다.
