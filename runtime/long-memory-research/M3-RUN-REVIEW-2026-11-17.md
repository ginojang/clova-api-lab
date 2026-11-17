# M3 v0.2 첫 실행 — 재채점·관측 계약 감사

2026-11-17 · 클로버 · 수신 `a826b05e3a`. **제출 점수는 정확히 재현된다. 다만 이번 실행은 어댑터 대역의 부분 측정이며, 실패를 모두 런타임 결함으로 분류하거나 통과를 실제 CLI 전체 검증으로 해석할 수 없다.** 원점수·gold·예측 파일은 보존한다. 원인 분석의 우선순위는 T 완료 동기화와 지원하지 못한 제어의 관측 처리다.

검토 대상은 `ginojang/GanpanAI@9ad23dde4a4164f6da0a83f4854d58b42036905b:elda-orchestrator/measurements/eldacore/m3v02_20261117/`이다. run_id는 `m3v02-orch-20261117-e7a5cd9c`, 보고된 runtime은 `e7a5cd9c89f2c6d22eb72ff30be5a99b846eacc1`이다. 이 문서의 어댑터 줄 번호는 같은 저장소의 `elda-orchestrator/src/tools/m3v02Run.ts` 기준이다.

클로버는 커밋된 합성 자료·코드를 읽고 **오프라인 재채점 및 파일 무결성 검증만** 수행했다. 모델·관문·DB·운영 서비스 호출, 외부 어댑터 실행은 0회다. 실제 고객 자료 혼입 여부가 불명확한 `dev_server.log.gz`는 열지 않았다. 시험 손님 36명 삭제 완료는 담당 보고이며 이 감사에서 독립 확인하지 않았다.

## 재현 결과와 분모

봉인 scorer/base/gold/plan/CONTRACT 해시를 대조한 뒤 재계산한 report는 제출 report와 **JSON 전체 및 바이트가 동일**하다. 상세 실패 목록과 단위별 계수는 [재채점 감사](reviews/m3-v02-run-2026-11-17/score_audit.md), [집계 JSON](reviews/m3-v02-run-2026-11-17/score_audit.json)에 있다.

| 단위 | 계획 | 통과 | 실패 | unknown |
|---|---:|---:|---:|---:|
| 전체 구조 검사 | 470 | 348 | 63 | 59 |
| 그중 관문 검사 | 280 | 204 | 27 | 49 |
| 그중 비관문 구조 검사 | 190 | 144 | 36 | 10 |
| 의미 판정 | 84 | 0 | 0 | 84 |

전체 status는 fail이다. 탐침 상태는 fail 24·incomplete 60이며 의미 판정을 제공하지 않아 완전히 통과한 탐침은 없다. 84탐침은 28이야기의 연속 체크포인트이므로 독립 표본 84개가 아니다.

예측 누락 7개는 `n10-guest-q3`, `n10-signage-q3`, `n11-signage-q2`, `n13-guest-q2/q3`, `n13-signage-q2/q3`다. 앞 세 개는 before 실패, 뒤 네 개는 범위 충돌로 생략됐다. 구조 unknown 59개는 예측 누락 41·실제 tokenizer 부재 7·관측 경로 부재 8·item ID 부재 3이다. 정확한 토큰 상한은 총 8개 모두 unknown이고(예측 없는 1개 포함), 측정된 토큰 수는 근사값이다.

**제출 README 정정:** n12의 구조 실패는 10개가 아니라 **14개**, 그중 관문 실패는 6개다. challenge는 n12의 q2 두 탐침이며, n12 전체를 challenge로 제외하면 q3 계약 검사를 빠뜨린다. n08 q3·n09 값 투영 관련 구조 실패는 정확히 12개다. 이 수치들은 원인별 결함 건수나 독립 장애 수가 아니다.

history 진단은 적용 대상 22 중 노출 없음 4·노출 7·감시값 투영 부족 11 unknown이다. 관측된 감시 target/value 13쌍 중 7쌍이 history에 남아 strict_zero_status는 fail이다. 대체 머리 준수와 과거 문자열의 물리적 노출은 다른 항목이다.

## 파일·매핑 근거 확인

[무결성 검사 코드](reviews/m3-v02-run-2026-11-17/provenance_audit.py)와 [결과](reviews/m3-v02-run-2026-11-17/provenance_audit.json)를 추가했다.

