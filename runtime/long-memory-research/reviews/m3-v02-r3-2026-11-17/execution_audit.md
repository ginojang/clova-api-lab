# M3 v0.2 r3 — 어댑터·T 영수증 정적 감사

확인일: 2026-11-17. 고정 Git 객체와 합성 측정자료만 읽었다. 모델·API·DB·실행기 호출, 운영 로그 및 `dev_server.log.gz` 열람은 하지 않았다. 재현 스크립트는 Git의 JSON/소스를 읽어 산술·대조만 수행한다.

## 판과 직접 확인 결과

- 결과 자료: `GanpanAI@ec3c9b262a14ffe07958b09f77d8b6e2b3de2481`, `elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/`.
- `run_meta.json`의 runtime: `a315c32c008694e52b0fcfc11651ae986340a7ad`. 어댑터 변경 커밋은 `41df84e975c390b6255f7100479164f55bc0f1d8`이다. 서로 다른 역할의 커밋이다.
- 세 ref의 `elda-orchestrator/src/tools/m3v02Run.ts` 바이트는 동일하며 SHA-256은 모두 `bad63dde37cec957dbf11566f71e2f5d73273c92ee5448a37695cd6e3982287f`다. 실행 메타데이터의 `adapter_sha256`과도 같다. `41df84e9`는 커밋 앞자리, `bad63dde…`는 파일 해시다.
- runtime으로 기록된 ref의 `s6memory.ts`, `s6chatEnd.ts`, `router/v1_0/chat.ts`와 결과 tree의 해당 소스도 diff가 없다. 이는 소스 일치 확인이다. 기록된 `dist_sha256`의 빌드 귀속·실행 바이너리를 독립 재현한 것은 아니다.
- 시작은 `2026-11-17T04:39:19.687Z`, 마지막 `done`은 `04:57:07.851Z`다. 실행 중 외부 DB/블록 변경 여부는 이 영수증 감사만으로 판별하지 않는다.

| 확인 항목 | 직접 재계수 |
|---|---:|
| 전달 영수증 / 서로 다른 cid | 200 / 48 |
| `match=turn_index` / `nth_agrees=true` | 200 / 200 |
| 전달 `chat_turn`와 선택된 T `turn_index` 일치 | 200/200 |
| 선택된 `(cid, chat_turn)` 중복 / `turn_id` 중복 | 0 / 0 |
| 선택된 T 결과 `ok=true` / `ok=false` | **196 / 4** |
| `fixture=true` / false | 20 / 180 |
| 명시적 `settle` 성공 / 실패 | 94 / 0 |
| `ok=false` T에도 성공한 settle | **4** |
| 발행 probe / invalid probe / skipped probe | 68 / 12 / 4 |

`run_events`의 전달 사건 200개(일반 turn 106, 단독 assistant fixture 10, retry 4, 발행 probe 68, invalid probe 12)와 영수증의 event ID 다중집합이 정확히 같다. cid별 전달 번호는 연속이고 선택된 T 완료 시각도 순서대로다. 모든 선택된 영수증은 전달 시각 이후이며, 명시적 settle 94개는 연결된 영수증 시각 이후에 끝났다. 현재 자료에서는 예전 n번째 연결과 새 키 연결 사이 차이가 관측되지 않는다.

## 해결된 연결과 남은 관측 경계

`m3v02Run.ts:121–124,149,179`는 전달 전후 `max(turn_index)` 증가를 확인해 전달 턴 번호를 정한다. `:194–201`은 그 `cid+turn_index` 영수증을 기다리고, 턴 번호를 얻지 못했을 때만 총개수로 대체한다. `:453–457`의 내보내기도 키를 먼저 선택하며 번호가 없을 때만 n번째를 쓴다. 이번 200건에는 그 fallback이 없다.

runtime `s6memory.ts:180`은 T 호출의 `turn_index/turn_id`를 기록한다. 호출부 `chat.ts:1443,1491–1502`는 `recordTurn` 결과와 현재 턴 번호를 넘긴다. 따라서 선택된 T 완료를 호출을 유발한 chat 턴에 연결하는 근거가 생겼다. 그러나 전달 측 `turn_id`는 별도로 보존하지 않고 증가한 최대 턴 번호로 연결한다. 각 연산의 과거 evidence 원천·개별 재시도 attempt까지 같은 키로 증명하지 않는다.

