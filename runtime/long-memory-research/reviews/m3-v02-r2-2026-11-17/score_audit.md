# M3 v0.2 r2 제출 관측 독립 재채점 — 2026-11-17

대상은 `GanpanAI@89e0930274396589d16069a050b2a58be532f807:elda-orchestrator/measurements/eldacore/m3v02_20261117_r2/`의 합성 predictions/report다. 봉인 eval-v1의 scorer·base·gold·plan·CONTRACT 해시를 확인한 뒤 오프라인 재채점했다. **제출 report와 재계산 JSON 전체가 일치한다.** API·모델·관문·DB 호출, 외부 어댑터 실행, 실제 고객·서버 로그와 키 열람은 하지 않았다.

기존 [감사 코드](../m3-v02-run-2026-11-17/score_audit.py)를 재사용한다. `--source-commit`·`--source-prefix`를 추가했고 기본값은 r1 그대로다. `--output-dir`는 이미 있는 출력 폴더를 받으며 기존 산출물은 덮어쓰지 않는다. r1을 저장소 내부 TemporaryDirectory에서 재현해 기존 `score_audit.json`과 `score_audit.report.json` 모두 **바이트 동일**함을 확인했고 임시 파일은 정리했다. r1의 두 산출물은 수정하지 않았다. 이 옵션 추가는 봉인 채점기 변경이 아니다.

```text
--source-commit 89e0930274396589d16069a050b2a58be532f807
--source-prefix elda-orchestrator/measurements/eldacore/m3v02_20261117_r2
--output-dir runtime/long-memory-research/reviews/m3-v02-r2-2026-11-17
```

독립 집계와 검사별 실패는 [score_audit.json](score_audit.json), 전체 재채점 결과는 [score_audit.report.json](score_audit.report.json)에 있다. run_id는 `m3v02-orch-20261117-1eb72970`다.

| 원자료 바이트 | SHA-256 |
|---|---|
| 실제 r2 predictions.jsonl | `65c3ca1cda17a2e057b418d7e36b53326d7a12d0b80f9ec6f7af46c012e33da2` |
| 제출 r2 report.json | `42578d45641bebdb004062bafaca9ad9c28d1bc2cf29cd333a838fc04ff634c6` |
| 봉인 gold.jsonl | `4e3ce36771df80cefc338e0df751b5ab080df74971609c08e5f748807274e717` |
| 봉인 scorer.py | `a221c9fbe726a329ea033ff01f615ab70d11ccfbfd5c072eabbc0d03e46439e5` |

계획은 두 실행 모두 84탐침·28이야기·14기제·양성68이며 독립 탐침 84개로 가정하지 않는다. r2에는 고유 예측 68개가 있다. r1은 77개다. r2 전체 target 상태는 fail 14·incomplete 70·pass 0이며, 전체 status는 fail이다.

| 단위 | 계획 | r1 통과/실패/unknown | r2 통과/실패/unknown |
|---|---:|---:|---:|
| 전체 구조 검사 | 470 | 348 / 63 / 59 | 324 / 18 / 128 |
| 안전 관문 | 280 | 204 / 27 / 49 | 184 / 4 / 92 |
| 비관문 구조 검사 | 190 | 144 / 36 / 10 | 140 / 14 / 36 |
| 의미 판정 | 84 | 0 / 0 / 84 | 0 / 0 / 84 |

의미 판정 unknown은 예측 68개의 판정 근거 미제공과 예측 누락 16개로 구성된다. 구조 검사 통과로 의미 판정을 대신하지 않는다.

예측이 없는 16개 ID는 다음과 같다.

- `n05-guest-q3`, `n05-signage-q3`
- `n06-guest-q3`, `n06-signage-q3`
- `n10-guest-q2`, `n10-guest-q3`, `n10-signage-q2`, `n10-signage-q3`
- `n12-guest-q2`, `n12-guest-q3`, `n12-signage-q2`, `n12-signage-q3`
- `n13-guest-q2`, `n13-guest-q3`, `n13-signage-q2`, `n13-signage-q3`

r1 대비 새로 예측이 없어진 대상은 n05 q3·n06 q3·n10 q2·n12 q2/q3의 두 영역, 총 10개다. 반대로 `n11-signage-q2` 1개는 r2에서 관측됐다. 공통 관측 대상은 67개다. 누락 원인의 운영적 설명은 실행 계약 감사 영역이며 이 집계에서는 누락을 그대로 유지한다.

