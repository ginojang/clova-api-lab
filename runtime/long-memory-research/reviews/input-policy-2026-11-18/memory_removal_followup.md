# 기억 조립 규칙 제거 후속 소스 감사

2026-11-18 · 클로버 · 고정 소스 읽기 검토. 선행 감사의 R1을 새 커밋에서 다시 확인한다.

**callback과 조사·받침·크기/예산/월 변형 규칙의 구현 제거를 확인했다.** 기존 `finishMemoryTurn → assembleTurn` 연결은 남지만 `assembleTurn`이 callback을 호출하지 않고 빈 `cbs`를 사용하므로, 이 경로가 모델이 내지 않은 칸을 callback으로 더하던 문제는 대상 소스에서 닫혔다. 다만 번호표가 원문을 “그대로, 공백만” 사용하는 것은 아니다. NFC 및 양끝 따옴표·구두점 정리도 남아 있다. S6 대체 배선·실측·운영 적재 완료는 이번 변경에서 확인하지 않았다.

## 고정 범위

- 저장소: `ginojang/GanpanAI`.
- 기준: `7d0aa049f4c9e40de3cbdae8d75787c26dbcce8d`.
- 대상: `25b7bd5f6432e5887ca381cfbefedc6ea4e5abb4`; 부모 커밋이 위 기준과 일치한다.
- 전체 diff: 4파일, 10줄 추가·214줄 삭제. 이 감사 담당은 `core/assemble.ts`, `core/referent.ts`, `tools/callbackGate.ts`의 3파일(9줄 추가·206줄 삭제)과 기존 호출자/기록 소비처다. `core/coverage.ts`는 별도 감사 대상이다.
- 이 연구 저장소 안의 고정 Git 객체에 `show/diff/grep`을 사용했다. 모델/API/관문/DB/서비스/로그 접근, 빌드·실험·대상 시험 실행은 0회다. 외부 저장소 소스는 수정하지 않았다.
- 선행 보고: [removal_review.md](removal_review.md). 선행 대상 커밋에서의 잔존 판정은 그때의 사실로 보존한다.

아래 소스 줄은 별도 표시가 없으면 대상 `25b7bd5f` 기준, 경로 앞부분은 `elda-orchestrator/src/`다.

## 구현 제거와 호출 경로

| 항목 | 확인 근거 | 판정 |
|---|---|---|
| 조사·받침 | `core/referent.ts`에서 PAIRED/FREE/SUF, HANGUL 범위·받침 함수, `stripJosa` 구현 삭제 | 구현 제거 |
| 크기·예산·월 | SIZE/WON/MONTH/UNIT 및 `slotNorm` 삭제, `variants`의 해당 호출 삭제 | 구현 제거 |
| callback | `core/referent.ts`의 전체 질문 1–4어절 창·변형 집합 탐색·새 situation 생성 함수 삭제 | 구현 제거 |
| callback 호출자 | `core/assemble.ts:19` import 제거, `:131–134`에서 `const cbs: CallbackItem[]=[]` | 서빙 조립 호출 단절 |
| callback 행 생성 | `assemble.ts:160–164` 반복문은 남지만 입력 cbs가 빈 지역 배열이고 그 사이 이를 채우는 코드 없음 | 해당 경로에서 추가 행 없음 |
| callbackGate | `tools/callbackGate.ts` 삭제 | 도구 파일 제거 |

`core/memoryTurn.ts:198`의 `assembleTurn` 호출 자체는 바뀌지 않았다. 앞선 감사에서 확인한 `MEMORY_READ_ENABLED`/`REFERENT_MODE`와 조립 호출의 독립성도 그대로다. 이제 그 연결이 남아 있다는 사실만으로 callback 잔존이라고 보고하면 안 된다. 삭제된 함수를 읽기 실패나 플래그로 되살리는 분기는 이 확인 범위에서 발견하지 않았다.

`core/assemble.ts:97,106,109,121`의 번호 부여는 계속 모델 항목이 지정한 구간에 대해 수행한다. 현재 turn의 `ReadItem`에서 조립하는 행과 빈 callback 배열을 구분했다. 모델 항목이 없는 경우 규칙으로 새 situation을 추가하던 옛 경로는 제거됐다.

## 번호표 입력의 남은 정규화

`core/referent.ts:27–43`은 다음 순서를 따른다.

1. `clean(surface)`: NFC → 양끝 공백 trim → 양끝 `STRIP_CHARS` 제거.
2. `STRIP_CHARS`: `"'「」『』“”‘’.,!?~`.
3. 공백으로 나눈 조각을 공백 없이 합쳐 하나의 집합 원소로 반환.
4. `slot`은 `void slot`으로 사용하지 않는다. 슬롯별 값 해석은 제거됐다.

