# r3 후속 코드 감사 — 실패 전파와 원출력 보존

2026-11-17 소스, 2026-11-18 로컬 재현 완료. `847c482038c80fef77b44c20d897de9adf42e711`과 `dfd7c92fdfe4cba28c6c4a95353ffd642f7db2c5`를 기존 a315c32c와 비교했다. [재현 코드](execution_followup.py)와 [소스 검사·해시](execution_followup.json)를 보존했다. TypeScript 실행·모델 호출·DB·관문·서버 로그 열람 없이 소스와 합성 자료만 검사했다.

## 확인된 보완

- 키가 있는 명시적 `settle_turn`은 `waitT`가 발견한 `ok=false`를 `settle_t_failed`로 남긴다. 이야기의 taint에 누적돼 이후 예측은 제외되며 raw 탐침 자체는 실행·보존될 수 있다.
- T 영수증 export에 `reason`, `downgraded`, `ops_detail`이 추가됐다. 이전 r3 파일은 200행 모두 새 필드가 없는 상태로 보존된다.
- C summary의 `raw`는 모델 반환 문자열이다. `sum.raw = c.raw`가 실패 반환보다 앞에 있으므로 JSON 파싱 실패도 해당 문자열이 있으면 보존된다. 이전 r3 C 요약 18건에는 raw가 없으며 소급 보충하지 않았다.

소스에 대한 12개 구조 대조가 모두 참이다. 이는 해당 조건을 가진 코드의 존재와 산출물 보존 확인이며 실제 장애 주입 시험은 아니다.

## 남은 실패 경로

`retry_turn`은 `waitT`의 반환값과 `tFailed`를 여전히 사용하지 않는다. 봉인 n01/n06 양쪽 q3의 retry 네 곳 모두 이후 별도 settle 없이 probe로 이어진다. 키 없는 count fallback도 ok=false를 확인하지 않으며 종료 대기는 개수만 본다.

따라서 이번 보완을 모든 T/재시도 실패 전파 완료로 부르지 않는다. `memory_turn.serve_failed` 바깥 예외는 정상적인 키 영수증이 아니므로 명시적 settle에서는 보통 timeout으로만 나타난다. 첫 동일 키 로그 선택·추가 attempt 누락도 별도 경계다.

T의 `ok`는 모델 처리 결과이지 DB 연산 각각의 성공 표지가 아니다. DB 적용 실패를 catch해 held를 늘리는 경로는 ok=true와 함께 존재할 수 있다. 다음 실행에서 각 경로의 실제 분모를 구분해야 한다.

## 턴 번호와 정확한 근거 구간

`ops_detail`은 후처리 res.ops의 여섯 필드 `op/slot/downgraded/downgraded_why/ce_turn/ev_turn`이다. 거름 전 후보, CE/evidence 문자열과 구간·발생 순번(n), target_id, 개별 DB 적용 결과는 없다.

`ce_turn=3`으로 합성 원천 턴을 찾는 것은 가능하지만 그중 모델이 “기억해 줘”를 냈는지, 값만 냈는지까지 복원할 수는 없다. 합성 실행 전용 요청/응답 또는 검증된 구간·입력 해시 연결이 필요하다. 일반 서빙 로그에 실제 손님 원문을 추가하라는 요청은 아니다.

## C 응답과 요청·저장 결과

수동 finish/release의 반환 summary는 c_runs와 사건 원장에 연결된다. 미해제/유실된 job이나 배경 C 전체를 자동 보존하는 구조는 아니다. transport 실패나 호출 전 종료에서는 raw가 null일 수 있다.

raw는 C의 모델 content 문자열이며 실제 요청 turns·모델에 보인 S6·today·시스템 프롬프트 및 전체 provider response가 아니다. 약속/episode 개별 INSERT 결과와 실패 사유도 기존 집계만으로 모두 복원되지 않는다. episode=true는 ON CONFLICT DO NOTHING 쿼리가 정상 종료한 경우도 포함할 수 있다.

운영 dist 반영·다음 재시작은 당시 담당 보고다. 새 r4 실측의 분모와 실제로 밟은 분기는 [r4 별도 감사](../m3-v02-r4-2026-11-18/score_audit.md)에서 구분한다. 이 소스 보완으로 r3 점수를 다시 쓰지 않았다.

재현: 저장소 루트에서 `PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r3-2026-11-17/execution_followup.py`.
