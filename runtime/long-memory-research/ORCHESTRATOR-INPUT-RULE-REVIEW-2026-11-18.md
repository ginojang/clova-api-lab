# 오케스트레이터 입력 규칙 제거 후속 감사

2026-11-18 · 클로버 · 수신 Comms `84bf43db7b`(03:02 UTC).

**최신: 25b7bd5f에서 앞서 지적한 기억 callback·조사/값 규칙과 coverage 꼬리 절단의 소스 삭제를 확인했다.** 다만 삭제된 느슨 계측을 계속 0으로 전달해 회수 분류가 정상 관측처럼 보이는 문제가 남는다. 설계 철회·코드 삭제는 확인했으나 실제 재시작·S6 대체 연결·모델 의미 품질은 검증하지 않았다.

최초 `7d0aa049` 감사에서는 일곱 항목의 삭제/서빙 호출 단절과 세 모델 대체를 확인하면서 위 두 잔존 경로를 지적했다. 아래 원감사는 그 고정 소스의 기록이며, 후속 판정은 바로 다음 절을 따른다.

## 03:14~03:16 UTC 후속 — 설계 철회와 실제 소스 삭제

리소너 `64c97fee82`와 오케 `92184c0966`를 읽고 두 커밋을 직접 대조했다. 운영 배포·재시작 대기는 오케의 보고이며 직접 서비스에 접근하지 않았다.

| 대상 | 고정 근거 | 판정 |
|---|---|---|
| 리소너 설계 철회 | elda-resoner `7fbabd427105aee0774f4f2d4758db5ec3f04a12` | `memory/REFERENT_DESIGN_v0.md:3` 철회문과 빈 줄만 추가(+2/−0). 이전 본문 보존. 계약 v0.010·코드·프롬프트·평가는 부모 273ce57과 동일 |
| 오케 기억 조립 | GanpanAI `25b7bd5f6432e5887ca381cfbefedc6ea4e5abb4` | callback 구현/import/call 및 조사·받침·크기/예산/월 규칙 삭제. 새 callback 행을 추가하던 길 제거. callbackGate 도구도 삭제 |
| coverage 느슨 대조 | 같은 25b7bd5f | `looseHit` 함수·호출 삭제. 과거 꼬리 절단 지적은 소스 범위에서 마감 |
| S6 대체·운영 | 이번 두 커밋의 범위 밖 | 설계의 “T·C가 맡는다”를 새 대체 배선·동등한 항목 회수·운영 반영 증거로 사용하지 않음 |

오케 변경은 7d0aa049 이후 **4파일·10줄 추가/214줄 삭제**다. [설계 철회 검증](reviews/input-policy-2026-11-18/design_withdrawal_followup.json), [coverage 후속 검증](reviews/input-policy-2026-11-18/coverage_followup.json), [기억 조립 재감사](reviews/input-policy-2026-11-18/memory_removal_followup.md)에 근거를 남긴다. 설계 주인이 예전 동치 유지를 잔존 사유로 삼던 근거도 철회했으므로 이를 현재 구현 예외로 계속 인용하지 않는다.

### 남은 관측 문제 — 삭제한 계측의 0이 정상 분류로 흐른다

`coverage.ts:136–148`의 loose 배열은 더 이상 채워지지 않지만 `looseN=0`을 반환한다. 변경되지 않은 `chat.ts:1683`은 답이 있으면 그 값을 `retrievalCase`에 넘긴다. 엔티티가 1개 이상이고 RAG 결과와 답이 있으면, `coverage.ts:198–203`은 이를 `labeled` 또는 `labeled_no_asset`로 분류한다. 이 호출 경로에서 `partial_no_net`은 더 이상 나올 수 없다. `chat.coverage` 및 serving log에도 `unlabeled_loose:0`이 남는다.

