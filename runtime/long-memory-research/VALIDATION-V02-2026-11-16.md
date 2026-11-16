# M3 v0.2 오프라인 검증

2026-11-16 · Python 3.12.3 · 모델/API·관문·DB 호출 0. 합성 평가 도구 검증이며 실제 모델 성능 보고가 아니다.

사전등록은 `c839d3036992a98dec5a951d73a5820035c088a2`의 plan/CONTRACT다. 봉인 v0.1은 바꾸지 않았다. 최신 규격 T 직접 저장, 전체 모델 문맥, 삭제 후 재개, 지연 C 및 원천 판정 연결을 별도 v0.2로 설계했다.

| 항목 | 결과 |
|---|---|
| 데이터 | 14갈래 × 2용도 = 28이야기, 3체크포인트씩 84탐침 |
| 정답 단위 | 양성68, contract82/challenge2, 구조 검사470 |
| history 진단 | 전체84 중 전이 후 과거값 감시 대상22, 나머지62는 별도 not_applicable |
| 통합 테스트 | **110개 통과** — 채점71(기존41 포함), 데이터22, 묶음17 |
| 빈 관측 반례 | coverage unknown84, 전체 incomplete. history unknown22, strict-zero incomplete. 빈 분모 성공 없음 |
| 구판 무결성 | eval-v0 bundle verify 통과(32이야기·96탐침·양성80); 기존 파일 변경 없음 |
| 검토 | 데이터·계약·소스에 대해 독립 에이전트 정적 검토. 사람 라벨/사람 검수로 표시하지 않음 |

실행: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s runtime/long-memory-research/eval-v1 -p 'test_*.py'`. 시험 임시 파일은 이 저장소 안에서 만들고 정리했다.

핵심 회귀는 실제 입력 캡처 없는 S4 기록의 false pass, 전체 입력의 다른 손님 값·삭제 값, 수기 loaded 일치 주장, 근사 토큰의 정확 상한 대체, 과거값 감시 목록 누락, 미래 입력/정답 누설·눈가림 매핑, 제어 대상 누락·fixture 시계 역행, 출력 덮어쓰기를 포함한다. 모의 pass/fail 데이터는 채점기 시험에서만 만들며 실제 모델 예측 파일로 배포하지 않는다.

봉인 전 의미 검토에서 현재 대화 episode의 재주입 강제를 제거하고, returning 첫 질문 전에 인사 턴이 끼지 않도록 고쳤다. T/C 전에 끝나야 하는 입력의 시간도 맞췄다. 삭제 후 새 자기주장은 허용하며 옛 작업·원문·episode 복원과 구분한다. n01 재시도는 값 유지 검사이지 중복 적용 횟수 전체의 idempotency 증명이 아니다.

완료 범위는 합성 데이터·gold·눈가림·채점·무결성·export/unblind·등록 초안이다. 어댑터의 실제 원천/입력 캡처 정확성, 모델 응답, serve-gate 배포·열쇠 연결·프로세스 종료, 전체 물리 삭제는 미측정이다. episode did별 S6·큰 NOTIFY·append 경쟁 등 감사 후속은 [연결 검토](M4-SERVING-INTEGRATION-2026-11-16.md)에 별도로 남긴다.
