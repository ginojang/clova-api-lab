# M3 v0.2 r3 — 합성 원자료의 원인 분류와 coverage 감사

2026-11-17. n03·n08·n10·n14의 지정 체크포인트 8개만 검토했다.
모델/API/DB/운영 실행, 서버 로그 gzip 열람, 새 의미 라벨 부여는 하지 않았다.
기존 골드·예측·과거 감사 파일은 변경하지 않았다. 추출 근거는 [runtime_cases.json](runtime_cases.json)에 있다.

- 원자료: `GanpanAI@ec3c9b262a14ffe07958b09f77d8b6e2b3de2481:elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/`.
- 실행 소스: `GanpanAI@a315c32c008694e52b0fcfc11651ae986340a7ad`; `run_meta.json`의 보고다.
- 봉인 묶음: `clova-api-lab@7b9b9443d8b885742f66aa40d4308018ec46303a:runtime/long-memory-research/eval-v1/`.
- 계약·독립 골드: `elda-resoner@b91323f4580e17fec9431289c88e0f601dccd669`.
- 어댑터 소스 SHA256 `bad63dde37cec957dbf11566f71e2f5d73273c92ee5448a37695cd6e3982287f`는 실행 metadata와 같다. dist 대응·배포 상태는 독립 검증하지 않았다.

## 확인된 동작과 원인 해석의 한계

| 사례 | 직접 확인한 근거 | 해석 |
|---|---|---|
| n03 양쪽 q2 | op446·449 WITHDRAW applied=true, 대상 fact238·240 invalid=true, profile/current 빈 배열 | 철회 적용 성공. 표시명은 양쪽 모두 `취향`; 합성 슬롯 키와의 대응 문제를 WITHDRAW 미실행으로 부르지 않는다. |
| n14 signage q2 | op539 SUPERSEDE applied=true, fact306 current, needs_confirm_flag=false | 봉인 CONTEST/확인 필요 기대와 불일치. 정확한 correction_evidence 원문은 보존되지 않아 그 span의 의미를 직접 판정할 수 없다. |
| n14 guest q2 | op543 CONTEST applied=true, fact309 needs_confirm_flag=true, profile=needs_confirm, principal=[유자차], current=[] | CONTEST 상태 전이는 확인된다. current 빈 배열을 상태 미반영으로 해석하지 않는다. |
| n08 양쪽 q3 | 마지막 C가 ran=true, why=null, promises_seen=0, applied=held=0, dropped=[] | C 호출 실패나 r2의 await_s6 보류와 다르다. 성공 반환된 객체의 promises가 빈 배열이거나 누락/null인 경로다. 원출력 형태는 미보존이다. |
| n10 양쪽 q1 | C ran=true, why=null, episode=false, dropped=[], S6 pass; episode_values=[] | C 경로의 episode 미저장은 확인된다. 모델 미출력과 저장 실패는 분리할 수 없다. |

`ltm_op_dump.jsonl` 근거 줄: n03 11·14, n14 64·67. n08 원장에는 해당 범위의 ADD fact만 있다(31·32행).
각 raw의 `_op_boundary`는 위 대상 op를 포함한다. n14 원천 T 영수증은 `t_receipts.jsonl:191,197`에서 실제 turn_index=3으로 연결된다.
C 완료 요약은 `run_events.jsonl:155,168`(n08 q3), `:197,206`(n10 q1)에서 다시 확인된다.

`m3v02Run.ts:228`은 current_values를 profile.state=`current`로 한정한다.
반면 봉인 gold n14 q2-c04는 잠정 새 값을 current_values에도 기대한다(`gold.jsonl:80,83`).
따라서 guest의 CONTEST 성공과 c04 불일치는 함께 성립한다. 이는 정의·투영의 차이이며 골드를 사후 변경하지 않았다.

정확한 correction_evidence는 `ltm_op_dump` SELECT에 없고(`m3v02Run.ts:462–464`),
영수증도 원출력·correction_evidence·downgraded 수를 내보내지 않는다(`:453–457`).
소스 guard를 따른 SUPERSEDE라면 근거 검사를 통과했을 것이라는 추론은 가능하지만,
“실제로 어떤 문구를 CE로 냈으며 그 의미가 틀렸다”는 독립 검증과는 다르다.

`s6chatEnd.ts:152`의 call_failed는 조기 반환한다. n08의 ran=true/why=null은 그 분기와 구별된다.
다만 `:228`의 promises_seen은 `(j.promises ?? []).length`이므로 빈 목록과 필드 누락까지 구별하지 않는다.
`s6chatEnd.ts:221–228`은 episode INSERT 실패를 경고만 남긴 뒤 episode=false/ran=true를 반환할 수 있다.
따라서 n10에 “모델이 episode를 안 냈다” 또는 “저장 SQL이 실패했다” 중 하나를 확정하지 않는다.