`ReferentTable.assign(:59–71)`과 `lookup(:84–90)`은 이 결과를 기존 표와 맞댄다. 그러므로 새 `:41` 주석의 “그대로(공백만 합쳐)”는 구현보다 좁은 설명이다. **정규화된 모델 지정 span의 번호 매핑**이라고 기록해야 한다. 인용이 원천에 글자 그대로 있는지 검사하고 불일치 출력을 버리는 H70f 출처 검사와는 다른 기능이다.

이 정규화가 남았다는 이유만으로 새 금지 의미 규칙이라고 자동 판정하지 않는다. 이번에 제거된 조사·값 의미 해석 및 고객 전체 창을 훑는 callback과 구분한다. 다만 exact/verbatim 보증으로 서술해서도 안 된다.

## 과거 번호 재구성과 기대값의 경계

확인한 번호 소비처는 다음과 같다.

- `core/memoryReplay.ts:297–320`은 저장된 `said`와 구간으로 표면을 복원해 현재 `ReferentTable.assign`을 호출한다.
- 같은 파일 `:302–320`은 재구성 번호와 저장 번호가 다르면 mismatches에 넣는다. `:270–275`는 경고 후 `{table,...,ok:true}`를 반환한다.
- `core/k0.ts:223–238`도 모델 항목이 가리킨 지역 구간과 같은 번호표를 사용한다.

따라서 변형 규칙 제거는 callback만 끄는 변경이 아니라 번호 매핑의 동치 관계도 바꾼다. 예전 규칙으로 같다고 묶던 조사·금액 표기 쌍은 이제 서로 다른 문자열이다. **운영 데이터에서 mismatch나 기억 손상이 발생했다고 관측한 것은 아니다.** 저장 이력과 새 번호 매핑의 호환성은 담당자가 별도로 검증할 항목이다. 이 연구 검토에서 DB를 읽거나 재생하지 않았다.

옛 시험 기대와 새 구현의 정적 충돌도 남는다.

- `tools/assembleGate.ts:117,144–151`은 callback 복원 행을 찾고 `recovered>0`를 GREEN 조건으로 둔다. 새 `cbs=[]`는 이 기준이 요구하는 복원을 생성하지 않는다.
- `tools/refGate.ts:122–136`은 `화단 모퉁이/화단 모퉁이가`, `부평에/부평에서`, `300만원/3,000,000원`, `11월에/11월` 등을 same으로 기대한다. 새 `variants`에는 그 동일시를 만드는 제거된 규칙이 없다.
- 이는 **실행한 시험 실패 결과가 아니라 소스에서 확인한 기대값 충돌**이다. 옛 시험을 통과시키려고 금지 규칙을 되살리는 대신 새 계약을 검사하는 시험으로 정리해야 한다.
- 삭제된 callback/stripJosa/slotNorm를 import/require하는 잔여 TypeScript 연결은 검색한 `src` 범위에서 발견하지 않았다. 빌드를 수행하지 않았으므로 빌드 성공을 주장하지 않는다.

## 남은 타입·기록·연구 도구

`CallbackItem`, `AssembleResult.callbacks`, 빈 배열을 순회하는 옛 블록과 기록 칸은 남는다. `memoryTurn.ts:373`의 callbacks 수 및 `servingLog.ts:377–389`의 `filled_by_callback`은 새 조립 경로에서 callback이 생성되지 않음을 반영하게 된다. 이를 옛 callback 모델/규칙의 정확도 향상으로 비교하면 안 된다. 과거 행의 callback 표지를 지우는 변경은 없다.

`tools/callback_ref_dump.py`와 참조 자료는 남아 있다. 이것은 기존 연구 자료 생성 도구이며 이번에 삭제한 서빙 callback의 연결 증거는 아니다. `core/referent.ts:1–23,100–116`과 `assemble.ts:129` 등에는 옛 동치·되짚기 설계 설명이 남아 새 구현과 어긋난다. 설명 정리가 필요하다.

## 완료 상태

| 층 | 이 감사의 상태 |
|---|---|
| 구 callback·조사·값 규칙 제거 | 고정 대상 소스에서 확인 |
| 구 기억 조립 전체 제거 | 아님. 모델 항목 조립·정규화 번호 매핑은 유지 |
| S6 T/C 대체 연결 | 이 diff에서 새 배선 없음. 해당 모듈·chat·memoryTurn의 변경도 없음. 기존 S6의 존재만으로 구 기능을 대체했다고 인증하지 않음 |
| 모델 실패 시 구 callback fallback | 확인한 변형 함수/조립 경로에는 없음 |
| 시험 계약 정리 | 옛 기대와 새 구현 충돌을 담당 후속으로 남김 |
| 운영 재시작·실행·쓰기·품질 | 모두 미확인 |
| coverage 후속 | 별도 감사이며 이 문서로 마감하지 않음 |

안전한 요약은 “25b7bd5f에서 지적한 callback과 조사·슬롯 변형 구현 및 호출 제거 확인; 남은 정규화 설명·옛 시험 기대·번호 호환성 검증은 별도 후속”이다. 전체 저장소 규칙 0, S6 전환 완료, 운영 반영 완료로 넓히지 않는다.
