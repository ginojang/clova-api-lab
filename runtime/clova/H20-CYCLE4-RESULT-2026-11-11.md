# Cycle 4 결과 — CLOVA 본문 오류 전달 수정

H20+의 확인된 결함을 수정했다. HTTP 200의 NAVER 실패 본문을 무조건 502로 바꾸던 경로가 이제 원래 코드와 분류를 보존한다. OpenAI·Anthropic 호환 응답 모두 `providerCode`, `apiError`, `retryable`을 제공한다. 자동 재시도는 provider에 추가하지 않았다.

## 근거와 설계

- [NAVER 공식 4xx 표](https://api.ncloud-docs.com/docs/en/clovastudio-troubleshoot-c4xx)는 40001을 요청 인자 오류, 40104를 키 오류, 40080을 모델 없음으로 구분한다. [공식 5xx 표](https://api.ncloud-docs.com/docs/en/clovastudio-troubleshoot-c5xx)는 50000·50100·50400을 별도로 설명한다.
- Elda-Spec `f9e3f2b` v0.805 H20/H20+를 읽기 전용으로 대조했다. 다섯 자리 native completion 코드는 앞 세 자리 상태로 전달한다. 재시도 가능 상태는 규격의 429/500/502/503/529로 제한한다. 501·504는 상태를 보존하되 이 규격의 자동 재시도 허용 목록에 넣지 않았다. NAVER 전체 제품의 다른 오류 코드 체계에 일반화하지 않는다.
- 알 수 없는 형식·범위의 본문 코드는 422/unknown/retryable:false로 처리한다. 422는 공급자 HTTP 상태라는 주장이 아니라 이 Wrapper의 비일시 실패 표현이다. 숫자 다섯 자리만 providerCode로 노출한다. 공급자의 자유 형식 message는 저장·전달하지 않아 키나 요청 내용 누출을 막는다.
- 402는 일반 결제 오류 분류의 모의 경계 사례다. NAVER 공식 표에 특정 40200 코드가 등록돼 있다는 주장이 아니다.
- 공급자 503을 Wrapper 설정 오류로 잘못 표시하던 문구도 수정했다. 실제 configuration Fault에만 설정 오류 문구를 쓴다.

## 검증

- 최초 전체 회귀는 **77/83**, CLI 등록 패치 적용 실패6건. 설치된 Elda CLI에 ops 등이 추가되고 기존 문맥이 바뀐 것이 원인이었다. 우리 저장소의 등록 패치만 수정했다. 테스트는 격리 사본에 적용하며 원본 CLI 해시 불변을 확인한다.
- 수정 후 전체 회귀 **83/83 통과**, skip0. 이후 503 문구 보정을 추가해 HTTP·Anthropic 관련 회귀를 다시 실행했다. [전체 로그](results/h20-cycle4-regression-final-2026-11-11.txt), [최종 호환 경로 로그](results/h20-cycle4-compat-final-2026-11-11.txt), [최종 TypeScript 검사](results/h20-cycle4-typecheck-complete-2026-11-11.txt).
- 본문 실패13종 × 두 호환 경로 **26요청**에서 상태·분류·재시도 가능 여부·민감 문구 미노출·native 호출 정확히1회를 확인한다. 모두 loopback 모의 공급자다. 초기 시험의 Anthropic 분류 전달 누락과 등록 패치 실패 로그도 results에 보존했다.
- 실제 HCX-005·007은 각각1회 정상 응답, **2/2 통과**. 합계 입력40·출력24토큰, 재시도0, 도구0. [실제 응답](results/h20-cycle4-live-2026-11-11.json). 오류를 실제 과금 요청으로 유발하지 않았다. 기존 페르소나 원장은 바꾸지 않았고 요금·잔여 크레딧은 미확인이다.
- [소스 해시](results/h20-cycle4-source-manifest-2026-11-11.json), [실행 전 계획](H31-CYCLE4-PLAN-2026-11-11.md). 자매 프로젝트·배포 환경 소스 변경은 없다.

## H31 준비에서 확인한 차이

PATH의 `~/.local/bin/elda`는 예전 진입점이며, `~/apps/elda-cli`에는 ops 프로필과 native CLOVA 제공자가 있다. mars의 `~/WorkArea/Elda-CLI` HEAD는 조회 시 `f13b8758fe254cef6de89961e101efefdcd20cd5`였다. 원격 소스는 읽기만 했다. 단순히 `elda`를 실행했다고 같은 구현이라고 간주하면 안 된다.

현재 ops는 Python MCP·운영 지시문, 랩은 Node MCP, memory Pi는 페르소나 지시와 기억을 별도로 구성한다. 따라서 기본 프로필로 세 경로를 돌려 비교 점수를 내면 H31의 고정 조건을 충족하지 않는다. 비교용 프로필에서 동일 system·도구 이름/schema·생성 설정·승인·토큰 한도를 고정하고 실제 요청을 대조하는 작업이 남았다. 같은 응답 두 호출의 거절/허용 시험도 반드시 포함해야 한다.

**이번 사이클은 H20+ 수정과 실제 제공자 정상 경로 확인까지 완료했다. H31 세 경로 실모델 비교·Pi 거절 이후 배치 중단 수정·운영 배포는 아직 하지 않았다.** 83개 회귀 통과를 H1–H56 전체 적합성으로 확대하지 않는다. HTTP 비2xx 응답의 본문 분석, Retry-After 전파 및 재시도 이벤트 전체 계약은 이번 변경 범위 밖이다.

재실행:

```bash
TMPDIR="$PWD/.local/runtime-tests-tmp" node --test runtime/clova/test/*.test.ts
npm run check:clova-runtime
python3 runtime/memory-lab/live-from-deployment.py --live --provider-smoke --output runtime/clova/results/h20-new-live.json
```

마지막 명령은 실제 API 최대2호출이며 출력 파일이 이미 있으면 거절한다. 키는 기존 프로젝트의 배포 인증 경로를 사용해 비공개 임시 파일로 전달한 뒤 제거한다.