구조 unknown 128개는 예측 누락 104, 관측 경로 누락 16, 실제 tokenizer 계수 부재 6, item ID 부족 2다. 관문 unknown 92개는 같은 항목이 각각 68·16·6·2다. 관측 경로 누락 16개는 source_binding 10·forget_process 4·returning_episode 2다. 나머지 source_binding 2개는 예측 자체가 없어 **source_binding 전체 12개가 unknown**이다. 토큰 계수는 제출된 68개 모두 estimate이므로 정확한 600토큰 관문 8개는 6개 계수 부재·2개 예측 누락으로 모두 unknown이다.

관문 실패 4개는 n03 두 영역 q2의 withdrawal 2와 n14 두 영역 q2의 contest 2다. 비관문 실패 14개는 state_accuracy 10·recall 4다. 구체적으로 n08 두 영역 4, n09 두 영역 8, n10 두 영역 2의 구조 실패이며, 실제 런타임 오류와 투영 불일치의 원인 분류를 이 숫자만으로 확정하지 않는다.

**27→4는 23개 해결을 뜻하지 않는다.** 같은 gold check ID끼리 연결한 기존 관문 실패 27개의 이동은 다음과 같다.

| r1 실패 항목 | r2 통과 | r2 실패 | r2 unknown |
|---|---:|---:|---:|
| forbidden_value | 8 | 0 | 0 |
| replacement_policy | 1 | 0 | 0 |
| withdrawal | 0 | 2 | 0 |
| contest | 0 | 2 | 0 |
| source_binding | 0 | 0 | 10 |
| restart_recovery | 0 | 0 | 2 |
| phase_boundary | 0 | 0 | 2 |
| 합계 | 9 | 4 | 14 |

전체 관문 280개의 상태 이동은 pass→pass 172, pass→unknown 32, fail→pass 9, fail→fail 4, fail→unknown 14, unknown→pass 3, unknown→unknown 46이다. 전체 구조 검사 470개에서는 각각 301·47·18·18·27·5·54다. r1과 r2 모두 예측이 있는 67탐침만 비교해도 관문 209개는 174/21/14에서 182/4/23으로 바뀐다. 이 공통 집합은 84탐침 전체와 분리해서 읽어야 하며, 런타임 성능 개선의 인과 효과로 간주하지 않는다.

challenge 2탐침은 r2에서 모두 예측이 없어 구조 검사 12·관문 4가 전부 unknown이다. contract 82탐침의 구조 검사 458개는 324/18/116, 관문 276개는 184/4/88이다. 재시작 항목을 unknown으로 정정한 것을 재시작 복구 성공으로 세지 않는다.

history의 **15/21은 값-탐침쌍**이며 사람 수나 탐침 21개가 아니다. 전체 84 중 관련 탐침 22·비대상 62는 두 실행 모두 같다.

| history 진단 단위 | r1 | r2 |
|---|---:|---:|
| 노출 없는 관련 탐침 | 4 | 4 |
| 노출 있는 관련 탐침 | 7 | 12 |
| unknown 관련 탐침 | 11 | 6 |
| 관측된 감시 값-탐침쌍 | 13 | 21 |
| 그중 노출 값-탐침쌍 | 7 | 15 |

r2 unknown 6개는 watch_projection_incomplete 4·예측 누락 2다. strict_zero_status는 두 실행 모두 fail이며 정책 관문과 별개다. 관측 감시 분모가 13→21로 늘었으므로 노출 수 7→15를 순수한 런타임 악화로 단정할 수 없다. 대체 머리가 있어도 과거 블록 노출은 그대로 센다.

재채점 일치는 제출 관측의 계산 재현성이다. 완전한 입력 캡처·원천 판정 결합·실제 프로세스 종료·물리 삭제·제어 수행을 인증하지 않는다. `stale_write`의 r2 통과 4개와 r1 통과 8개는 검사 수이며 각각 독립 작업 실행 횟수와 동일하다고 가정하지 않는다. r1 산출은 보존하고, 실행 적합성과 원인 설명의 정정은 별도 증거에 결합한다.
