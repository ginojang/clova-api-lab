# M3 오프라인 평가 계약 v0.1

이 계약·plan.json을 데이터 생성 전에 커밋한다. 합성 32이야기 × 3세션 × 세션 끝 탐침 1개 = 96탐침이다. 16갈래 × 2용도이며 서로 독립인 96표본으로 해석하지 않는다. 실제 모델/API/DB 실행기는 포함하지 않는다.

## 입력과 정답

- `scenarios.jsonl`: `{id, family, domain, scope:{product,principal_id,persona_id}, sessions:[{id,at,events:[...],probe:{id,query,scope}}]}`. ID는 합성 `m01-signage` 등, 탐침은 이야기 ID+`-q1`~`-q3`.
- 이벤트: `{id,kind:"turn"|"control",...}`. turn은 `speaker:"human"|"assistant"|"notification"`, `text`, `origin`, 선택 `s6`; control은 `action`, `params`. 세션 종료/비동기 작업 완료/시간 진행 등은 control로 명시한다. `scope`를 이벤트에 덮어쓸 수 있다. 제어 이벤트는 평가 실행기의 동작이며 사람 말로 시스템에 넣지 않는다.
- `gold.jsonl`: `{id,scenario_id,family,domain,positive:bool,answer_rubric:string,checks:[{id,metric,gate:bool,path,operator,value}]}`. ID별 2개 이상의 구조 검사. 자연어 정답·판정 기준은 gold에만 둔다. `positive`는 유효 기억을 실제로 회상해야 하는 탐침이다.
- `path`는 관측 행의 `/artifacts/...` JSON Pointer(중첩 dict, 배열 인덱스 지원). 연산은 `eq`, `contains`, `excludes`, `set_eq`, `lte` 다섯 개. contains/excludes는 **배열의 정확한 JSON 값 포함 여부**만 검사한다. 자유 문장 의미·부분 문자열 검사가 아니다. 타입은 엄격히 구분한다(bool ≠ int). set_eq는 중복을 허용하지 않는다. lte는 유한 숫자끼리만, bool 금지.
- `artifacts` 관측 칸 예: `current_values`, `retrieved_values`, `injected_values`(배열, 전부 정규화된 합성 값), `ops`(관측한 연산명 배열), `command`(문자열/null), `needs_confirm`(bool), `block_tokens`(정수), `late_commit_accepted`(bool), `memory_epoch`(정수), `episode_values`(배열). 기대값은 어댑터에 주지 않는다. 원자료의 item ID→값·출처 연결 근거를 함께 보존한다. 값 정규화의 의미 판단이 필요하면 별도 판정이며 exact 검사로 속이지 않는다.

## 관측·판정

`predictions.jsonl` 한 줄:

```json
{"id":"m01-signage-q1","run_id":"owner-run-001","answer":"실제 응답 원문","artifacts":{},"evidence":{"source_ref":"repo@commit:path#record","source_sha256":"64자리 원자료 해시"},"judgment":{"verdict":"pass|fail|unknown","answer_sha256":"응답 UTF-8 SHA256","judge_id":"실제 판정자","judge_version":"고정 프롬프트/모델 판","rationale":"판정 근거"}}
```

- `judgment`와 `evidence` 누락은 unknown. 외부 평가자는 H97에 따른 소넷/오퍼스 또는 명시된 검수자이며, 채점기가 호출하지 않는다. 판정자 신원·답 해시가 없거나 불일치하면 semantic pass 금지. 원자료 ref/hash는 출처 표지이며 채점기 자체가 원격 내용을 검증했다는 뜻이 아니다.
- 관측 JSON 중복 키·잘못된 JSON·NaN/Infinity·중복/알 수 없는 ID·둘 이상의 run_id·필드 타입 오류는 입력 오류(exit 2). 누락 탐침은 분모에 남겨 unknown. 비어 있는 파일도 전부 unknown으로 계산한다.
- 구조 검사에 필요한 path나 원자료 evidence가 없으면 unknown. 관측 실패는 fail. 안전 관문은 어떤 fail이라도 fail, fail 없이 unknown이 있으면 incomplete, 둘 다 없고 분모>0일 때만 pass.
- 각 metric에 planned/passed/failed/unknown을 내고 target 커버리지와 외부 의미 판정 점수를 따로 낸다. `passed/planned`와 `passed/(passed+failed)`를 함께 표시하되 분모0은 null. 전체 pass는 모든 구조 검사·의미 판정·커버리지가 완전 통과한 경우만. 배포 승인 지표가 아니다.
- `--allow-incomplete` 없음. CLI 종료값: 0 완전 통과, 1 실패/미완료, 2 입력/묶음 오류. 출력을 쓰는 경우 기존 파일 덮어쓰기 금지. 입력 파일을 고치지 않는다.

## 눈가림·등록·무결성

`blind/scenarios.jsonl`은 불투명 이야기·탐침 ID와 실행에 필요한 이력만 둔다(family/domain/기대값/라벨 없음). `blind/annotation_template.jsonl`은 빈 판정 칸만, 정답·기존 AI 판단·조건명 없음. `private/blind_map.json`은 평가자에게 전달하지 않는다. 입력 맥락에서 시험 의미를 완전히 숨길 수는 없으므로 완전 눈가림이라고 주장하지 않는다.

`manifest.json`은 입력·정답·눈가림·코드·계약·계획 파일의 SHA256, 사전등록 커밋을 담는다(자기 자신은 제외). `registration.json`은 eval_set 등록 초안으로 DB use=eval, note에 pretest와 학습 금지를 적는다. `authored_by=other_llm`, 실제 손님 글 없음. n_items=96, n_pos는 같은 탐침 단위로 계산한다.

해시·96개 ID·32×3 형태·연대순·참조·범위·입력/정답 분리·눈가림 매핑을 로컬에서 검사한다. 모의 완전 관측은 채점기 시험용으로만 생성하며 모델 성능으로 발표하지 않는다. 지원되지 않는 실행 동작·삭제 증거는 unknown으로 남긴다.
