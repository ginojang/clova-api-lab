# T/C K=3 합성 평가 독립 재채점 — 2026-11-17

결과 원천은 `GanpanAI@4449c90077221844cc833b2d2a2a0970fcd94ba7:elda-orchestrator/measurements/eldacore/s6_memory_20261117/`다. 구 결과에는 `elda-resoner@fa6d99df6ddaf500aaeabd8fdb3ef1b83a6ed0d8`, 신 결과에는 `elda-resoner@54e8c18f7600e2d0c94f76b5140ceb3aa499afe1`의 채점기를 적용했다. **구·신 T/C 네 개의 저장된 score JSON 모두 정확히 재현됐다.**

[k3_audit.py](k3_audit.py)는 소스를 읽은 뒤 AST에서 검토한 순수 `score_rows` 및 T의 `_match/_vmatch` 정의만 추출한다. 외부 스크립트의 main/build/teeth, top-level 자료 생성 코드는 실행하지 않았다. 호출한 외부 명령은 로컬 Git 객체 읽기뿐이다. 모델·관문·API·DB 호출, 실제 고객·서버 로그 열람, 타 저장소 수정은 하지 않았다. 상세 재계산과 실패행 근거는 [k3_audit.json](k3_audit.json)에 있다. M3 봉인과 이전 score 원본은 그대로다.

골드 T v0.5의 39행과 C v0.4의 13행은 두 소스 ref에서 **바이트 동일**하다. META와 저장 score의 eval_md5도 실제 바이트와 일치한다.

| 골드 | MD5 | SHA-256 |
|---|---|---|
| T 39행 | `3372c065ac4008ea281e9bd603d94969` | `b842e99d32d1ac119e37ea3e42f18f6d59b917298ee0f4e35caee5d9cb8a646a` |
| C 13행 | `737ab9f633fac5f9734136e791a55d00` | `f7a14914109dfa7ed8db9fdf604c1323f216e74444434fdb347ddadf01588aff` |

각 T 파일은 39 ID × 3회 = 117행, C 파일은 13 ID × 3회 = 39행이다. ID 누락·미지 ID 없이 모든 ID가 rep 0·1·2 순서로 한 번씩 나타난다. 따라서 원 채점기의 ID별 파일 출현 순서 묶음과 rep 표지가 일치한다. 모든 행이 measured=true다. 117/39회의 반복 관측을 각각 독립 사례 117/39개로 해석하지 않는다.

| 결과 | 반복별 rows_ok | 사례 분모 | majority_ok | 저장 gates_n_per_run |
|---|---|---:|---:|---|
| T v0.009 | 38 / 38 / 38 | 39 | 38 | false_memory 1 / 1 / 1 |
| T v0.010 | 39 / 37 / 38 | 39 | 38 | 없음 / value_wrong 1 / 없음 |
| C v0.004 | 12 / 10 / 11 | 13 | 10 | 없음 / promise_false 1 / promise_false 1 |
| C v0.005 | 13 / 13 / 13 | 13 | 13 | 없음 / 없음 / 없음 |

여기서 majority는 **사례마다 rows_ok 불리언의 과반**이다. 모델 출력 자체를 다수결로 선택해 재채점한 결과가 아니다. T 구·신은 반복 행 통과 합계가 둘 다 114/117이며 majority도 38/39로 같다. 따라서 전체 통과율 개선으로 요약하지 않고 오류 유형·사례 이동을 함께 보고한다.

T의 확인 사항:

- 구 v0.009의 실패는 매회 `k09`다. 기대 CONTEST와 달리 제출 `ops`에 `SUPERSEDE/business`가 있어 매회 false_memory 1과 기대 연산 놓침 1로 집계된다.
- 신 v0.010의 `k09`는 제출 `ops`가 CONTEST 3/3이며, **채점기에서 CONTEST로 낮춘 수는 0**이다. `s01`·`s02`는 각각 SUPERSEDE 3/3이고 원문에 일치하는 correction_evidence가 있다. 다만 T 파일에는 모델 원응답 전문이 없고 처리 후 `ops/dropped`가 있으므로, 모델 원출력부터 CONTEST였는지 또는 앞단에서 변환됐는지까지 이 파일만으로 인증하지 않는다.
- 신 rep 1의 `k05`는 기대 값 `다음 달 15일`에 대해 제출 값 `12월 15일 오픈`이 나와 value_wrong 1이다. 이는 이 채점기의 표면 포함 검사 실패이며 상대 날짜와 절대 날짜의 의미 일치를 별도로 판정한 결과가 아니다.
- 신 `j01`은 rep 1·2에서 business 값 `미용실`이 `value_not_in_evidence`로 dropped에 남아 있다. 근거 원문 값은 `美容室`이다. 채점에 들어간 `ops`에 필수 business ADD가 없어서 각 회차가 실패한다. 두 회차 모두 해당 행의 gates_n은 비어 있지만 필수 연산 회수는 1/2다. 차단된 제안을 실제 오염 쓰기나 안전 관문 위반으로 세지 않는다.
- 문서의 **안전 관문 0**은 value_wrong을 지표로 분리하는 채점기 설명에 따른 해석이다. 저장 JSON의 `gates_n_per_run`이 모두 빈 객체라는 뜻은 아니다. 새 T에는 value_wrong 1이 실제로 저장돼 있다.

구 C v0.004의 실패 원인도 행별로 확인했다. `p04`는 rep 0·1에서 기대 consult 대신 design kind, `p02`는 rep 1·2에서 기대 quote episode가 없음, `e04`는 rep 1·2에서 기대하지 않은 약속이 있어 promise_false다. 신 C v0.005는 모든 13개 사례가 세 번 모두 통과했다. 구 C의 raw_promises/채점 promises 개수는 3·4·4, 신 C는 3·3·3이며 **이번 두 C 예측 파일의 각 행에서 두 목록은 동일**하다. 이번 C 통과를 원문 약속을 필터로 숨긴 결과라고 설명할 근거는 없다.

채점기 변화와 해석 경계:

- C 채점기 소스는 구·신 ref에서 바이트 동일하다(SHA-256 `63416c6f8beb1738b81868bb4b67be5a7e9625071c2f6ae6b3e0e7d837d8283e`). T 채점기는 변경됐다: 구 SHA-256 `cde7922f0d63a2b6fbe4c0497adfbe127aec2572924ed0a2365e7f524da961a7`, 신 `5953d4a88fc387dcd3f032a19217c6307ef234742ca450576cc4c8a423ae2dc8`.
- 새 T `s6_memory_turn_eval.py:169–176`은 SUPERSEDE의 correction_evidence 문자열이 지목한 턴에 없으면 채점용 연산을 CONTEST로 낮춘다. 구 예측에는 신 계약의 근거 칸이 없으므로 신 채점기를 소급 적용하지 않았다. JSON의 `submitted_supersede_without_matching_correction_span`은 제출 필드 진단이며, 구 실행에서 downgrade가 실제 발생했다는 뜻이 아니다.
- T `:135–149`는 기대값의 표면 포함을 검사하며 수명·민감 표지 오류는 `:188–191`에서 별도 계수다. rows_ok나 named gate 0을 모든 의미·속성의 완전 정답으로 확대하지 않는다.
- C `s6_memory_chat_eval.py:105–123`은 약속의 원천 S6를 검사하고 episode kind를 검사한다. 이 결과만으로 did별 원천 S6 결합이나 운영 적용 관문 전체를 검증했다고 할 수 없다. 이 범위는 별도 정책·구현 감사와 결합해야 한다.
- 같은 합성 시험지의 반복 pretest이며, 사람 검수 완료·미열람 홀드아웃·M3 84탐침 실행 통과·운영 품질 보증이 아니다. K=3을 독립 사례 분모로 늘리거나 M3 점수와 합산하지 않는다.

| 실제 예측 파일 | SHA-256 |
|---|---|
| T v0.009 `23b15df4` | `666a22fb6a1900698d7f2ed1d3d46e87783389e8b89edf8e954d37807f0c1718` |
| T v0.010 `2a41e14b` | `7e40dfef3850de246a1300cfa34193e69665735c54b01f2f58fa69d89f8cab3d` |
| C v0.004 `c02947e1` | `086bf4a0a8f6a9e57f0e0802a3a4a7a6af9cdea0a2c85d164c8728fd4989520e` |
| C v0.005 `8064fd2b` | `336f14b57d5329f9da5520b03ec916cd748082f240da010b4e59ded1c57b9807` |