이는 실제 상류 미검출이 줄었다는 측정 결과가 아니다. **폐기한 계측을 null/명시적인 미측정으로 전달하고 소비처도 맞추는 후속**이 필요하다. null을 다시 0으로 접거나 엄격 일치 수로 조용히 대체하면 과거 분모와 의미가 달라진다. 엔티티 0개일 때의 `saved_by_embed/none_found`처럼 느슨 계측에 의존하지 않는 분류와도 구분한다. 모델/API 없이 고정 코드의 상수·분기를 추적한 결론이다.

### 기억 번호의 남은 정규화·과거 검증 기준

`referent.ts:27–43`은 조사/값 규칙을 제거했지만 NFC·양끝 공백·따옴표/구두점 정리 후 공백을 합친다. 따라서 “구간 그대로, 공백만”이라는 새 주석은 실제 동작보다 좁다. 모델이 짚은 표면 사이의 정규화된 번호 매핑으로 기술해야 하며, 원문 글자 그대로의 인용 검증과 혼동하지 않는다. 이 정규화의 존재만으로 삭제된 의미 규칙이 복구됐다고 판단하지도 않는다.

`tools/assembleGate.ts:144–151`은 callback 복원 수 `recovered>0`을 GREEN 조건으로 유지하고, `tools/refGate.ts:122–136`은 조사·크기·예산·월 변형이 같은 번호라는 기대를 유지한다. 이는 새 구현과 **정적인 기대값 불일치**이며 시험을 실행해 얻은 실패 보고가 아니다. 철회된 정책의 옛 동치 게이트를 현재 정책 검증과 분리해야 한다. GREEN을 맞추려고 금지된 규칙을 복구하거나 과거 결과를 새 성적으로 다시 쓰지 않는다.

`memoryReplay.ts:298–314`는 과거 구간을 새 `assign/variants`로 재구성한다. 저장된 번호와 불일치하면 경고를 남기고 `ok:true`를 반환하는 기존 동작이 있다(`:269–275`). 따라서 번호 매핑 정책 변경이 과거 합성 이력의 재구성에 미치는 영향은 담당자의 별도 검증 대상이다. 실제 운영 불일치나 데이터 손상을 확인한 것은 아니며, 이 감사에서 과거 DB를 읽거나 고치지 않았다.

### 남긴 엄격 일치와 자산 배포의 경계

엄격 계측은 인텐터 구간 밖의 **길이 3 이상 고객 어절**이 생성 답에 그대로 포함되는지 센다(`coverage.ts:123–148`). 현재 확인한 소비처는 답 뒤 후보 계측/기록이다. 조사 제거·새 기억 행 생성과 같다고 보지 않으며, 이 수가 현재 답·갈래를 제어하는 경로는 확인되지 않았다. 다만 자체 닫힌 목록 대조가 아니라 고객 어절과 답의 문자 겹침이고, 모델이 제시한 인용의 원문 존재 검증과도 다르다. 후보 계측이라는 범위를 넘어 의미 일치·엔티티 누락·회수 성공을 보증하거나 H70f의 모든 허용 조건을 충족한다고 인증하지 않는다. 기존 `candidate_list_not_verdict` 한계와 짧은 어절 제외 조건을 유지해 해석해야 한다.

오케의 “로컬 판정 자산으로 배포돼 원격 등록 불요”는 **직접 판정 경로라면 맞다**. `JUDGE_DOOR_URL`이 비어 있으면 로컬 프롬프트 본문을 모델에 보내며 별도 원격 자산 등록이 필요 없다. 반대로 door 분기는 `{ask,text,cid?}`만 보내 로컬 파일 배포가 원격 프롬프트에 자동 반영되지 않는다. 실제 사용 경로·PROMPT_DIR·적재 상태는 확인하지 않았다. `judge.ts`·`promptAsset.ts`·`chat.ts`는 이번 커밋에서 불변이다. 원격 등록을 무조건 요구하지 않고 **선택된 경로의 자산 준비에 관한 담당 보고와 직접 확인의 범위**를 구분한다. needs_map unknown/no/off 관측과 wants_image 호출 설명 정합은 오케가 후속으로 수락했으며 아직 소스 변경은 없다.

