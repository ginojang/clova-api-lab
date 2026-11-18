# 오케스트레이터 입력 규칙 제거 후속 감사

2026-11-18 · 클로버 · 수신 Comms `84bf43db7b`(03:02 UTC).

**보고된 일곱 항목의 삭제 또는 서빙 호출 단절과 세 모델 대체 경로는 소스에서 확인했다. 그러나 전체 제거는 미완이다.** 기존 기억 조립에 조사·값 정규화와 모델이 내지 않은 기억 후보를 만드는 callback이 연결돼 있고, 답 뒤 coverage 계측에도 어절 꼬리 절단이 남는다. `REFERENT_MODE=off`는 기억 조립을 끄는 조건이 아니다. 실제 운영에서 이 경로가 실행되거나 기억을 썼는지는 확인하지 않았다.

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

## 남은 핵심 1 — 기억 조립이 새 의미 항목을 만든다

대상 커밋의 연결은 다음과 같다. 파일은 모두 `elda-orchestrator/` 아래다.

`src/router/v1_0/chat.ts:1723,1776` → `src/core/memoryTurn.ts:180–198` → `src/core/assemble.ts:97,106,109,121,131` → `src/core/referent.ts:25–108,125–137,190–211`.

- `variants/stripJosa`는 조사 목록·한글 받침 규칙과 크기/예산/월 정규화를 사용해 같은 대상/값 번호를 정한다. 모델이 뽑은 구간이 입력이어도, 인용이 원문에 있는지만 확인하는 H70f 출처 검사보다 넓다.
- `callback`은 **고객 전체 질문**을 최대 4어절 창으로 훑고 기존 값의 변형 집합과 맞춘다. 읽기 모델이 내지 않은 칸에 `situation`, `polarity:'+'`, `by:'callback'`을 만든다. `assemble.ts:158–162`에서 이 항목이 쓰기 rows에 추가된다.
- `MEMORY_READ_ENABLED=off`는 빈 items를 만들 뿐 이 callback 호출을 우회하지 않는다. `REFERENT_MODE=off`는 별도 조응 모델/적용 경로만 제어한다. `chat.ts:1723`까지 도달한 인간 입력(`nonHuman=false`)에서 턴·주체와 선행 조회가 성립하면 조립은 쓰기 허용 검사보다 먼저 수행된다.
- 실제 쓰기는 `memoryTurn.ts:240–260`의 `MEMORY_WRITE_ENABLED`, 주체/저장소, route 조건 등에 달려 있다. 이 감사는 조건부 연결을 확인했으며 실제 고객 기억 쓰기 발생을 주장하지 않는다.

[`assemble.ts:131`](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/assemble.ts#L131), [`referent.ts:190`](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/referent.ts#L190), [`memoryTurn.ts:240`](https://github.com/ginojang/GanpanAI/blob/7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d/elda-orchestrator/src/core/memoryTurn.ts#L240).

`assemble.ts`와 `referent.ts`는 기준 커밋과 바이트가 같다. 이번 패치가 새로 만든 회귀가 아니라 “전체 제거 완료”에서 빠진 기존 연결이다. 과거의 Python 기준 구현 동치 유지 주석은 최신 사용자 금지의 예외 승인이 아니다. 담당자 후속은 구 조립 의미 규칙을 연결 해제하거나 모델 계약으로 대체하는 것이며, 모델 실패 때 이 규칙을 다시 사용하지 않는 것이다. 이 연구 저장소에서 외부 서비스 코드를 임의 수정하지 않았다.

## 남은 핵심 2 — 어절 꼬리를 잘라 계측한다

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

이번 클로버 산출은 고정 소스 감사·후속 목록·Comms 회신이다. 본선 API 실행, 서비스 코드 변경, 배포는 포함하지 않는다. M3 봉인 자료와 기존 결과는 변경하지 않았고, 문서 감사 때문에 110개 평가 테스트를 다시 실행하지 않았다. JSON 4개(기존 정본 대조 1개 포함)의 구문, 소스 파일 해시 12개, 문서 내부 파일 링크 40개와 diff 공백 검사를 통과했다. M3 gold/scenarios/scorer/manifest의 SHA-256도 기존 봉인값과 일치한다. 이 검사는 감사 자료의 정합 확인이며 대상 서비스의 동작 시험은 아니다.

담당자에게 넘길 우선순위는 **기억 조립의 금지 규칙 연결 해제 → coverage 계측 정리 → 모델 대체의 자산/불명 관측/호출 범위 확인**이다. 후속 커밋을 같은 호출 경로로 재감사하고, 그 소스 완료와 운영 재시작·실측을 별개 상태로 유지한다. 이 보고서는 전체 저장소 모든 경로의 완전 탐색을 주장하지 않으며, 발견된 잔존 경로만으로도 전체 제거 완료 판정은 보류한다.
