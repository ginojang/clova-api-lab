# 고객 입력 글자 규칙 제거 소스 감사

작성일: 2026-11-18. 검토자: lexical_removal_review. 판정은 고정 Git 객체의 소스에 한정한다.

## 결론

요청한 일곱 항목의 삭제 또는 서빙 호출 단절은 확인했다. 그러나 `7d0aa049`의 고객 입력 글자 규칙이 **전부 없어졌다고 판정할 수 없다**. 별도 기존 기억 조립 경로에 조사 제거·크기/예산/월 정규화와 고객 전체 어절을 훑어 모델이 내지 않은 기억 행을 만드는 `callback`이 연결돼 있다. 답 뒤 계측에도 어절 꼬리를 최대 두 글자 잘라 포함 여부를 재는 `looseHit`이 남는다.

실제 운영에서 이 경로가 실행됐는지, 새 코드가 재시작 뒤 적재됐는지는 확인하지 않았다. Comms의 배포·재시작 대기 보고와 이 소스 판정을 분리한다.

## 범위와 방법

- 저장소: GanpanAI의 고정 객체를 이 연구 저장소의 Git 객체 DB에서 읽음.
- 기준: `55f4e2534683e561561c8ae52c3ec61493a526f7`.
- 대상: `7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d`.
- 비교 범위: `elda-orchestrator/`, 누적 8개 커밋·19개 파일, 102줄 추가·331줄 삭제. 마지막 커밋만 비교하면 앞선 제거 일곱 단계가 빠진다.
- 방법: `git diff`, `git show`, `git grep`으로 구현·import·호출자·소비처를 추적했다. 단순 정규식 발견 수를 위반 수로 세지 않았다.
- 모델/API/내부 관문/DB/서비스/운영 로그 접근, 빌드·시험 실행은 모두 0회.
- 모델 span과 자체 목록의 대조, `wants_image`·`wants_proposal`·`needs_map` 대체의 세부 판정은 병렬 감사 범위다.

아래 파일·줄 번호는 모두 대상 커밋 기준이다. 삭제된 구현은 위 기준 커밋과 누적 diff로 확인했다.

## 일곱 제거 항목

| 항목 | 확인한 변경과 호출 연결 | 판정 |
|---|---|---|
| 고유명 원문 글자 문 | `router/v1_0/chat.ts:786`: `RAG_PROPER_LITERAL` 분기와 `qn.includes(name)`로 RAG 고유명을 떨어뜨리던 블록 삭제. 실행 코드에서 해당 플래그 경로 없음. | 삭제 확인 |
| 가격 질문 정규식 | `core/priceRanges.ts:22`: `PRICE_ASK_RE`, `priceAsked` 삭제. `chat.ts:1308` 이후 가격 블록 조건에서 고객 질문 검사 제거. 남은 `includes('평균 가격대')` 입력은 우리 RAG 출력이며 고객 질문이 아니다. | 삭제 확인 |
| 접속·조사 꼴 신호 | `core/coverage.ts:322`: `CONJ_SURFACES`, `shapeSignal` 구현 삭제. `chat.ts:65,1653` import·호출과 `near_conj`, `repeated_particle`, 거리 로그/기억 인자 제거. | 삭제 확인; 다른 coverage 규칙까지 삭제된 것은 아님 |
| 판정 입력 군말 제거 | `core/judge.ts:290,548`: 단건과 배치 모두 `forJudge(text)` 대신 `{text, hit:null}`. import 제거. 예전 환경변수만 켜서 이 두 서빙 경로의 군말 제거를 되살릴 수 없음. | 서빙 호출 단절 확인; 함수 파일은 잔존 |
| 글자 기반 언어 감지 | `core/detect.ts` 삭제. `chat.ts:321,339`: `WORLD_LANG` 설정 기본값, 고객 입력 `callIntent(question)`에는 lang을 넘기지 않음. `core/decode.ts`의 답/후속 질문 언어는 사용자 언어를 따르라는 모델 지시. | 삭제 확인 |
| 정체 질문 지름길 | `chat.ts:1062`: `idAsk=null`; `identityAsk`, `mentionsSelf`, `hasThirdPartyAgent`, `identityShortcutEnabled` import와 호출 삭제. `:1240,1268` 기존 답 분기는 상수 null로 도달하지 않음. | 서빙 호출 단절 확인; 함수/도구·죽은 분기는 잔존 |
| 조직 속성 사전 | `core/placeGate.ts:701`: `orgAttributeFocus` 삭제. `prompts/k2/org_attribute_lexicon.md` 삭제. `chat.ts:935`: `buildMapBlock(...,true,true)`로 조건 지시를 항상 싣고 디코더가 관련성을 판단함. | 삭제 확인 |