## 고정 근거와 검사 범위

- 저장소: `ginojang/GanpanAI`, 범위 `elda-orchestrator/src`.
- 기준: `55f4e2534683e561561c8ae52c3ec61493a526f7`.
- 대상: `7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d`.
- 누적 **8개 커밋·19파일·102줄 추가/331줄 삭제**. 마지막 커밋만 보면 앞선 일곱 단계가 빠진다.
- 방법: 이 연구 저장소에 확보한 고정 Git 객체의 diff·파일·호출자·소비처 대조. 조사 대상 서비스를 실행하지 않았다.
- [커밋·파일 해시 명세](reviews/input-policy-2026-11-18/orchestrator_source_audit.json), [삭제/잔존 상세](reviews/input-policy-2026-11-18/removal_review.md), [모델 대체 상세](reviews/input-policy-2026-11-18/judge_replacement_review.md).

후속 보고의 “운영 배포·재시작 대기”는 담당자 보고다. 실행 프로세스·환경변수·dist·원격 판정기 등록을 직접 확인하지 않았다. 커밋 메시지의 시험 8/8도 담당자 보고이며 새 모델 의미 품질의 근거로 합산하지 않는다. API·관문·DB·운영 서비스·고객 로그 접근은 0회다.

## 제거·대체 확인

| 범위 | 고정 소스에서 확인한 결과 | 완료로 넓히지 않은 부분 |
|---|---|---|
| 고유명 글자 문, 가격 질문 regex, 접속/조사 꼴 신호, 글자 기반 언어 감지, 조직 속성 사전 | 구현 또는 해당 분기 삭제 | coverage 전체 규칙 제거, 실제 언어 품질·운영 적재 |
| 판정 입력 군말 제거, 정체 질문 지름길 | judge/chat의 import·호출 단절 | 옛 함수·도구·죽은 분기의 물리 삭제 |
| 지도 없는 연락처 보호 | `needs_map` 모델 헤드 우선, 불명이면 공통 judge | 최종 unsure는 보호 블록을 선택하지 않음. 모델 no와 같은 뜻이 아님 |
| 그림·제안서 요청 | `wants_image`, `wants_proposal` 공통 judge와 프롬프트 자산 연결 | 원격 판정기 등록, 모델 정확도·기권률·비용·지연 |
| 집중·자기 대상·카테고리 | 인텐터 출력 span과 자체 이름/머리말 목록 대조로 변경 | 아래의 목록 매핑을 CE 출처 검사나 의미 정확성 증명으로 부르지 않음 |
| GID 정정 보호 | 전체 질문 검색에서 리소너가 지정한 가게 구간과 자체 GID 이름 대조로 변경 | 다른 기억 조립 규칙까지 제거됐다는 증거는 아님 |

세 모델 대체 경로에서 고객 낱말·정규식으로 되돌아가는 fallback은 발견하지 않았다. `wants_image`의 unknown/예외는 text 정책이며 `why=judge:unknown`을 남긴다. `wants_proposal`은 yes만 진행한다. `needs_map` 불명은 unsure로 남기지만 상위 `no_map_guard` bool만으로 no/off/unknown을 구분할 수 없다.

## 7d0aa049에서 발견한 핵심 1 — 기억 조립이 새 의미 항목을 만든다

대상 커밋의 연결은 다음과 같다. 파일은 모두 `elda-orchestrator/` 아래다.

`src/router/v1_0/chat.ts:1723,1776` → `src/core/memoryTurn.ts:180–198` → `src/core/assemble.ts:97,106,109,121,131` → `src/core/referent.ts:25–108,125–137,190–211`.