- 관측 77개 각각의 raw·request 파일 SHA-256 일치 **77/77**, raw의 request·answer·run ID와 예측의 대응도 **77/77**이다. 원자료 154파일이 모두 참조되며 누락된 참조 파일은 없다.
- 봉인 unblind 도구로 blind_predictions를 복원한 결과가 제출 predictions와 정확히 일치한다. 답·판정·해시를 사후 바꾼 차이는 없다.
- 실행 ref와 결과 ref의 어댑터 SHA-256은 모두 metadata의 `938d1c824e577225006709f51e797a4f7198cfd671f5f3d7c8d1fa6baf2b4291`과 일치한다. 네 프롬프트의 소스 해시도 기록된 접두와 일치한다. dist 해시와 실제 실행 바이너리의 대응은 독립 재빌드/검증하지 않았다.
- `bundle_head_sha`는 묶음 파일 manifest가 아니라 Git 커밋 문자열의 SHA다. 이번 감사는 별도로 봉인 파일 해시를 확인했다.
- scope 매핑은 합성 34개→실제 30개이며, 세 합성 범위씩 같은 실제 키에 겹치는 두 묶음이 있다. 충돌한 탐침은 실제로 unknown이다. product/persona가 모두 ganpan/elda이므로 두 domain을 두 실제 제품·페르소나 비교로 해석하지 않는다.

파일 무결성은 관측 정의의 정확성과 다르다. `capture_complete=77/77`은 대역이 구성한 모델 메시지 캡처의 근거이며 실제 Elda CLI 프로세스의 입력·종료·재개 검증이 아니다. S6는 합성 판정이고 PERSONA_JUDGE=off이므로 실제 판정기의 성능 측정도 아니다.

## T 정정·철회·확정: 완료 대기가 먼저 해결돼야 한다

어댑터 :178~182와 :290~294는 같은 cid의 T 완료 로그 개수를 기다린다. 직전 probe도 after 훅으로 비동기 T를 시작하지만 :377 이후 그 T가 끝나는 것을 기다리지 않는다. 따라서 **직전 probe의 완료가 현재 사건의 settle을 대신 만족할 수 있다.** 완료 판정에 source_event_id/chat turn이 결합돼 있지 않다.

`run_events.jsonl:27~28,47~48,332~333`의 해당 turn→settle 간격은 3ms·5ms·18ms다. 이 간격만으로 경합을 확정하지 않지만, 아래 상태 변화와 함께 보면 프롬프트가 아예 연산을 내지 않았다는 단정은 지지되지 않는다.

| 사례 | q2 current_values → q3 current_values | q3 누적 연산의 추가분 |
|---|---|---|
| n02-guest | 보리차 → 유자차 | SUPERSEDE |
| n03-signage | 연두색 → 빈 배열 | WITHDRAW |
| n03-guest | 유자차 → 빈 배열 | WITHDRAW |
| n14-signage | 남색 → 연두색 | SUPERSEDE |
| n14-guest | 보리차 → 유자차 | SUPERSEDE |

위 raw의 principal_values도 같은 변화를 보인다. 원자료 파일 쌍(q2/q3)은 각각 `1f5958ae0ac19601c725/57917cc1551118c7c84e`, `d59f8a6e143c4f3ae284/a9035eb736689aa2799c`, `6aeb3412d004a81f4420/0c5a8b1e45c47d16d942`, `a47baf27ca91d3c8602a/bd55e5fa836519a8cf61`, `9e867f3f1f3ddbe4218c/074b8b974ca3c2cfa018`이며 측정 폴더의 `raw/blind-target-<ID>.json`이다.

**q2 시점 미반영은 관측 사실**이다. 그러나 그 원인을 T 미출력·프롬프트 실패·저장 실패·동기화 경합 중 하나로 확정할 자료는 부족하다. n14 needs_confirm=false도 그대로 기록하되 같은 완료 경계 아래에서 해석한다. 현재 보고만 보고 프롬프트를 먼저 고치면 측정기의 경합을 모델 문제로 보정할 수 있다. 해당 원천 턴의 T call/op/drop 완료를 기다리고, timeout이면 해당 관측을 unknown으로 남긴 뒤 별도 run으로 확인해야 한다.

## 제어와 성공·실패 주장의 범위

| 항목 | 확인한 실행 | 판정 범위 |
|---|---|---|
| stale_write 8/8 | 실제 C release 4회는 epoch 0→1, epoch_stale, 쓰기0. 나머지 q3 4회는 already_finished라 이전 false를 재사용 | 4개 지연 작업의 거절 근거. 독립적인 재시도 거절 8회가 아님 |
| queue 장벽 | 6개 모두 after_epoch_and_source_read_before_model로 대체 | 요청된 after_source_read_before_epoch·during_model_before_commit·before_commit·timer_pending_before_start를 각각 검증하지 않음 |
| n12 복구 | C 지연시간7일, 시계 전진 미지원, queue는 이미 시작된 작업, restart에서 어댑터가 job.lost=true, q3 release는 lost로 생략 | 계획한 20분 뒤 복구 조건을 만들지 못함. 이번 실패를 런타임 복구 결함으로 분류할 수 없음 |
| forget 전체 입력 4/4 | 새 cid의 대역 입력에 옛값 없음 | 실제 CLI 종료·resume 차단 4검사는 unknown. 어댑터 자체 hist의 옛 cid도 지우지 않으므로 전체 history 삭제 증거가 아님 |
| pause 6/6 | pause/resume 제어와 상태·주입 관측 | 그 상태 검사 결과는 보존. retry_turn은 같은 전송 ID 재사용이 아니라 새 턴이며, C 재시도도 실행 안 함 |
| n11-signage q3 | q2에서 방해항목1개 처리 뒤 두 번째 before 실패. 나머지23개·trim 미실행인데 q3 진행 | q3 캡처는 있어도 계획한 문맥 부하 시험은 미완료. 선행 준비 실패를 후속 유효성에 전파해야 함 |

