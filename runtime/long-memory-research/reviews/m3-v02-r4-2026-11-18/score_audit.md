# M3 v0.2 r4 — 봉인 재채점·r3 비교·실행 조건 확인

2026-11-18 · 클로버. **제출 report와 재계산 결과가 JSON·바이트까지 일치한다. r3와 r4는 같은 68개 관측이며 470개 구조 검사의 status/reason도 모두 같다.** 합계가 같다는 사실을 출력·저장 동작까지 같다고 해석하지 않는다.

고정 Git 소스와 커밋된 합성 JSON/JSONL만 읽었다. 모델/API/관문/DB/운영 서비스 및 어댑터를 실행하지 않았고 서버 로그·gzip을 열지 않았다. 기존 봉인과 r1/r2/r3 산출은 보존했다.

- r4 자료: `GanpanAI@adf49beb0fb094074a36030db09451d70875a796:elda-orchestrator/measurements/eldacore/m3v02_20261117_r4/`.
- 기록된 runtime: `847c482038c80fef77b44c20d897de9adf42e711`; run `m3v02-orch-20261117-847c4820`.
- r3 비교: `GanpanAI@ec3c9b262a14ffe07958b09f77d8b6e2b3de2481:elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/`.
- [재채점 집계](score_audit.json), [재계산 report](score_audit.report.json), [r3→r4 비교·실행 집계](comparison.json), [비교 코드](comparison.py), [무결성 감사](provenance_audit.json).

## 점수와 분모

| 단위 | r3 | r4 |
|---|---:|---:|
| 관측 / 계획 탐침 | 68 / 84 | 68 / 84 |
| 전체 구조 470: 통과/실패/unknown | 322 / 18 / 130 | 322 / 18 / 130 |
| 관문 280 | 183 / 3 / 94 | 183 / 3 / 94 |
| 비관문 190 | 139 / 15 / 36 | 139 / 15 / 36 |
| 의미 판정 84 | 0 / 0 / 84 | 0 / 0 / 84 |

공통 관측은 68개 전부이며 어느 쪽만의 관측도 없다. 검사 상태 이동은 통과→통과322·실패→실패18·unknown→unknown130뿐이다. 같은 68관측에 속한 구조 검사366개는322/18/26, 관문212개는183/3/26이다. 탐침별 전체 상태는 fail14·incomplete70·pass0이다.

남은 관문 실패는 n03 두 영역의 withdrawal 슬롯 비교2와 n14-signage q2의 contest1이다. 실제 WITHDRAW 적용 및 n14 값 상태는 별도 원인 자료로 구분해야 한다. 의미84는 관측68개의 판정 출처 부재와 예측 누락16으로 unknown이다. source_binding12개와 정확한 토큰 상한8개도 모두 unknown이다.

누락16개는 n05/n06 두 영역 q3, n10/n12/n13 두 영역 q2·q3다. 이 중 challenge2개는 모두 누락되어 그 관문4개도 unknown이다. 구 봉인 계약은 C 약속과 episode의 정확한 원천 S6=pass이며, 이후 unknown/none did 허용을 소급하지 않았다.

## 같은 점수에 숨은 n08 투영 차이

`n08-signage-q3-c03`과 `c05`는 정확한 값 **“다음 방문에 창문 치수 재확인”**을 각각 effective_active_values와 must_repeat_values에 기대한다.

r4는 ADD:promise가 있고 두 배열에 **“창문 치수 재확인”**이 있다. 시간 구절이 빠진 문자열이므로 봉인 채점기의 두 검사는 계속 실패한다. 반면 실제 답은 “다음 방문 때 창문 치수를 재서 확인”이라고 말한다. 따라서 점수가 r3와 같다는 사실을 **약속 저장 0 또는 자연어 회상 불능**으로 읽으면 안 된다. 후처리 투영과 의미 판정을 구분하고 gold·예측은 그대로 둔다. 정확한 원문·관측 배열은 comparison의 `n08_signage_projection_boundary`에 보존했다.

## 관측 누락 원인과 T 실패 전파의 검증 범위

r4는 raw/request 79쌍이며 유효 예측68·invalid raw11개다. r3는80쌍·68+12개였다. n05-signage q3가 `before_504:{"error":"turn_before_timeout"}` checkpoint_failed로 바뀌어 이 raw 쌍 자체가 없다. 기존에 누락됐던 같은 탐침이라 유효 관측 ID와 점수 분모는 변하지 않았다.