언어 관련 주의: `chat.ts:2033`의 `callIntent(full, lang)`은 남아 있다. 입력 `full`은 생성된 우리 답이고 `lang`은 세계 설정값이다. 고객 원문의 문자 범위로 언어를 판별하는 예전 경로와 구별해야 한다.

## 잔존 R1 — 기억 조립의 조사·값 정규화와 callback

소스 연결이 있는 잔존 의미 규칙이다. 운영 실행 여부와 플래그 값은 미확인이다.

1. `chat.ts:499`에서 기억 읽기 결과를 준비한다. 읽기를 끄면 빈 items 결과를 만든다. `:1723`은 비인간 입력 이외에서 `finishMemoryTurn`을 연결하고 `:1776`으로 `memoryText ?? question`을 넘긴다.
2. `core/memoryTurn.ts:180–198`은 턴/주체 존재를 확인하고 번호표를 재구성한 뒤 `assembleTurn(a.question,a.read.items,table,tool)`을 호출한다.
3. `core/assemble.ts:97,106,109,121`은 모델이 지정한 원문 구간을 `ReferentTable.assign`에 넘긴다. `core/referent.ts:125–137`은 `variants` 교집합으로 같은 번호를 선택하거나 새 번호를 만든다.
4. `core/referent.ts:25–62,101–108`의 `variants`는 조사 목록·한글 받침 규칙으로 꼬리를 벗긴다. `:66–85`는 크기·예산·월을 정규식과 단위 표로 해석한다. 이는 원문에 인용이 존재하는지 확인하는 검사보다 넓으며 대상/값 동일성에 영향을 준다.
5. `assemble.ts:131`은 읽기 결과가 비어 있어도 `callback(question,table,doneSlots)`을 부른다. `referent.ts:190–211`은 고객 **전체 질문**을 1–4어절 창으로 훑어 위 변형 집합과 맞춘다. 맞으면 모델이 내지 않은 `situation`, `polarity:'+'`, `by:'callback'` 항목을 만든다.
6. `assemble.ts:158–162`가 이를 실제 조립 rows에 더한다. `memoryTurn.ts:240–260`에서 `MEMORY_WRITE_ENABLED`, 저장소/검증 주체, route 등 조건을 만족하면 그 rows를 `writeMemory`에 전달한다.

따라서 이 규칙은 미사용 도구나 글자 위치 검사만이 아니다. 읽기 결과가 없는 경우에도 기존 번호표가 있으면 callback 후보 생성 경로는 남아 있다. 다만 DB와 운영 플래그를 확인하지 않았으므로 실제 고객 턴의 실행·쓰기 발생을 주장하지 않는다.

`REFERENT_MODE=off`도 이 조립 경로를 끄는 조건이 아니다. 이 설정은 `core/referents.ts:34`와 `chat.ts:456–474`의 별도 조응 모델 호출/적용을 제어한다. `finishMemoryTurn`과 `assembleTurn`에는 이 설정 조회나 `refMode` 조건이 없다. `chat.ts:1723`까지 도달한 인간 입력에 대해 기억 마무리가 연결되고, 턴/주체가 있으며 선행 작업이 성공하면 `memoryTurn.ts:198`의 조립은 쓰기 허용 조건보다 먼저 수행된다. “무조건 운영에서 실행”이 아니라 “해당 소스 흐름 안에서 REFERENT_MODE에 의해 차단되지 않음”을 뜻한다.

이 파일의 과거 주석은 리소너 Python 구현과 동치 유지를 잔존 사유로 든다. 그 주석을 11-18 최신 사용자 금지의 예외 승인으로 간주하지 않는다. 후속 조치 제안은 담당자가 새 모델 계약으로 넘기거나 구 경로를 연결 해제하는 것이다. 본 감사에서 타 저장소 소스는 수정하지 않았다.

