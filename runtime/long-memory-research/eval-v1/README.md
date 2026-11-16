# M3 v0.2 — T 직접 저장·전체 문맥 보완 평가

14기제 × 2용도 × 3체크포인트 = **84탐침**. 같은 대화를 이어 가는 체크포인트와 새 대화를 구분한다. 사전등록 `c839d3036992a98dec5a951d73a5820035c088a2` 뒤 생성한 한국어 합성 pretest다. 실제 손님 자료·모델 호출은 없고 학습에 사용하지 않는다. 봉인 [v0.1](../eval-v0/README.md)은 변경하지 않는다. 새 판은 전체 회귀를 대체하거나 구판 점수와 합산하는 용도가 아니다.

오케스트레이터가 실제 실행·관측, 리소너가 T/C 원천 결합을 맡는다. 이 저장소는 데이터·눈가림·채점·무결성 검사를 제공하며 DB/관문 실행기는 제공하지 않는다. 운영 어댑터가 없는 동작은 unknown으로 남긴다.

```bash
cd runtime/long-memory-research/eval-v1
PYTHONDONTWRITEBYTECODE=1 python3 bundle.py verify
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s . -p 'test_*.py'
python3 bundle.py export-checkpoint --story n01-signage --checkpoint 1 --output /시험폴더/input.json
python3 bundle.py unblind-observations --input /시험폴더/blind_predictions.jsonl --output /시험폴더/predictions.jsonl
python3 scorer.py --gold gold.jsonl --predictions /시험폴더/predictions.jsonl --output /시험폴더/report.json
```

출력 파일은 미리 존재하면 거절한다. CLI 점수 exit 0은 제공된 관측의 정책 검사 통과일 뿐 배포 승인·물리 삭제 증명이 아니다. exit 1은 실패/미완료, 2는 입력 오류다. 모의 관측을 실제 모델 결과로 제출하지 않는다.

## 파일과 실행 연결

- plan/CONTRACT: 생성 전에 고정한 규격·범위·제어 이벤트.
- scenarios/gold: 실행 입력과 기대값을 분리한다. 입력에는 실제로 실행할 합성 원문·제어·현재 질문만 있다.
- blind: 조건명 없이 불투명한 story/checkpoint/event/job/conversation/target ID. 문장 내용상 조건을 추측할 수 있으므로 완전 눈가림이라고 주장하지 않는다.
- private/blind_map: 실행 담당자만 보유. export는 현재 체크포인트 하나를 눈가림 ID로 내보내며 미래 내용을 넣지 않는다.
- scorer: v0.1 exact 엔진을 동일 바이트 `_base_scorer.py`로 고정하고 실제 문맥 캡처·history 진단을 추가한다.
- manifest: 데이터·코드·테스트·문서 해시. registration은 DB 등록 초안으로만 제공한다.

실제 run마다 tested runtime/prompt/model/adapter/tokenizer/fixture 매핑 ref와 hash를 원자료에 기록한다. scope 세 칸, 원천 turn/답 해시/판정 ID, C job/attempt/시작 epoch/커밋 epoch, request/process ID로 연결한다. debug 화면의 시각 근접 연결을 원천 증거로 대신하지 않는다. 동일 작업의 재시도와 새 정상 작업을 구분한다.

probe.query는 해당 체크포인트에서 검사할 실제 요청이다. 앞의 events는 그 요청 전에 순서대로 실행하며, probe를 또 다른 준비 턴으로 중복 실행하지 않는다. returning 첫 턴 탐침 앞에는 같은 cid의 사람 준비 턴을 넣지 않는다. `queue_c`는 실제 구현의 지정 barrier에서 작업을 관찰·보류하는 제어다. 평가기가 올바른 p_epoch를 대신 주입해 구현 결함을 가리지 않는다. 시작 시점 관측값과 구현이 실제 제출한 세대 모두 원자료로 남긴다.

unblind는 top-level `id`, `transport` 안의 `story_id`, `checkpoint_id`, `conversation_id`, `source_event_id(s)`, `job_id`, 그리고 `artifacts.episode_sources`의 합성 event 키만 복원한다. 실제 DB item ID·답·판정·해시·capture_ref는 바꾸지 않는다. 기타 legacy metadata를 자동 복원한다고 가정하지 않는다. 실제 런타임 ID는 별도 매핑 증거로 보존한다.

## 관측과 점수 해석

`context.capture_complete=true` 및 capture ref/hash와 행 evidence가 있어야 문맥 검사에 참여한다. S4 기록만으로 실제 모델 요청 캡처를 대신하지 않는다. fresh/history/effective_active/all_input 값을 구분한다. fresh가 비어도 changed-only의 과거 블록을 사용한 정상 회상은 가능하다. forget 뒤 전체 입력의 지운 값은 원문 사람 턴까지 포함해 검사한다.

`load_projection_matches`는 렌더와 원장의 item ID 집합으로 채점기가 계산한다. episode도 ID를 포함해야 한다. 수기로 true를 적어도 효과가 없다. `fresh_tokens`는 `token_method=actual|actual_tokenizer|tokenizer:<식별자>`일 때만 정확한 상한 검사에 사용한다. `estimate[:방법]`는 보고서 진단에 남지만 정확한 600토큰 관문을 통과시키지 않는다. 600은 현재 상시 블록(첫 턴 episode 포함)의 상한이며 누적 history 전체의 상한이 아니다.

추가 관측 `auto_episode_values`는 **이번 호출에서 자동 선택한** episode 값 배열, `relation_prior_count`는 현재 cid를 제외한 과거 대화 수다. returning 둘째 턴의 새 자동 선택과 첫 턴 블록의 history 잔존을 구분한다. `history_watch_values`의 기대 목록은 gold에만 두고, 관측 목록은 실제 전이 원자료에서 만든다. gold로 관측 빈칸을 채우지 않는다.

보고서의 `history_exposure.strict_zero_status`는 H92/P24 대체 정책 성공과 별개다. 대체 머리로 무효화한 값도 과거 블록에 남아 있으면 노출 수에 포함한다. 노출을 숨기지 않으면서 과거 발화의 존재를 곧 현재값 오판으로 간주하지도 않는다. forget 이후에는 이전 프로세스 종료·resume 금지·전체 입력의 옛값 부재가 필수다. 근거 누락을 빈 배열이나 false로 채워 통과시키지 않는다.

재시작 뒤 C 자동 복구는 challenge로 나눠 분모를 보존한다. C 실행 안 됨과 C 실행 결과 빈 출력은 다르다. 생략된 recall 대상은 여전히 양성 분모에 남는다. 관문·정책·외부 의미 판정·문맥 coverage·과거 노출·contract/challenge 결과를 함께 읽는다. 전체 물리 삭제 및 다른 저장 자리 완료 여부는 별도 소유자 증거가 필요하다.