영수증 파일은 원시 T 호출 전부의 원장이 아니다. `:455`는 같은 키의 **첫** 로그를 선택하고 전달 목록을 기준으로 200행을 만든다. 선택 결과에 중복이 없다는 사실로 실제 호출의 추가·중복 시도까지 0이라고 결론내리지 않는다. 특히 끝에 생긴 추가 같은-key 로그는 이 파일에서 빠질 수 있다. `s6memory.ts:182`의 바깥 예외는 `memory_turn.serve_failed`이며 턴 키도 없다. 해당 실패 로그와 전체 호출 수는 금지된 서버 로그를 읽지 않아 별도 전수 확인하지 않았다.

## T 실패 4건을 settle 성공과 분리

네 건 모두 `n11-guest` 체크포인트 2의 방해 기억 준비 턴이며, cid는 `m3-3a8850-c93f85f0e54e`다.

| chat_turn / turn_id | 입력의 합성 표식 | T 완료 UTC | 직후 settle UTC |
|---|---|---|---|
| 12 / 8767 | 합성표식-10 | 04:52:32.278 | 04:52:32.610 |
| 21 / 8789 | 합성표식-19 | 04:53:12.030 | 04:53:12.459 |
| 22 / 8790 | 합성표식-20 | 04:53:19.167 | 04:53:19.557 |
| 24 / 8792 | 합성표식-22 | 04:53:32.688 | 04:53:32.924 |

네 영수증은 `ok=false`이고 `ops/applied/held/dropped` 모두 0이다. `waitT`는 성공 여부를 검사하지 않고 영수증의 존재만 확인하므로 네 settle은 모두 `ok=true`다. 따라서 **200건 연결 완료는 확인되지만 T 200회 성공·준비 실패 0은 성립하지 않는다.** 반대로 `ok=true`도 각 저장 연산의 적용 성공을 뜻하지 않는다. 거름·보류는 별도 필드다.

runtime logger는 `reason`을 남기지만 `:457`의 export는 그 필드를 제외한다. 네 건의 실패 원인은 이번 합성 영수증으로 복원할 수 없다. 이번에는 실패 완료를 기다린 것이므로 이 네 건을 T 미완료 경쟁으로 설명할 수도 없다.

`n11-guest` q2·q3는 예측이 발행됐고 raw의 `invalid_observation=null`, `notes=[]`다. 두 snapshot의 `_facts`는 각각 2행(q1은 1행)이다. 방해 문장 24개 투입이 24개 기억 저장 또는 실제 예산 압력 성립을 뜻하지 않는다. 이 가족은 준비 조건의 성립 범위를 별도 보고해야 한다. 실제 모델 실패를 평가에 포함할지, 운영 준비 실패로 제외할지는 평가 정책 문제이며 이번 정적 감사는 점수·분모를 임의 변경하지 않는다.

## 메타데이터와 실행 범위

- `run_meta.settle` 및 소스 `:287`은 여전히 `expected T lines = turns delivered to cid`다. `:117`의 47/48은 이전 측정 설명이고 `:125,449`의 n번째 연결 설명도 남았다. 실제 r3 구현·관측은 키 우선이다. 메타데이터 문구를 구현 설명과 함께 읽어야 한다.
- 마감 대기는 `:447–448`에서 여전히 cid별 **총개수**를 사용한다. 이번 파일은 200건 전부 키로 연결됐으므로 선택 결과의 누락은 없지만 일반적인 키별 종료 보장을 구현한 것은 아니다.
- `retry_turn`의 `:388`은 `waitT` 반환값을 사용하지 않고, 일반 `settle_turn`은 false일 때만 taint한다. 실패 완료·timeout 전파가 모든 경로에서 같은 뜻은 아니다. 이번 `run_events`에는 settle timeout, checkpoint_failed, after_non200이 기록되지 않았다.
- CLI가 아닌 before→Haiku→after 대역, late judge off, C 지연 7일, 실제 시계 미진행, 원래 요청과 다른 단일 C barrier, product/persona 축 합침, source_bound 미제공 등 실행 제한은 키 연결 보완만으로 해소되지 않는다. 실서빙 전체 및 CLI 프로세스 보장을 주장하지 않는다.

재현: `PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/reviews/m3-v02-r3-2026-11-17/execution_audit.py`.
산술 결과와 읽은 각 파일의 SHA-256은 [execution_audit.json](execution_audit.json), 읽기 범위는 [execution_audit.py](execution_audit.py)에 있다.