- `variants/stripJosa`는 조사 목록·한글 받침 규칙과 크기/예산/월 정규화를 사용해 같은 대상/값 번호를 정한다. 모델이 뽑은 구간이 입력이어도, 인용이 원문에 있는지만 확인하는 H70f 출처 검사보다 넓다.
- `callback`은 **고객 전체 질문**을 최대 4어절 창으로 훑고 기존 값의 변형 집합과 맞춘다. 읽기 모델이 내지 않은 칸에 `situation`, `polarity:'+'`, `by:'callback'`을 만든다. `assemble.ts:158–162`에서 이 항목이 쓰기 rows에 추가된다.
- `MEMORY_READ_ENABLED=off`는 빈 items를 만들 뿐 이 callback 호출을 우회하지 않는다. `REFERENT_MODE=off`는 별도 조응 모델/적용 경로만 제어한다. `chat.ts:1723`까지 도달한 인간 입력(`nonHuman=false`)에서 턴·주체와 선행 조회가 성립하면 조립은 쓰기 허용 검사보다 먼저 수행된다.
- 실제 쓰기는 `memoryTurn.ts:240–260`의 `MEMORY_WRITE_ENABLED`, 주체/저장소, route 조건 등에 달려 있다. 이 감사는 조건부 연결을 확인했으며 실제 고객 기억 쓰기 발생을 주장하지 않는다.

