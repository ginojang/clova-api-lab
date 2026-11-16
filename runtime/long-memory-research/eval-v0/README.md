# M3 손님 장기 기억 평가 v0.1

합성 한국어 **32이야기·96세션·96탐침**, 16기제 × 간판/손님 응대 페르소나 2용도다. `use=pretest`, 평가 전용이며 학습 금지다. AI 작성(`other_llm`)이고 사람 정답 검수가 완료된 홀드아웃이 아니다. 세계 시뮬레이션 NPC 상태는 다루지 않는다.

사전등록 커밋은 `66c7b4ed7924df7e866a8ad3bfc7dfcffa043925`이며 [계획](plan.json)의 SHA256은 `4bd537d16a51abd43ed66b7456699b84f1c3046af08add353a14a25cd1d1380d`다. 데이터·코드는 그 뒤 작성했다. [계약](CONTRACT.md)은 판정 입력과 지표를 고정한다. 실제 모델 호출·운영 평가·DB 등록은 하지 않았다.

## 파일과 실행

| 파일 | 용도 |
|---|---|
| `scenarios.jsonl` | 시간순 세션·출처·제어 이벤트·탐침. 실행기만 전체 파일을 읽는다 |
| `gold.jsonl` | ID별 구조 검사·의미 기준. 모델 입력 금지 |
| `blind/` | 조건 라벨·기대값 없는 합성 이력과 빈 라벨 칸 |
| `private/blind_map.json` | 원본↔눈가림 ID 대응. 검수자에게 주지 않는다 |
| `build_dataset.py` | 고정 자료 재생성. 이미 공개된 pretest이며 새 홀드아웃을 생성하지 않는다 |
| `bundle.py` | 구조·사전등록 해시·묶음 해시 검증, 한 세션만 추출 |
| `scorer.py` | 저장된 관측·외부 판정을 오프라인 채점 |
| `manifest.json` | 자기 자신을 제외한 최종 파일 SHA256과 사전등록 커밋 |
| `registration.json` | eval_set 등록 초안. 등록 실행과 별개 |

Python 3.10 이상 표준 라이브러리만 사용한다. 아래 명령은 저장소 루트에서 실행한다.

```bash
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/eval-v0/bundle.py verify
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s runtime/long-memory-research/eval-v0 -p 'test_*.py' -v
```

한 이야기를 1→2→3세션 순서대로 처리한다. 각 세션의 실제 ID는 `scenarios.jsonl`에서 선택한다.

```bash
python3 runtime/long-memory-research/eval-v0/bundle.py export-stage --scenario m01-signage --session 1
python3 runtime/long-memory-research/eval-v0/scorer.py --gold runtime/long-memory-research/eval-v0/gold.jsonl --predictions path/to/observations.jsonl --output path/to/new-report.json
```

`export-stage`는 현재 한 세션만 내보낸다. 출력은 **어댑터 입력**이며 JSON 전체를 모델 프롬프트에 붙이지 않는다. ID·scope·제어 이벤트는 실행기가 처리하고, 해당 시점의 사람 턴과 탐침만 모델 입력으로 보낸다. 이전 세션의 저장 상태는 실행 대상에서 유지하며 미래 세션·gold를 넣지 않는다. 시험별 namespace를 초기화하고 이야기 사이 기억을 섞지 않는다. 세션 내 `scope` 덮어쓰기도 반드시 반영한다.

채점 종료값은 `0` 완전 통과, `1` 실패 또는 미완료, `2` 입력 오류다. 출력 파일은 새로 만들며 기존 파일을 덮어쓰지 않는다. 동일 반복의 96개를 한 `run_id`로 제출하고 K회 반복은 파일·실행을 나눈다. 원자료 파일은 보존하고 보고서의 SHA256과 연결한다.

## 실행 담당자와 맞출 관측

이 묶음은 서빙 API 어댑터를 포함하지 않는다. 오케스트레이터가 실제 T/C 호출·원장·S4를 연결해야 한다. 연산별 target/evidence 채점은 리소너의 `s6_memory_turn`과 연결하고 이 묶음에서는 다세션 상태·검색·주입 결과를 함께 확인한다.

- `current_values`: 현재 탐침의 범위에서 유효한 chat+principal 값. `principal_values`는 그중 장기 저장 층만이다. 익명은 장기 읽기·쓰기 금지이며 같은 대화 안 기억까지 금지한 것이 아니다.
- `retrieved_values`: 이번 탐침에서 실제 검색한 값. `injected_values`: 실제 S4 기억 블록에 실린 값이다. 사람의 현재 발화 자체를 주입된 기억으로 잘못 세지 않는다. item ID·범위·원자료 위치를 보존해 투영을 검수한다.
- `ops`: 지정 구간에서 관측한 연산명. 이름만 맞는 것으로 target·근거·순서가 모두 맞았다고 해석하지 않는다. 실제 상태 검사와 리소너의 연산 채점을 함께 본다.
- `block_tokens`: 현재 상시 `<customer_memory>` 블록의 실제 토큰 수. 글자 수나 임의 추정치로 대체하지 말고 tokenizer 판을 실행 메타데이터에 기록한다. 상한 600은 상시 블록에 해당한다.
- `late_commit_accepted`, `resume_allowed`, `paused` 등은 제어 이벤트의 실제 결과다. 기능이 없거나 자료를 못 얻으면 관측 칸을 생략해 unknown으로 남긴다.
- `late_commit_accepted`는 캡처한 구세대 작업의 **쓰기 수락 여부**다. 작업 핸들러 호출 성공이나 무변경 NOOP 응답을 수락된 쓰기로 세지 않는다. 재개 뒤 새 세대의 정상 작업과 이전 job 재제출을 구분한다. v1.020 `93e9542`가 forget·pause 세대 변경 시 폐기를 명시했으며, 이 후속 근거는 사전등록 기준 v1.019와 따로 남긴다.
- control의 `settle_turn`은 T 완료, `end_session`/`idle_consolidation`은 명시된 C 완료까지 기다린다. `queue_job`/`complete_job`/`replay_job`은 동일 합성 후보의 지연·재시도 순서를 재현한다. API 성공 코드만 보고 기대 bool을 만들어 내지 않는다.

