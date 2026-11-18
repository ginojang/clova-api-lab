# M3 v0.2 r4 — n08·n10·n14 원인 자료 감사

2026-11-18 · 클로버. **C 원출력 덕분에 n08의 후보 부재와 n10 첫 C의 episode=null은 저장 실패와 구분된다.** 다만 중간 부정 발언이 n08 누락의 단독 원인이라는 인과 결론이나 n14의 정확한 correction_evidence 부분문장까지 입증되지는 않는다.

- 결과: `GanpanAI@adf49beb0fb094074a36030db09451d70875a796:elda-orchestrator/measurements/eldacore/m3v02_20261117_r4/`.
- 메타데이터 runtime: `847c482038c80fef77b44c20d897de9adf42e711`, T v0.011·C v0.006, late judge off.
- 봉인: `clova-api-lab@b8d1c47a06c4fb245660ffa3c2c2063d492cb903:runtime/long-memory-research/eval-v1/`.
- [재현 코드](runtime_cases.py), [근거·해시 JSON](runtime_cases.json).

Git에 커밋된 합성 사례와 소스만 읽었다. `c_raw_n08_n10.txt`는 합성 측정 출력이며, 운영 서버 로그·gz는 읽지 않았다. 모델/API/관문/DB/런타임 실행, 새로운 의미 라벨 부여, 봉인 변경은 하지 않았다.

## C 원출력 8건의 연결

별도 텍스트에 표시된 8개 C 원출력은 해당 raw 캡처의 `c_runs[].sum.raw`와 정확히 같다. 각 summary도 `run_events.jsonl`의 finish_c 결과 하나와 정확히 일치한다. raw를 JSON으로 해석한 약속 배열 길이는 `promises_seen`과 모두 같다.

| 이야기 | C1 / C2 / C3 약속 후보 수 | C3 적용 | 확인 범위 |
|---|---:|---:|---|
| n08-signage | 0 / 0 / 1 | 1 | 후보·근거·적용 요약·원장 연결 |
| n08-guest | 0 / 0 / 0 | 0 | 모델 출력에서부터 빈 약속 배열 |
| n10-signage | 0 / 추가 호출 없음 / 추가 호출 없음 | 해당 없음 | 첫 C episode=null |
| n10-guest | 0 / 추가 호출 없음 / 추가 호출 없음 | 해당 없음 | 첫 C episode=null |

이는 각 이야기의 연속 C 호출 수다. n08의 0/3을 동일 입력의 독립 반복 3회나 전체 약속 정확도로 표시하지 않는다. C1과 C2는 아직 마지막 pass 재약속을 받기 전이다.

## n08 — 앞선 부정과 뒤의 재약속

두 영역 q3의 **두뇌 입력 이력**에는 같은 순서가 있다.

| assistant의 순서 | C 번호와의 대응 후보 | 내용 | C3 summary의 S6 |
|---|---:|---|---|
| 첫 번째 | 1 | 다음 방문에 재확인하겠다는 fixture | block |
| 두 번째 | 3 | 확정 약속은 없고 앞말은 제안/메모라고 설명 | none |
| 세 번째 | 5 | 오늘 대화에 집중하겠다는 fixture | pass |
| 네 번째 | 7 | 확정 약속이 없다고 다시 설명 | none |
| 다섯 번째 | 9 | 첫 번째와 같은 재확인 약속 fixture | pass |

소스의 gather는 사람·assistant를 순서대로 펼쳐 번호를 매긴다(`s6chatEnd.ts:35–40`). 모델의 원출력도 턴3·7·9를 직접 언급한다. 그러나 캡처된 request는 두뇌용 request이며 실제 C의 `turns/elda_s6/today` 요청은 아니다. 정확히 같은 C 입력 바이트를 독립 검증한 것으로 표시하지 않는다. 또한 late-off 소스는 summary의 none을 모델 입력에서 unknown으로 바꾼다(`:150`). summary의 S6 표를 모델이 그대로 받았다고 하면 부정확하다.

signage C3는 source9/pass의 약속을 실제로 냈다. 그런데 why는 앞선 턴3·7의 “제안” 설명을 근거로 **“확정된 약속이 아님”**이라고 썼고 p_yes=0.15였다. 후보 존재와 자기 설명이 어긋난다는 점은 직접 확인된다. guest C3의 원문은 `promises:[]`이며 episode outcome에 “확정된 다음 약속 없음”이라고 썼다. guest에는 약속 후보별 why가 아예 없으므로 signage의 구체적 설명을 guest 내부 판단의 직접 증거로 옮기지 않는다.

따라서 “이전 부정 발언보다 뒤의 pass 재약속을 우선해야 한다”는 후속 규칙과 회귀 사례 설계에는 근거가 있다. 다만 원출력의 자기 설명과 이력 관찰은 중간 문장만 제거·변경한 대조 실험이 아니다. **n08의 단독 원인 확정, C v0.007 문구의 독립 효과 또는 모든 장기 대화의 개선으로 확대하지 않는다.**

signage의 적용은 summary의 applied=1/applied_t와 `ltm_op_dump.jsonl:29`의 promise op608·fact361·applied=true·p_yes0.15로 다시 확인된다. C evidence 번호9와 원장의 ev_turn_index5는 서로 다른 번호 체계다. 전자는 펼친 C 메시지 번호, 후자는 chat 턴 번호이며 두 숫자가 다르다는 이유로 원천 불일치라 하지 않는다(`:190–192`).