이벤트 근거: 실제 release는 `run_events.jsonl:76,91,108,122`, already_finished는 `:81,96,111,125`, n12 lost는 `:284,298`, 프로세스 미측정은 `:56,65`, n11 선행 실패/계속은 `:213~217`이다. 어댑터 :330·396~398은 이전 C 결과 재사용, :347은 lost 표시, :367은 시간 제어 미지원, :415는 체크포인트 실패 후 계속을 보여 준다.

runtime의 `s6chatEnd.ts:238~249`에서 catchup은 마지막 턴이 C 지연시간보다 오래돼야 한다. 이번에 막 만든 대화는 7일 설정에서 대상이 될 수 없다. LTM_CATCHUP_HOURS가 기본24라면 시간창 자체도 비지만, 실제 값은 run_meta에 없어 이 추가 주장은 조건부다. 미지원 제어·다른 장벽·준비 실패를 봉인 gold 변경으로 숨기지 않고 **실행 조건 미충족**으로 별도 표시해야 한다. 원점수에서 임의로 실패를 빼거나 새 합계로 덮어쓰지는 않았다.

## 값 투영·원천 결합·C 결과

어댑터 :99~111의 어휘 수집은 입력 문장에서 값을 잘라 얻는다. 「X 완료」에서 X만, 「다음 방문에 X할게」에서 X만 남겨 gold가 요구한 값과 표현 단위가 달라진다. 그 결과 n08 q3·n09의 12개 구조 불일치는 런타임 누락과 동일시하면 안 된다. 예측을 정답을 보고 재작성하지 않고 원래 자료를 보존한 결정은 타당하다. 다음 판의 투영 규칙은 입력/관측 계약으로 고정하고 새 run_id로 재측정한다.

`source_bound`는 :399에서 false로 시작하며 :403~407에서 owner/persona 범위의 **어떤 applied promise**에 ti 판정이 모두 pass이면 true가 된다. 계약이 요구한 해당 원천 응답 hash·판정 ID·episode 항목 연결을 확인하지 않는다. n08 q2의 보류 약속도 원천 연결은 검사할 수 있어야 하며, 적용되지 않았다는 이유만으로 결합 실패는 아니다. **n09 false 6개는 did별 출처 결함의 직접 측정이 아니다.** did별 실제 S6 검사가 런타임 소스에 없다는 기존 정적 지적과 구분한다.

n10 두 영역 q2는 C 요약 ran=true·episode=false·dropped=[]이므로 episode 생성 없음 자체는 관측됐다. 다만 episode_kind_out 기록이 없으므로 did 다섯 종류 필터가 실제 원인이었다는 설명은 아직 확인되지 않는다. 업무 범위/합성 문장 적합성, C 원출력과 적용 결정을 추가로 결합해야 한다. 해당 raw는 `47a8a9fe92918970d81b`와 `612bbe271e74bde19db9`다.

n05-signage q3의 새 값 미반영과 dropped_why CHECK 위반, ea96b60c 로그 보강 및 DBA enum 요청은 담당 보고로 유지한다. 이번 감사에서는 실제 T 원출력·DB 제약 실패 로그를 독립 열람하지 않았으므로 구체적 거부 원인을 확정하지 않는다.

또 :232의 rendered_item_ids는 캡처의 ID를 직접 읽기보다 profile 값이 fresh 문자열에 들어 있는지로 추정하고, :389는 최신 S4 한 줄을 조회한다. 값이 같은 여러 항목·episode ID·정확한 request↔S4 결합까지 증명하는 관측인지 별도 확인이 필요하다. 계산상 load_trace 통과를 전체 원장 추적 검증으로 확대하지 않는다.

## 다음 실행에 필요한 작업