## n14 문장·버전 혼동과 의미 정의

봉인 `scenarios.jsonl:27`의 n14-signage-e003과 r3 raw의 실제 문장은 같다.

> 앞으로도 기억해 줘. 우리 가게 간판의 기본색는 연두색야.

guest는 같은 구조의 “내 평소 기본 차는 유자차야”이다(`:28`).
“이전 남색 대신 연두색가 내 새 기본 기준이야”는 이 n14 q2 원문에 없다.
그 표현은 같은 봉인 커밋의 **eval-v0** `build_dataset.py:347`에 있는 m07~m09의 본인 채택 후속 양성이다.
그 경우의 기대 연산도 이미 SUPERSEDE다(`:350–352`).
독립 T 골드 k08은 “예산은 150 말고 200까지 돼요”로 SUPERSEDE를 기대한다(`s6_memory_turn_eval_v0_5/eval.jsonl:8`).
그러므로 위 교체 표현을 n14 q2로 인용해 두 골드가 모순이라고 하는 근거는 버전·ID 대조에서 성립하지 않는다.

다만 n14의 기억 요청·새 기본값 진술을 얼마나 명시적인 정정으로 읽을지는 정책의 의미 경계다.
확인한 사실은 **봉인 CONTEST 기대와 signage의 실제 SUPERSEDE 불일치**다.
앞선 “런타임이 정정 뜻을 확실히 오판했다”는 원인 확정은 이 표현으로 제한하는 것이 맞다.
이 판단은 frozen gold 변경이나 현재 출력의 정답 재지정을 뜻하지 않는다.

## 기존 C coverage와 문구 변경의 효과

C v0.5 골드 MD5는 `c9ef1b200f37ee718c7232ef22ea8477`이며 13줄, 기대 약속 3개다.
pass 미래 약속은 이미 p01(1행, 다음에 견적서 재송부), e05(10행, 다음 주 설치 일정 통지), x01(11행, next time 버전 송부)에 있다.
C v0.006 프롬프트 `:16–18`도 명시적인 미래 약속과 같은 문장이 여러 턴에 있을 때 pass 원천을 고르도록 한다.
`:43–44`에는 다음 방문 때 시안을 보여 주겠다는 예시도 있다. 미래 약속 규칙이 없었다고 설명하면 부정확하다.

13개 골드는 모두 assistant 턴이 하나이고 총 2~3턴이다.
동일한 약속이 block/pass 원천에 반복되거나 중간 probe 답이 앞 약속을 제안으로 재분류하는 경우는 없다.
r3 n08의 실제 합성 실행기 이력에는 “확정된 약속은 없고 앞의 말은 제안”이라는 중간 답들이 있고,
그 뒤 마지막 pass fixture가 같은 미래 약속을 다시 말한다. 이 이력은 두 영역에서 확인된다.
probe는 관측만 하는 질문이 아니라 다음 C가 읽는 대화 이력도 만든다는 설계 경계를 기록해야 한다.
이 혼합 문맥이 누락의 원인이라는 결론까지 입증되지는 않는다. 실제 C 요청·응답 원문은 이 raw에 없다.

## 정정 표지의 닫힌 목록 제안

계약 M4(`S6_MEMORY_CONTRACT_v0.md:31`)는 값 관계의 판단을 리소너에 맡긴다.
M5(`:32`)와 T v0.011 프롬프트 `:38`은 명시 정정이라는 의미 조건과 예시를 제시하며 닫힌 어휘 목록을 정의하지 않는다.
“표지가 없으면 CONTEST”라는 추가 조건은 보수적인 보조 장치로 제안할 수 있으나 별도 정책·coverage 변경이다.
“친구가 이제 카페로 바꿨어요”, “이제 바꾸자는 뜻은 아니에요”, 인용 속 “정정”에도 표지는 존재한다.
반대로 새로운 표현·다국어의 유효 정정을 CONTEST로 낮출 수 있으므로 목록 일치만으로 자기 정정 의미를 보장하지 않는다.
이번 자료만으로 자동 whitelist 도입이나 골드의 일괄 변경을 권고하지 않는다.

같은 작은 골드를 반복 튜닝한 K3와 r2→r3의 단일 실행 차이는 특정 문구의 독립 효과를 분리하지 못한다.
프롬프트·guard·실행기 이력과 관측 조건을 구분해 보고하며, 전체 성능·인과 효과·독립 holdout 검증으로 확대하지 않는다.
