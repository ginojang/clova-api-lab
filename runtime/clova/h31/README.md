# H31 세 실행기 비교

현재 방향은 [H31 결론](CONCLUSION-2026-11-11.md)을 따른다. 비교 실험은 종료하고 ②는 Elda CLI native로 정리한다. 아래 명령은 과거 결과 재현용이며 추가 유료 비교를 예정한 작업 목록이 아니다. LangGraph는 동결 기준선, Pi는 페르소나 실험용으로 남긴다.

설치 Elda CLI native loop, LangGraph, memory-lab Pi를 같은 native HCX-005 요청으로 비교한다. 외부 CLI 소스는 읽기만 하고 비교 작업장은 이 저장소의 `.local/h31`에 만든다. 원시 요청에는 인증 헤더를 저장하지 않는다. 네 artifact 도구만 제공하며 Comms·Notion은 붙이지 않는다.

실행 전 [최초 계획](PLAN-2026-11-11.md), [후속 계획](PLAN-R2-2026-11-11.md), [설계 감사](DESIGN-AUDIT-2026-11-11.md)를 읽는다. r1/r2는 판정과 pacing이 다르므로 결과를 합쳐 하나의 점수로 만들지 않는다. 기존 결과 파일은 덮어쓰지 않는다.

2026-11-11 추가 사이클은 [후속 결과](RESULT-NEXT-2026-11-11.md), [인자 비교](MALFORMED-FINAL-2026-11-11.md), [공식 키트](kit-README.md)에 기록했다. Pi 복구 뒤 최종 답변, 승인 전 원시 인자 검증, JSONL 입력·세션 계약을 보완했다. 앞선 r1/r2 결과는 당시 소스에 대한 역사적 기록이다.

복구 과제만 재현하려면 [전용 계획](PLAN-RECOVERY-NEXT-2026-11-11.md)에 따라 새 경로로 실행한다. 실제 요청은 최대18회이며, 성공한 동일 소스의 모의 preflight가 필요하다.

```bash
node runtime/clova/h31/recovery-next.mjs --output .local/new-recovery-preflight.json
python3 runtime/memory-lab/live-from-deployment.py --live --h31-recovery-next \
  --preflight .local/new-recovery-preflight.json --output .local/new-recovery-live.json
```

```bash
node runtime/clova/h31/run-r2.mjs --output /이/저장소/내부/new-preflight.json
python3 runtime/memory-lab/live-from-deployment.py --live --h31-r2 \
  --preflight /이/저장소/내부/new-preflight.json \
  --output /이/저장소/내부/new-live.json
```

첫 명령은 모의 공급자다. 둘째 명령은 실제 API를 최대90회 호출할 수 있으며, 공급자 요청 시작 사이 최소6초를 둔다. 기본 CLI 디렉터리는 `/home/gino/apps/elda-cli`이고 `--cli-dir`로 명시할 수 있다. PATH의 오래된 elda를 자동 선택하지 않는다. preflight의 실행기·판정기·제공자 소스 해시가 일치하고 모의 경계/요청 동등성 검사를 통과해야 실제 실행한다.

Graph 비교 설정은 `rawToolNames:true`, `includeMcpInstructions:false`, `plainToolResults:true`, `tokenLimit:20000`이다. 기본 지시 합성·도구 접두어를 바꾸는 전역 설정은 아니다. Pi는 `--comparison-profile`을 명시한 baseline에서만 persona/기억 대신 정확한 공통 system을 사용한다. [native bootstrap 계약](README-native.md)과 [Pi 구현 메모](../../memory-lab/pi/notes.md)를 참고한다.

`turn_end`는 실행기가 낸 그대로 보존한다. 독립 `pass`는 파일 내용·필수 도구·call/result 짝·승인·프로세스 정리를 판단한다. 복구된 파일이 맞아도 런타임이 `ok:false`일 수 있다. 실제 `batchObserved:false`는 H56 미관측이며 모의 배치 검사와 구분한다. `usageUnreportedCalls`가 있으면 usage 합계는 알려진 부분만이다. 가격·크레딧은 조회하지 않으며 비용unknown이다.

r1/r2 당시에는 공식 적합성 키트를 실행하지 않았다. 이후 별도로 실행한 키트의 버전·실패·경고는 [키트 기록](kit-README.md)에서 확인한다. 이 테스트의 성공을 H1–H56 전체 적합성이나 운영 승격으로 읽지 않는다. 소규모 같은 과제 재검증이며 모델 품질 순위·일반적인 속도 우위를 입증하지 않는다. 실제 응답의 call ID·문장은 달라질 수 있으므로 두 번째 wire의 정확한 동등성은 모의 공급자에서만 확인한다.