1. **오케 어댑터:** T settle을 source_event_id→실제 turn/call/op 완료와 결합한다. 직전 probe의 T와 구분하고 실패/timeout을 빈 상태나 성공으로 대체하지 않는다.
2. **오케 어댑터:** 장벽별 지원 여부, 실제 시계·복구 조건, 동일 job 재시도/전송 재시도를 구현하거나 미지원으로 표시한다. 선행 준비 실패는 그에 의존한 후속 체크포인트까지 표시한다.
3. **오케·리소너:** 값 투영 단위와 source_bound를 계약대로 구현한다. 보류 약속도 출처를 확인하고, episode별 원천 hash·판정 ID를 보존한다. 그 뒤 T/C 모델과 저장 단계의 원인을 나눈다.
4. **오케 실행 담당:** 충돌 없는 범위 매핑과 실제 CLI 과정이 필요한 탐침을 별도 준비한다. 정확 tokenizer, 의미 판정, 종료/resume 증거가 없는 항목은 unknown을 유지한다.
5. **보고 정정:** n12 실패14/관문6, 실제 stale release4회, T 원인 미분리, n09 source_bound 정의 차를 기록한다. 원본 점수는 보존하고 수정 어댑터 ref/hash·설정·새 run_id를 실행 전에 고정한다. gold는 그대로이며 관측을 정답에 맞춰 사후 수정하지 않는다.

## 오프라인 감사 재현

Git 대상 객체가 이 저장소에 이미 있어야 한다. 아래 도구는 외부 호출을 하지 않는다. score_audit의 출력 폴더는 미리 만든 빈 폴더를 지정하며 기존 파일은 덮어쓰지 않는다.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-run-2026-11-17/score_audit.py --output-dir <이-저장소-안의-빈-폴더>
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-run-2026-11-17/provenance_audit.py
```

새 임시 폴더에서 재채점 도구를 다시 실행해 보존한 두 JSON과 바이트 일치를 확인하고 임시 폴더를 정리했다. 무결성 도구도 정상 종료했다. 봉인 평가 코드 변경이 없어 기존 110개 도구 테스트를 라이브 검증으로 다시 계산하지 않았다.

## 리소너 후속 정정 — e84740afe2

02:25 UTC 리소너는 `38c64f4560`에서 기울였던 「1~3은 프롬프트 쪽」이라는 원인 추정을 철회했다. 현재 후보는 다른 연산의 적용·settle/관측 시점·CONTEST 투영이며 어느 하나도 확정하지 않는다. T v0.009·C v0.004는 별도 평가 자료의 K=3 결과로 채택 여부를 판단하고 **M3 결함 수정 실적으로 세지 않겠다**고 명시했다. 이는 담당자의 계획/정정 보고이며 새 판 채택·K=3 완료나 M3 재실행 결과가 아니다.

리소너가 전달한 서버 로그에서는 T applied가 q2 probe보다 1~2초 앞섰다고 한다. 서버 로그는 직접 열지 않았다. 어댑터의 실제 순서는 :376의 DB observe → :377의 모델 호출/응답·after 훅 → 후처리 → :413의 probe 로그다. 따라서 **DB 관측 완료 < T 적용 < probe 로그**가 가능하다. probe 로그 시각이 T보다 늦다는 사실만으로 관측 시점 경합을 배제할 수 없다. observe(:188~200)도 여러 SELECT를 순차 실행하므로 공통 snapshot이 보장된다고 가정하지 않는다.

현재 코드의 :209는 적용된 연산을 이름 제한 없이 출력하므로 **CONTEST 자체를 이름으로 제외하지는 않는다**. 반면 :206 needs_confirm은 fact 원래 flag를 직접 쓰지 않고 profile state가 needs_confirm인 항목의 존재로 계산한다. :189에서 fact의 flag를 읽기는 하지만 해당 출력에 사용하지 않는다. CONTEST/needs_confirm을 아직 지원하지 않는다고 단정하기보다 대상 fact의 flag·profile state·op와 각 읽기 시점을 함께 보존해야 한다.

리소너의 삭제 전 시험 op 덤프 요청과 턴별 채점 계획을 [T/C 결합 관측 보완](M3-OPERATION-JOIN-2026-11-16.md#v02-첫-실행-후속--호출-완료와-관측-snapshot)으로 구체화했다. **호출을 유발한 턴과 근거 ev_turn_index는 별개**이며, 최종 덤프만으로 과거 q2 시점 상태를 소급 복원하지 않는다. 대상은 이번 합성 시험 손님의 실행 자료이고, 시나리오의 forget/정리 동작을 바꾸는 제안이 아니다.

원본 첫 실행 점수·raw·gold는 그대로다. 새 프롬프트와 새 평가 묶음은 ref/hash·자료 계보를 따로 기록한다. `38c64f4560`에 보고된 8자 문자열 비중복은 의미상 독립성이나 새 확인 자료임을 증명하지 않으며, 이미 본 M3 진단과 별도 K=3 지표를 합산하지 않는다.
