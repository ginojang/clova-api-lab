# M3 v0.2 제출 관측 독립 재채점 — 2026-11-17

대상은 `GanpanAI@9ad23dde4a4164f6da0a83f4854d58b42036905b:elda-orchestrator/measurements/eldacore/m3v02_20261117/`의 합성 실행 자료다. 봉인된 eval-v1 scorer·base·gold·plan·CONTRACT의 바이트 해시를 manifest와 대조한 뒤, 커밋의 predictions를 메모리에서 읽어 오프라인으로 다시 채점했다. **기존 report.json과 재계산 결과는 JSON 전체가 정확히 동일하다.**

재현 코드 [score_audit.py](score_audit.py), 독립 집계·실패 상세 [score_audit.json](score_audit.json), 재계산 전체 결과 [score_audit.report.json](score_audit.report.json). 출력은 exclusive 생성이며 기존 산출물을 덮어쓰지 않는다. API·모델·관문·DB 호출, 운영 어댑터 실행, 실제 고객 로그·키·raw 요청 파일 열람은 하지 않았다.

재실행은 `score_audit.py --output-dir <이 저장소 안의 빈 폴더>`로 한다. 소스 Git 객체가 이미 있어야 하며 원격 fetch나 어댑터 실행은 포함하지 않는다. 별도 임시 폴더에서 다시 실행해 보존한 두 JSON과 바이트 일치도 확인했다. 원자료 요청 해시까지 읽는 별도의 [무결성 감사](provenance_audit.json)는 재채점과 구분한다.

| 바이트 | SHA-256 |
|---|---|
| 실제 predictions.jsonl | `dcddfd86ab753a5a0cbd308582adf2af68d0739a46d989dfaf1f3bf4c2862eaf` |
| 제출 report.json | `fea71698624ebea393a488fa74f90b3c2a0ec97ff044de32be08e7d8aaa35c49` |
| 봉인 gold.jsonl | `4e3ce36771df80cefc338e0df751b5ab080df74971609c08e5f748807274e717` |
| 봉인 scorer.py | `a221c9fbe726a329ea033ff01f615ab70d11ccfbfd5c072eabbc0d03e46439e5` |

run_id는 `m3v02-orch-20261117-e7a5cd9c`다. 84탐침 중 고유 예측 77개가 있으며 중복·미지 ID·혼합 run 오류 없이 봉인 입력 검사를 통과했다. 아래 분모들은 서로 다른 단위다. 84탐침은 28이야기·14기제에 묶여 있으므로 독립 표본으로 가정하지 않는다.

| 검사 단위 | 계획 | 통과 | 실패 | unknown |
|---|---:|---:|---:|---:|
| 전체 구조 검사 | 470 | 348 | 63 | 59 |
| 그중 안전 관문 | 280 | 204 | 27 | 49 |
| 그중 비관문 구조 검사 | 190 | 144 | 36 | 10 |
| 의미 판정 | 84 | 0 | 0 | 84 |
| 탐침 전체 상태 | 84 | 0 | 24 | 60 |

마지막 행의 unknown은 target status `incomplete` 60개를 뜻한다. 의미 판정 미제공 77개와 예측 누락 7개로 의미 판정 84개가 모두 unknown이다. 따라서 구조 관문 통과를 답변 의미 품질이나 모델 전체 합격으로 읽을 수 없다. 전체 status는 fail이며 CLI 계약상 exit 1에 해당한다.

예측이 없는 7개 ID:

- `n10-guest-q3`, `n10-signage-q3`
- `n11-signage-q2`
- `n13-guest-q2`, `n13-guest-q3`, `n13-signage-q2`, `n13-signage-q3`

이 7개가 구조 검사 unknown 41개를 만든다(관문 31·비관문 10). 예측이 있는 77개에서도 unknown 18개가 남는다: 관측 경로 누락 8개(프로세스 종료·resume 4, returning episode 4), 실제 tokenizer 계수 부재 7개, 렌더/기록 item ID 부족 3개다. 정확 토큰 상한 관문은 전체 8개가 unknown이며 이 중 나머지 1개는 예측 자체가 없다. 제출된 토큰 측정 77개는 모두 estimate다.

관문 실패 27개는 `source_binding` 10, `forbidden_value` 8, `withdrawal` 2, `contest` 2, `restart_recovery` 2, `phase_boundary` 2, `replacement_policy` 1이다. 비관문 실패 36개는 `state_accuracy` 22, `recall` 14다. 이는 **제출 관측과 gold의 불일치 분류**이며 런타임 오류와 어댑터 투영 오류를 독립적으로 확정한 분류가 아니다.

| 이야기 범위 | 전체 구조 실패 | 그중 관문 실패 |
|---|---:|---:|
| n02-guest | 6 | 3 |
| n03 두 영역 | 6 | 6 |
| n05-signage | 3 | 0 |
| n08 두 영역 | 6 | 2 |
| n09 두 영역 | 14 | 6 |
| n10 두 영역 | 4 | 0 |
| n12 두 영역 | 14 | 6 |
| n14 두 영역 | 10 | 4 |
| 합계 | 63 | 27 |

제출 README의 실패표는 관문 27개와 동일 분모의 표가 아니다. 특히 **n12는 표의 10개가 아니라 전체 구조 실패 14개**다. 구성은 recall 4·state_accuracy 4·restart_recovery 2·phase_boundary 2·source_binding 2이며, 앞 세 metric만 합하면 10이 된다. README의 n08 q3와 n09 값 투영 관련 실패는 구조 검사상 정확히 12개다. 원인별 분류는 담당자의 원천 자료와 실행 계약 감사에 따로 결합해야 한다.

contract/challenge도 유지된다. challenge 2탐침의 구조 검사 12개는 6통과·6실패, 관문 4개는 2통과·2실패다. contract 82탐침의 구조 검사 458개는 342통과·57실패·59unknown, 관문 276개는 202통과·25실패·49unknown이다. **n12 family 전체가 challenge는 아니다**. q3의 후속 계약 검사 실패도 있으므로 n12 전체 실패를 도전 과제로 제외하면 안 된다.

history 노출 진단은 전체 84 중 적용 대상 22·비대상 62다. 적용 대상에서 4개는 노출 없음, 7개는 노출, 11개는 `watch_projection_incomplete`로 unknown이다. 관측된 감시 값 13 target/value쌍 중 노출 7쌍이며 strict_zero_status는 fail이다. 이는 H92/P24 정책 관문과 다른 진단으로, 대체 표지가 있다고 노출 수를 지우지 않는다.

`capture_complete` 77/77, `forget_full_input` 4/4 등은 **제출된 관측 투영**에 대한 계산 결과다. 이번 감사는 ref/hash의 원격 진실성, 전체 입력 캡처의 완전성, 어댑터와 실제 CLI의 동등성, 프로세스 종료·물리 삭제를 인증하지 않았다. 특히 forget_process 4개와 scope_isolation 12개 중 10개는 unknown이다. 재채점 일치와 실행 계약 충족 여부는 별도 결론으로 보존한다.

`stale_write` 8/8 역시 검사 8개의 결과이며 독립적인 지연 작업 8회 실행을 뜻하지 않는다. 이미 완료한 작업의 결과 재사용, 실제 release 횟수, 재시작·시간 전진·선행 준비의 수행 여부는 실행 이벤트와 어댑터 계약 감사에서 별도로 확인해야 한다.