**같은 q3의 기억·회상 검사 실패를 약속 미저장으로 읽으면 안 된다.** C `promises[0].t`와 `applied_t`는 모두 “다음 방문에 창문 치수 재확인”이며, 새 customer_memory 블록도 “사실: 다음 방문에 창문 치수 재확인”을 담는다. 실제 답은 “다음 방문 때 창문 치수를 재서 확인”하는 약속을 회상한다. 그러나 어댑터의 harvest는 `다음 방문에`를 떼고 “창문 치수 재확인”만 어휘로 뽑는다(`m3v02Run.ts:107–111`). 이 투영을 사용하는 effective_active_values와 must_repeat_values에는 짧은 문자열만 남아, 봉인 gold의 긴 문자열 배열 원소 검사 두 개가 실패한다. 원래 DB fact.value 자체는 이 export에 없고 `_facts.values`도 이미 투영된 값이다. C·적용 요약·새 블록·답에서 확인한 동작과 정확 문자열 투영의 불일치를 구분하며, 점수나 gold는 고치지 않았다.

운영 소스는 p_yes를 SQL 인자로 넘기지만 이 함수 안에서 문턱으로 거르지 않는다. 이 사례에서 0.15보다 높은 최소 점수 문턱을 적용하면 봉인 약속 기대에 맞는 이 후보도 제거된다. 이 한 사례는 문턱 도입의 손실 가능성을 보여 주며, 신뢰도 보정이나 최적 문턱·전체 성능을 측정한 결과는 아니다. “기록만 유지” 결정은 계약 소유자의 판단으로 구분한다.

## n10 — 첫 C의 미출력과 후속 미측정

양쪽 C1의 원문은 `{"promises":[],"episode":null,"measured":true}`다. ran=true, why=null, episode=false다. 해당 runtime은 `j.episode`가 있을 때만 episode 저장 분기로 들어간다(`:205`). 따라서 **이 두 호출에서는 모델이 episode를 내지 않아 episode INSERT 경로에 들어가지 않은 것**까지 분리할 수 있다. r3에서 남겼던 “모델 미출력 vs INSERT 실패”의 불확실성을 r4의 이 두 호출에서는 좁힌 것이다. 모델이 왜 생략했는지는 입증하지 못했다.

S6 summary는 `{"1":"pass"}`이며 두뇌 이력에는 “종이 모형 맞추기 완료.”/“종이 배 접기 완료.”라는 assistant fixture 하나가 있다. **assistant 원천 키가 하나라는 관측을 전체 C 입력이 한 턴뿐이라는 주장으로 바꾸지 않는다.** 사람 발언도 gather 입력에 들어가며 실제 C 요청 전체는 저장되지 않았다.

k2·k3는 `advance_time_unsupported`가 누적되어 raw의 invalid_observation에 기록된다. 두 캡처에도 과거 C1 summary는 남아 있지만 C 호출 수는 계속 1이다. 정확한 표현은 **추가 C 호출과 유효한 후속 탐침이 없다**는 것이다. “C 관측이 전혀 없다”거나 null의 원인까지 밝혀졌다고 하지 않는다. 시간 경과 뒤 회상·만료·후속 저장 성능은 계속 미측정이다.

## n14 — 내림 0은 확인됐고 정확한 CE 구간은 없음

`t_receipts.jsonl:189`에서 signage chat 턴3의 T 성공·SUPERSEDE(preference)·ce_turn3·ev_turn3·downgraded0·applied1을 확인했다. `ltm_op_dump.jsonl:61`의 op715는 fact444를 fact445로 대체했다. why는 “기본색을 남색에서 연두색으로 바꾸자고 분명히 말함”이라고 하면서 기억 요청과 값 변경을 정정으로 해석한다. 봉인 사람 원문은 “앞으로도 기억해 줘. 우리 가게 간판의 기본색는 연두색야.”다.

기존 M5와 소유자가 확인한 해석에 따르면 이 SUPERSEDE는 명시 정정만 허용하는 기준에 어긋난다. r3에서 미보존이었던 **내림 수0과 CE 원천 턴3은 r4에서 직접 확인**할 수 있다. 턴5는 별도 영수증191행의 CONFIRM 및 원장62행 op716으로 확인됐다.

그러나 ops_detail에는 CE의 t/start/end/n이 없다. 원장 ev_start12/ev_end31은 일반 evidence 구간이지 correction_evidence 구간이 아니다. 원천 턴3을 찾아도 “값 자체”와 “기억해 줘” 중 정확히 무엇을 CE로 냈는지는 알 수 없다. why에서 “앞으로도 기억해 줘”를 언급했다는 사실도 그 문자열이 실제 CE였다는 증거는 아니다. 후속에는 합성 실행 전용 응답/검증된 구간과 입력 해시의 연결 자료가 필요하다.

## 재현과 보존

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r4-2026-11-18/runtime_cases.py --output runtime/long-memory-research/reviews/m3-v02-r4-2026-11-18/runtime_cases.recheck.json
```

출력은 새 파일에만 쓴다. 입력마다 Git ref·경로·SHA256을 JSON에 기록했다. 예측 유무와 probe 사건은 사례 JSON에 함께 보존하되 전체 점수·관측 분모 판정은 별도 재채점 감사에 맡긴다. 이 문서는 실제 배포·DB 상태·완전한 C 요청 추적의 인증이 아니다.
