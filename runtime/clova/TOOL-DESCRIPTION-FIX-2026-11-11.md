# CLOVA native 도구 설명 누락 보정 — 2026-11-11

## 결과와 원인

`provider.ts`의 native 전송에서 비어 있거나 누락된 도구 설명을 도구 이름으로 보완했다. 유효한 설명은 앞뒤 공백·개행까지 그대로 보존하고, 입력 도구 객체와 스키마는 수정하지 않는다. 도구가 없는 요청의 wire 형식도 동일하다.

계기는 코딩고래의 Comms `8bb0c80e39`다. 새 Elda CLI의 실제 HCX-005 요청이 빈 description 때문에 HTTP 400 / NAVER 40001로 거절됐고, 설명을 이름으로 채운 뒤 성공했다고 보고했다. 이 랩도 `description: t.description`을 그대로 보내므로 같은 입력을 만들 수 있었다. HTTP 호환 경로는 생략된 설명을 빈 문자열로 바꾸므로 실제로 도달 가능한 경로다.

[NAVER Function calling 공식 문서](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-fc)는 `function.description`을 필수 문자열로 명시한다. 공식 표에 최소 길이가 명시됐다고 주장하지 않는다. 빈 값의 400 거절은 위 실제 연동 보고의 관찰이며, 이 세션에서 같은 오류를 과금 호출로 다시 재현하지 않았다.

## 적용 범위

- native `Brain.call`의 도구 직렬화 경계 한 곳을 수정했다. HTTP/Anthropic 호환 클라이언트와 MCP 경로가 같은 Brain을 사용하면 이 보정을 받는다.
- 설명이 문자열이고 `trim()` 결과가 비어 있지 않으면 원문을 전송한다. 그 밖의 누락·빈 값·공백·런타임 null은 `tool.name`을 사용한다.
- 이름과 inputSchema, 도구 없는 요청, 005/007의 토큰·thinking 필드는 바꾸지 않았다.
- 도구 이름은 최소 전송 설명이다. 사용 의도·입력 의미를 자세히 설명하는 도구 문서를 대체하거나 모델의 도구 선택 정확성을 보장하지 않는다.
- Brain의 자동 재시도 0회와 기존 오류 본문 미반출 계약은 유지된다. 코딩고래의 새 Python 제공자에 추가됐다는 `status.message` 160자 표시는 이 랩의 변경 사항이 아니다.

## 검증

| 검증 | 결과 | 근거 |
| --- | --- | --- |
| 수정 전 전용 회귀 | 3개 중 2실패·1통과 | [실패 원문](../memory-lab/results/tool-description-red-2026-11-11.txt) |
| 수정 후 전용 회귀 | **3/3 통과** | [성공 로그](../memory-lab/results/tool-description-unit-2026-11-11.txt) |
| native 모델·생성 설정·HTTP·Anthropic 기존 회귀 | **34/34 통과** | [회귀 로그](../memory-lab/results/tool-description-provider-regression-2026-11-11.txt) |
| TypeScript | 통과, noEmit | [검사 로그](../memory-lab/results/tool-description-typecheck-2026-11-11.txt) |

[전용 테스트](test/tool-description.test.ts)는 005와 007 모두에서 빈 문자열·공백·누락·null을 확인한다. 정상 설명과 frozen 입력 객체·스키마가 보존되는지, 도구 없는 request body가 기존과 같은지, 설명을 생략한 실제 loopback HTTP Wrapper 요청이 native 경계에서 보완되는지도 검사한다. native fetch는 전부 모의 응답이며 외부 API를 호출하지 않는다. synthetic 인증 파일은 프로젝트 `.local`에서 만들고 종료 시 삭제한다.

재실행:

```bash
node --test runtime/clova/test/tool-description.test.ts
node --test runtime/clova/test/native-models.test.ts runtime/clova/test/clova-model-config.test.ts runtime/clova/test/http.test.ts runtime/clova/test/anthropic.test.ts
npm run check:clova-runtime
```

## 실제 연결 보고의 정확한 범위

코딩고래는 Elda-CLI **a6d2031**에서 mars `elda job _ai` → HCX-005 → 시험 도구 `add {"n":2}` → `added 2` → 최종 답변과 runner 결과 파일, exit 0을 확인했다고 보고했다. 두 번의 모델 턴, 도구 호출 1회, 입력 125·출력 68토큰, 4.5초라는 수치는 타 팀 보고이며 이 랩에서 재실행한 수치가 아니다.

같은 보고에는 모델이 도구 결과 밖의 계산을 만들어 냈다는 한계도 있다. 연결 성공은 의미적 과제 성공이 아니다. mini-api 등록 Task → `elda job run <id>` → 실제 보고 전체 경로는 여전히 후속 검증 대상이다. 이 수정은 독립 Pi 페르소나 정책의 운영 배포나 H31 승격이 아니다.

이 패치에서 실제 API 추가 호출은 **0회**다. 기존 비교·개발 probe 216회 원장과 당시 소스 snapshot, 과거 점수는 변경하지 않았다. 소스와 문서는 이 프로젝트 안에서만 수정했다. 기존 mars 인계 사본에 이번 보정이 자동 반영됐다고 간주하지 않는다.

## 소스 식별

| 대상 | SHA-256 |
| --- | --- |
| 수정 전 `provider.ts` | `26fb934b0c91a65c379c72dfe3a212ad0c367358ad92102568c36d124b4bc224` |
| 수정 후 `provider.ts` | `e32d06471d11d30f43192d23e136300f50db01eae115d646534e2d262b500649` |
| `test/tool-description.test.ts` | `e635927cc7ac0e5acb12d6c8f1ed209691d260852c95c652962757352c4ac709` |

Git 커밋 ID가 아닌 로컬 파일 해시다. 구현은 현재 미커밋 상태다.
