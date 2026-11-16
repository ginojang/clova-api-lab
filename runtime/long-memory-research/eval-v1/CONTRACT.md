# M3 후속 평가 계약 v0.2

봉인 v0.1을 보존하고 새 규격의 T 직접 저장과 실행기 문맥을 재는 **보완 묶음**이다. 전체 제품 회귀를 대체하지 않는다. plan과 이 계약을 데이터 생성 전에 커밋한다. 14기제 × 2용도 × 3체크포인트 = 84탐침이며 독립 표본 84개가 아니다. 체크포인트 여러 개가 같은 conversation_id를 유지할 수 있다.

## 입력과 실행 경계

`scenarios.jsonl`: `{id,family,domain,scope,checkpoints:[{id,at,conversation_id,events,probe:{id,query,scope}}]}`. 범위는 product/principal_id/persona_id 세 칸이다. 이벤트는 `{id,kind:turn|control,...}`이며 turn은 speaker(human/assistant/notification), text, origin을 갖는다. 합성 상류 S6 입력은 `s6:{verdict,source:synthetic_fixture}`로 표시한다. 실제 모델 판정인 척하지 않는다.

제어 이벤트 action은 plan의 닫힌 목록이다. settle_turn은 지정 source_event_id까지 T만 완료, finish_c는 지정 conversation_id의 C 완료 시도, queue_c는 **원천 source_event_ids·owner·작업 시작 epoch**를 캡처한 job_id를 지정 barrier에서 보류, release_c는 그 작업을 그대로 재개한다. forget/pause/resume는 승인된 시험 어댑터가 실제 제어 경로를 호출하며 단순 사람 문장으로 바꾸지 않는다. restart_worker·attempt_resume는 실행기/워커 식별 증거를 남긴다. attach_s6는 정확한 source_event_id에 합성 판정 또는 판정 관측을 연결한다. advance_time은 fixture 시계 전진, trim_context는 실제 입력 창에서 예전 원문 제거 확인, retry_turn은 실패한 전송의 동일 턴 재시도다. 지원하지 못하면 unknown이며 성공 모의 객체를 만들지 않는다. 빈 C 결과와 C 미실행을 구분한다.

입력 export는 **현재 체크포인트 하나**만 내보낸다. 이전 상태는 실행기가 실제 누적하고 미래 체크포인트·gold·기제명·평가 기준·private 매핑을 모델에 주지 않는다. 합성 scope/cid/event/job은 시험 principal 및 실제 제품 enum/FK로 일대일 매핑하고 매핑 ref/hash를 남긴다. 서로 다른 범위가 같은 실제 키로 합쳐지면 실행 오류다.

## 관측

기본 행은 v0.1과 같은 `{id,run_id,answer,artifacts,evidence,judgment}`이다. evidence는 source_ref/source_sha256, judgment는 verdict(pass/fail/unknown)/answer_sha256/judge_id/judge_version/rationale를 요구한다. 채점기는 원격 자료·판정자 신원을 인증하지 않는다. 값 배열은 합성 원문에 있는 정확한 값의 관측 투영이며 동의어·뜻을 문자열 검사로 판정하지 않는다.

`artifacts` 주요 칸:

- `principal_values`, `current_values`, `retrieved_values`, `episode_values`, `must_repeat_values`: 해당 범위의 실제 상태·선택 값. session 값은 구조화 저장을 요구하지 않는다. `ops`는 실제 applied 연산만, `dropped_reasons`는 거부 사유. `needs_confirm`, `c_completed`, `late_commit_accepted`, `resume_allowed`, `old_process_closed`, `paused`, `memory_epoch`는 관측된 상태다. `source_bound`는 cid·원천 assistant turn/응답 해시·판정 ID를 연결한 검증 결과이며 시각 인접만으로 true를 만들지 않는다.
- `context`: `capture_complete`(bool), `capture_ref`, `capture_sha256`, `fresh_values`(이번 호출에 새로 실은 기억 값), `history_memory_values`(실제 요청의 이전 기억 블록 값), `effective_active_values`(교체/철회 상태를 적용한 현재 유효 기억 값), `all_input_values`(기억 블록뿐 아니라 raw history·도구·system 등 실제 요청 전체에 등장하는 합성 값), `fresh_tokens`(실제 사용 모델 tokenizer 또는 명시한 근사 측정), `token_method`, `emitted`(bool), `replacement_header`(bool), `withdrawn_slots`(값을 제외한 갈래), `rendered_item_ids`, `recorded_item_ids`.
- 전체 문맥 capture가 없거나 false이면 위 context의 값·header·tokens·items 비교는 **unknown**이다. S4 stage_call만으로 capture_complete=true를 만들지 않는다. fresh_values=[]는 미주입을 뜻할 뿐 기존 문맥이 비었다는 뜻이 아니다. `load_projection_matches`는 원자료를 갖춘 rendered_item_ids와 recorded_item_ids의 정확한 집합 일치로 채점기가 계산하며 수기로 준 true를 쓰지 않는다. episode도 item에 포함해 비교한다. 토큰 근사와 실제 tokenizer는 report에서 구분하며 정확한 600토큰 준수 주장으로 섞지 않는다.
- `history_watch_values`: 시나리오가 실제로 철회·교체한 합성 값의 관측 추적 목록. gold가 아니라 제어/상태 전이 원자료에서 만든다. 채점기는 history_memory_values와 교집합을 세어 **history_exposure**로 별도 보고한다. 대체 머리가 있어도 값은 노출된 것으로 센다. H92/P24는 옛 블록에 대한 대체 표지를 허용하므로, 이 노출 수와 현재 유효값·최종 답 준수는 다른 결과다. 엄격한 「과거 블록까지 노출 0」은 별도 상태로 보고하며 전체 정책 통과가 이를 뜻하지 않는다. forget 이후에는 all_input_values의 옛값 부재가 필수 관문이다.

금지된 옛값이 실제 입력에 있으나 S4 기록만 깨끗한 반례를 반드시 회귀로 둔다. all_input_values 누락을 []로 보충하지 않는다. 원문 사람 말의 역사적 존재와 현재 사실 채택도 구분한다. CONTEST의 옛값 확인형은 허용하되 현재 확정값으로 채택해서는 안 된다.

## 채점·무결성

gold는 v0.1의 exact JSON Pointer checks(eq/contains/excludes/set_eq/lte)·외부 의미 rubric 구조를 유지한다. 타입 엄격, 중복 JSON 키/ID·미지 ID·혼합 run·비유한 숫자는 입력 오류. missing은 전체 분모에 unknown. 판정 응답 해시 불일치는 unknown. 안전 관문·회상·의미·coverage·history_exposure·contract/challenge를 별도로 낸다. restart 복구 기대는 challenge로 표시하고 일반 계약 성공과 섞어 승격하지 않는다. 순수 문자열로 의미를 판정하지 않는다.

눈가림 ID·source/job/cid 매핑은 일대일이고 반환 관측의 선언된 ID 필드만 복원한다(응답·판정·해시는 보존). 입력과 정답을 분리한다. manifest는 데이터·코드·계약·계획·눈가림·테스트 해시와 사전등록 커밋을 고정한다. 등록은 `use=eval`, `pretest;training_forbidden=true`, authored_by=other_llm 초안일 뿐 DB에는 쓰지 않는다. 파일 출력은 기존 파일을 덮어쓰지 않는다. 로컬 모의 완전 관측은 채점기 시험이며 실제 모델 성능 결과가 아니다.