[`assemble.ts:131`](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/assemble.ts#L131), [`referent.ts:190`](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/referent.ts#L190), [`memoryTurn.ts:240`](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/memoryTurn.ts#L240).

`assemble.ts`와 `referent.ts`는 기준 커밋과 바이트가 같다. 이번 패치가 새로 만든 회귀가 아니라 “전체 제거 완료”에서 빠진 기존 연결이다. 과거의 Python 기준 구현 동치 유지 주석은 최신 사용자 금지의 예외 승인이 아니다. 담당자 후속은 구 조립 의미 규칙을 연결 해제하거나 모델 계약으로 대체하는 것이며, 모델 실패 때 이 규칙을 다시 사용하지 않는 것이다. 이 연구 저장소에서 외부 서비스 코드를 임의 수정하지 않았다.

## 7d0aa049에서 발견한 핵심 2 — 어절 꼬리를 잘라 계측한다

`src/core/coverage.ts:114–151`의 `looseHit`은 고객 어절 뒤를 0·1·2글자 잘라 길이 3 이상인 부분이 답에 있는지 센다. `chat.ts:1641,1679–1692`와 `coverage.ts:195–210`에서 `looseN`을 `partial_no_net` 같은 계측 분류로 바꾸고, 기억 마무리에서 serving log에 싣는다.

확인한 소비처는 답 뒤 계측이다. 현재 답의 수정이나 기억 의미 행 생성과는 영향이 다르다. 그러나 원문 그대로의 인용 존재 확인도 아니며, 모델이 내지 않은 손님 말 신호를 만드는 경로다. 계측이라는 이유로 허용된 예외나 “규칙 0”으로 기록하지 않는다. 삭제된 shapeSignal과 일관되게 정리할 담당 후속으로 남긴다. [고정 소스](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/coverage.ts#L114).

## 모델 출력과 자체 목록의 대조

이 부분은 H70f의 **우리 출력과 우리 목록 대조**에 해당하는 구현 전환으로 구분한다. **인용이 원문에 글자 그대로 있는지 확인하는 출처 검사**와 같은 기능이 아니다.

| 경로 | 실제 입력과 동작 | 남는 해석 경계 |
|---|---|---|
| `focus.ts:51–59`; `chat.ts:98–100,866,1175,1180` | `question` 직접 검색 제거. 인텐터 entity text와 FOCUS_TOPICS/자체 이름을 대조 | 주제 접두·짧은 꼬리 허용 규칙이 모델 출력 쪽에는 남음. 고객 원문 fallback은 확인되지 않음 |
| `categoryGate.ts:95–145`; `chat.ts:668` | entities.text와 자체 이름/머리말·RAG 키·타입 목록을 비교. 원문 text는 사용하지 않음 | 이름 길이/개수로 strong·weak를 나누는 기존 정책은 남음. 모델 span이 옳다는 보증은 아님 |
| `placeGate.ts:507–521`; `chat.ts:860` | 모델 entity text와 RAG의 등록 이름을 비교하고 GID·rerank 조건 확인 | 모델 출력/자체 목록 연결이지 CE 원문 검사 아님 |
| `memoryTurn.ts:203–212` | correction 행의 thing 범위를 `wordsOf`로 복원해 자체 GID 이름과 비교 | 공백 정규화·부분일치로 보호하며 정확 인용 검증과 다름. 한 GID hit이면 모든 correction 행을 버리는 범위는 이전 구현에도 존재 |

GID의 `thing_from/to`는 `assemble.ts:105–110,144–146`에서 읽기 모델의 thing 구간을 전달한 값이다. `wordsOf`는 원문을 공백 어절로 나누고 해당 구간을 잇는다(`referent.ts:160–164`). 이 경로가 질문 전체 검색에서 좁아진 것은 확인되지만, 앞 절의 `ReferentTable.assign` 조사/값 규칙까지 없어지지는 않는다. 함수의 구간 복원만으로 모든 모델 구간의 유효성이나 정정 의미가 검증됐다고 하지 않는다.

## 모델 대체의 후속 확인

1. **자산과 실행 경로:** 로컬 enum·두 프롬프트·dist 복사 코드까지 확인했다. `JUDGE_DOOR_URL` 분기는 `{ask,text,cid?}`만 보내므로 원격 판정기의 새 ask/자산 수용은 별도 확인이 필요하다. 운영 재시작도 미확인이다.
2. **불명 관측:** no-map 보호의 yes/no/unsure, head/judge 출처, off/미실행을 분리할 수 있어야 한다. 현재 bool false를 모델 no나 품질 통과로 집계하지 않는다.
3. **호출 범위:** wants_image 자산은 strong 카테고리에서만 묻는다고 적지만 소스는 category 결과 전에 인간 non-serve 턴에서 시작한다. IMAGE_GEN/CATEGORY_SHADOW는 시작 조건이 아니다. 원격 실행 여부·비용을 측정한 것은 아니며 설명과 코드의 범위를 맞출 후속이다.
4. **품질·계약:** 정확도/기권/회귀는 담당자의 새 실측으로 확인해야 한다. 공통 parser의 느슨한 YES/NO 수용·door stamp 검증 한계는 기존 사항으로 별도 상세에 적었다. 고객 글자 fallback의 재도입과 혼동하지 않는다.

## 인계와 완료 기준

이번 클로버 산출은 고정 소스 감사·후속 목록·Comms 회신이다. 본선 API 실행, 서비스 코드 변경, 배포는 포함하지 않는다. M3 봉인 자료와 기존 결과는 변경하지 않았고, 문서 감사 때문에 110개 평가 테스트를 다시 실행하지 않았다. 최초 감사에서는 JSON 4개(기존 정본 대조 1개 포함)의 구문, 소스 파일 해시 12개, 문서 내부 파일 링크 40개와 diff 공백 검사를 통과했다. M3 gold/scenarios/scorer/manifest의 SHA-256도 기존 봉인값과 일치했다. 25b7bd5f 후속에서는 새 JSON 3개·소스 해시 8개·수정 문서의 파일 링크 45개와 diff를 검증했고, 봉인 디렉터리의 추적 파일 변경은 없다. 이 검사는 감사 자료의 정합 확인이며 대상 서비스의 동작 시험은 아니다.

최초 인계는 기억 조립 규칙 연결 해제와 coverage 꼬리 절단 제거를 우선 요청했고, 25b7bd5f에서 그 두 소스 지적을 마감했다. 현재 후속은 **폐기된 느슨 계측의 미측정 전달 → 옛 게이트/번호 재구성 검증 기준 정리 → needs_map 불명 관측·wants_image 설명 정합 → 선택된 자산 경로·재시작/실측 확인**이다. 이 보고서는 전체 저장소 모든 경로의 완전 탐색이나 운영 전체 준수 인증을 주장하지 않는다.