`evidence.source_ref/source_sha256`는 제출 관측이 어떤 원자료에서 왔는지 표시한다. 채점기는 원격 원자료를 받아 확인하지 않는다. 값 배열에서 표식이 없다는 사실만으로 바꿔 말한 누수까지 없다고 단정하지 않는다. S4 원문·항목 ID·범위까지의 투영이 올바른지 확인해야 한다.

## 의미 판정과 결과 해석

정확한 JSON 값 비교는 구조 검사다. 한국어 응답의 의미를 정규식·문자열 포함으로 합격시키지 않는다. 외부 평가자가 생성한 `judgment`를 받으며 응답 UTF-8 SHA256, 판정자·판·근거가 없으면 unknown이다. H97의 소넷/오퍼스 또는 명시된 검수자를 별도 실행 경로에서 사용한다. 이 코드가 판정자를 호출하거나 그 신원을 인증하지 않는다.

외부 판정 원장은 target ID·run ID·rubric/gold SHA256·spec 판과 함께 보존해야 한다. 현재 v0.1 채점기는 행 ID와 답 해시만 검증하므로 같은 답에 붙은 다른 조건의 판정을 재사용하지 않았는지는 원장 감사 대상이다. 의미 판정 점수는 **제출된 외부 판정 집계**이며 독립 재판정 결과가 아니다. 기억이 없어 안전하게 기권한 행동과 평가자 오류·누락 unknown을 구분한다.

관문과 회상 성공을 따로 보고한다. 기억을 전부 끄면 일부 안전 검사는 통과하더라도 정상 기억 회상 검사에서 실패한다. 실패가 하나라도 있는 관문은 fail, 실패 없이 누락이 있으면 incomplete다. 0분모의 비율은 null이다. `0/n`은 관측한 탐침 수치이며 운영 위험 확률 0을 뜻하지 않는다.

`interpretation=challenge`인 암시 회상·예산 밖 기억은 현재 prior_chat 기반 구현의 보장과 구분해 읽는다. 전체 통과는 이 묶음의 제출 관측·외부 판정에 대한 조건부 결과이며 계약 적합 인증·배포 승인이 아니다. 파일/캐시/프로세스/백업의 물리 삭제는 **미측정**으로 고정한다. 소유자가 제공하는 삭제 증거를 별도 감사해야 한다.

눈가림은 조건명·기대값·기존 판단을 숨기는 절차다. 이력 자체에서 시험 취지를 추측할 수 있고 원본이 공개된 pretest이므로 완전 눈가림·미열람 홀드아웃을 주장하지 않는다. 실제 답변이 생긴 뒤 불투명 ID에 맞춰 답 원문을 제공하고 빈 라벨 칸을 채운다. 라벨 파일을 바로 `judgment`로 취급하지 말고 답 해시·판정자·근거를 갖춘 변환 원장을 남긴다.

눈가림 ID로 실행한 관측은 `bundle.py unblind-observations --input blind-observations.jsonl --output restored-observations.jsonl`로 복원한다. target ID뿐 아니라 `episode_sources`의 event 키도 복원하고 답 원문·판정·증거 해시는 유지한다. 출력에 원래 blind ID와 입력/매핑 해시를 남기며 원본 파일을 고치지 않는다. 이 도구는 빈 라벨 양식을 판정으로 만들어 주지 않는다.

초기 작성 검토에서 T 정정 이전 chat 현재값을 명시했고, 정상 C 저장을 지연 job보다 먼저 끝내도록 고쳤다. 예산 스트레스가 특정 항목의 탈락을 보장하지 않으므로 검색 경로 사용 자체를 강제하지 않고 실제 주입·유효 저장·상한을 검사한다. 따라서 현재 묶음만으로 ‘예산 밖으로 밀려난 항목의 회수율’을 별도 측정했다고 주장하지 않는다. 의미 검토 정정은 실제 모델 결과를 보기 전에 수행했다.

등록 DDL은 `use='eval'`만 허용한다. `registration.json`은 같은 탐침 단위 `n_items=96`, `n_pos=positive 탐침 수`를 쓰고 note에 `evaluation_phase=pretest;training_forbidden=true`를 기록한다. `authored_by=other_llm`, 손님 원문 없음. 등록자가 실제 커밋·해시를 확인해 INSERT하며 이 작업은 DB에 접속하지 않는다.