| r4 누락 경로 | 탐침 수 | 범위 |
|---|---:|---|
| checkpoint_failed before504 | 1 | n05-signage q3 |
| release_already_finished로 invalid | 3 | n05-guest q3, n06 두 영역 q3 |
| advance_time 미지원 taint로 invalid | 8 | n10/n12 두 영역 q2·q3; n12 q3에는 release_lost도 누적 |
| scope_collision로 probe_skipped | 4 | n13 두 영역 q2·q3 |

담당 README의 n05와 n10 설명은 모든 누락을 열거한 것이 아니다. n06·n12·n13의 미지원/충돌도 계속 존재한다.

| 선택된 T 영수증·settle | r3 | r4 |
|---|---:|---:|
| 영수증 / 서로 다른 cid | 200 / 48 | 198 / 48 |
| 키 매칭 / n번째 짝과 일치 | 200 / 200 | 198 / 198 |
| 선택키 중복 / 영수증 누락 | 0 / 0 | 0 / 0 |
| T ok=true / false | 196 / 4 | 198 / 0 |
| 명시 settle ok=true | 94 | 93 |
| settle의 t_failed=true | 필드 없음 | **0** |

r4의93개 settle은 모두 `t_failed=false`다. 새 실패 전파 코드가 포함된 소스라는 점은 확인되지만 **이번 run은 ok=false 분기를 밟지 않았다.** r3의 실패4개를 r4에서 실패로 재현해 제외를 확인한 시험이 아니다. 선택된 영수증도 전체 호출 attempt 원장이 아니고 ok=true가 개별 DB 적용 성공을 뜻하지 않는다.

r4 영수증198개에는 reason·downgraded·ops_detail 필드가 모두 추가됐다. 이 새 기록은 r3에 소급 채워지지 않았다. 아직 retry·count fallback 등 모든 경로의 실패 전파를 증명한 것도 아니다.

n11 q2/q3 snapshot fact는 signage각1개·guest각2개이며 notes=[]/invalid=null이다. T 실패가 없더라도 방해 문장24개가24개 기억으로 저장됐거나 실제 예산 압력이 생겼다는 증거는 아니다. 실제 tokenizer 부재와 item ID 미관측도 유지되므로 예산 한도 검증으로 승격하지 않는다.

## history 분모와 무결성

history 노출은14/20→15/21 값-탐침쌍으로 늘었다. 변화는 n14-guest q3 하나다. r3의 감시/노출 값은 보리차1개, r4는 보리차·유자차2개다. 고정 gold가 기대하는 감시값은 여전히1개이며 보리차 노출도 유지된다. 관련 탐침22개의 상태는4통과·12실패·6unknown으로 동일하고 strict-zero는 fail이다. 분모 변화로 전체 성능의 개선·악화를 추정하지 않는다.

공용 provenance 감사 exit0: 유효68개의 source/capture 해시, 내장 캡처, 답·run·blind ID, unblind가 모두 일치한다. runtime과 결과 트리의 adapter SHA256은 `38e2b61db0a95f21a249b6fe743a117efd52797f492022f62a05eca07e02eba3`로 메타데이터와 같고 T/C·자기소개·상담 프롬프트4개도 일치한다.

실행 기록은 T v0.011·C v0.006, late judge off, C 지연7일, before→brain→after 대역이고 실제 Elda CLI가 아니다. `runtime_src_dirty=null`과 dist 해시·runtime ref를 기록했다는 사실은 배포 바이너리·작업 트리를 독립 인증한 것이 아니다. `bundle_head_sha`는 커밋 문자열의 해시이며 봉인 파일 manifest 해시와 구별한다.

## 재현

기존 공용 `../m3-v02-run-2026-11-17/score_audit.py`에 `--source-commit adf49beb0fb094074a36030db09451d70875a796 --source-prefix elda-orchestrator/measurements/eldacore/m3v02_20261117_r4/ --output-dir <저장소 안 새 빈 디렉터리>`를 전달했다. 같은 ref/prefix의 공용 `provenance_audit.py`도 exit0이다.

`PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r4-2026-11-18/comparison.py --output <저장소 안 새 파일>`로 비교 집계를 재현한다. 기존 결과를 덮어쓰지 않으며 모델 호출·새 실측은 하지 않는다.