## 잔존 R2 — 답 뒤 coverage의 꼬리 절단 계측

`core/coverage.ts:114–151`은 인텐터가 라벨하지 않은 고객 어절을 답과 대조한다. `looseHit`은 뒤를 0·1·2글자 자른 후보 중 길이 3 이상인 문자열이 답에 있으면 참을 낸다. 엄격 일치와 달리, 원문 그대로의 출처 존재 확인에만 머무르지 않는다.

호출·소비 경로:

- `chat.ts:1641` → `unlabeledInAnswer(question,full,labeled)`.
- `chat.ts:1679–1692` → `cov.looseN`으로 `retrievalCase`를 정하고 coverage 로그를 만든다.
- `core/coverage.ts:195–210` → 느슨 계수가 양수이면 `partial_no_net` 분류를 낸다.
- `chat.ts:1726,1758–1760` → 기억 마무리에 coverage 자료를 넘김.
- `core/memoryTurn.ts:353` → serving log에 `a.coverage`를 실음.

확인한 소비처에서 이 값으로 현재 답을 차단·수정하거나 기억 의미 항목을 만들지는 않는다. 따라서 R1과 영향은 다르다. 그러나 삭제된 `shapeSignal`의 `chat.ts:1653` 주석 자체가 “측정용이어도 손님 말 글자 규칙 금지”라고 명시한다. 계측용이라는 이유만으로 `looseHit`을 승인된 예외로 처리하거나 “글자 규칙 0”으로 보고할 근거는 없다. 제거/모델 기반 계측으로 전환 검토가 필요하다.

`alignSpans`의 원문·codepoint 색인 대조, 어절 구간 복원, 앞 턴 원문 존재 확인은 별도로 취급했다. 정규식 또는 문자열 연산이라는 이유만으로 R1/R2와 같은 의미 판정이라고 묶지 않았다.

## 잔존 파일·주석 정리

- `core/fillerStrip.ts:142`의 `forJudge`, 플래그와 낱말 표는 남는다. `tools/fillerUnstrippedProbe.ts`는 아직 이를 직접 부르며 `fillerStripCollisionGate`도 표를 import한다. 확인한 서빙 judge의 import는 없다.
- `core/identityAsk.ts:54,112,114`의 분류기와 플래그는 남고 `tools/identityGate.ts`가 시험한다. `core/personaStore.ts:10`은 답 상수 `IDENTITY_ANSWER`와 타입만 import하며 고객 질문 분류를 부르지 않는다.
- `chat.ts:1050–1059`, `judge.ts:284–289,543–548`, `placeGate.ts:712–716,735–738`에 예전 호출 설명이 남는다. 코드와 설명의 혼동을 줄이기 위한 정리가 필요하다.
- `tools/ganpanQualityRun.ts:112`에는 `RAG_PROPER_LITERAL=on` 예제가 남지만 그 플래그의 서빙 구현은 제거됐다.

이 잔존 파일만으로 현재 서빙에서 군말 제거/정체 regex가 실행된다고 단정하지 않는다. 다만 정리 완료의 뜻을 “일곱 항목 서빙 연결 제거”와 “구 구현 물리 삭제”로 나눠 기록해야 한다.

## 판정 경계

- 확인: 요청 일곱 항목의 누적 소스 삭제/호출 단절.
- 미완: 전체 고객 입력 규칙 제거. 위 R1, R2가 최소 잔존 후보/경로다.
- 미확인: 운영 플래그, 실제 실행/쓰기, 재시작·라이브 적재, 새 모델 판정의 품질·지연·회귀.
- 허용 주장: “고정 소스의 일곱 제거 항목 확인, 기억 조립과 계측 잔존 경로 별도 발견.”
- 피할 주장: “운영 전부 제거”, “정규식 0”, “테스트 통과”, “새 판정이 실측으로 동일/개선.”

보고서 JSON 구문은 로컬 `python3 -m json.tool`로 확인했다. 대상 서비스 코드는 실행하지 않았다.
