# 가격 원장 반환 계약 후속 마감

2026-11-18 · 클로버 · 고정 소스 정적 검토.

**앞선 PL1(rows와 상태의 요청별 귀속)과 빈 캐시 적중 구분은 대상 소스에서 해결됐다.** 반환형 변경을 받는 확인된 호출자도 새 객체의 rows를 사용한다. 빌드·운영 실행·재시작 완료를 확인한 것은 아니다.

## 대상 식별

Comms `41765b1f2c`에는 커밋 해시가 없었다. 원격 main을 `refs/audit/ganpanai/41765b1f2c`로 고정해 내용이 일치하는 후속 커밋을 찾아 감사했다. 이 구분을 보존하며, 메시지가 직접 이 해시를 명시했다고 기록하지 않는다.

- 저장소: `ginojang/GanpanAI`.
- 기준: `b5ed090c612d037b63cc2b1e4724fa5305848f57`.
- 대상: `5686d64983e9778b0de1a79ab9350c41c87b73b9`.
- 대상의 부모가 기준과 같고, 커밋 제목이 선행 인계 `8121fbf351` 및 `{rows,outcome,cacheHit}` 변경을 직접 참조한다.
- `core/priceRanges.ts` 대상 blob: `2db4c0bde049ab6e44931a434772651aa2111e35`.
- 선행 발견은 [price_ledger_followup.md](price_ledger_followup.md)에 그때의 고정 소스 결과로 보존한다.

## PL1 해결

`elda-orchestrator/src/core/priceRanges.ts:19–20`은 `LedgerResult={rows,outcome,cacheHit}`를 선언한다. `lastLedgerStatus` 공유 상태가 삭제됐으며 함수의 모든 반환 경로가 결과를 한 객체로 제공한다.

| 반환 경로 | outcome | cacheHit | 소스 줄 |
|---|---|---|---|
| 유효 cache, 행 있음 | ok | true | 29 |
| 유효 cache, 빈 배열 | empty | true | 29 |
| 새 조회·변환 성공, 행 있음 | ok | false | 46 |
| 새 조회·변환 성공, 빈 배열 | empty | false | 46 |
| 조회·변환 예외 | error | false | 49 |

각 호출의 rows와 상태가 같은 반환 객체에 들어간다. 이전처럼 await 후 다른 요청이 바꾼 전역 상태를 getter로 읽는 경로가 없다. 공유된 자료 cache 자체는 유지되지만, 이것을 요청별 상태가 다시 공유된다는 뜻으로 해석하지 않는다.

빈 cache hit와 새 조회 empty도 이제 `outcome=empty` 및 `cacheHit=true/false`로 분리된다. 조회를 생략한 경우 호출자는 led=null을 유지하므로 empty/error와 다른 값으로 남긴다.

## 호출자 호환성

고정 대상 tree의 TypeScript/JavaScript 계열 파일 전체에서 함수·옛 상태 이름과 priceRanges import를 검색했다. 실제 `priceRangesFromLedger()` 호출은 `router/v1_0/chat.ts:1325` 한 곳이다.

- `chat.ts:87`: 옛 상태 import 및 getter 제거.
- `chat.ts:1324`: led를 `Awaited<ReturnType<typeof priceRangesFromLedger>> | null`로 선언.
- `chat.ts:1325`: 같은 led의 `rows`를 `priceSummaryBlock`에 전달.
- `chat.ts:1327`: 같은 led의 outcome/cacheHit/rows.length를 기록.

확인한 소스 범위에 옛 배열 반환을 기대하는 호출자나 `lastLedgerStatus`/`priceLedgerStatus` 잔여 참조는 없다. 타입 검사·빌드를 실행하지 않았으므로 이것을 전체 빌드 성공으로 확대하지 않는다.

## 완료 경계

이번 마감은 **이전 두 관측 계약 문제의 소스 해결 및 호출자 호환성**이다. 가격 판정·주입 범위와 새로운 일반 스키마 문제로 감사를 확장하지 않았다. 실제 캐시 hit, 조회 오류, 동시 호출, 배포/재시작, 모델 소비를 관측한 결과도 아니다.

Git 객체 읽기와 본 보고서 작성 외 API/모델/DB/서비스/관문/고객 로그 접근 및 대상 코드·시험 실행은 0회다. 운영 반영은 담당자 보고와 후속 증거로 별도 확인해야 한다.
