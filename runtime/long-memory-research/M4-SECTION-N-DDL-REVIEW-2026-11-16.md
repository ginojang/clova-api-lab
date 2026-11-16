# 절 N DDL과 T 직접 저장 제안 — 정적 검토

2026-11-16 · 클로버 · 모델/API·관문·DB 호출 0회, SQL 실행 0회.

DBA `6ab04f7ad2`는 절 N DDL·purge를 memoryDB에 적용하고 되돌리는 시험14개가 기대대로 끝났다고 보고했다. 여기서는 **GanpanAI `3bf6d587cc635bd02ff538587bc0584d75886262:db/ddl/chat_ltm_section_n_1116.sql`(447줄), `6a61e1908357e406f2fa939412b6581ba29e7b1d:db/ddl/chat_ltm_purge_1116.sql`(92줄)의 소스**를 읽었다. 실제 배포 상태·14개 시험 원자료·동시성·운영 피해는 독립 검증하지 않았다.

소스상 원자 기억·episode·연산 원장·현재값/관계 뷰·forget/pause·정리 함수가 생겼다. DDL이 아직 없다는 앞선 상태는 이 보고로 갱신한다. 다만 아래 쓰기·삭제 경계는 담당자가 재현·보완한 뒤 실제 M3에 연결해야 한다. C·S4·결합 어댑터까지 완성됐다는 뜻은 아니다.

## 1. 상태 UPDATE는 세대·pause 검사를 건너뛴다

**확인 위치:** section_n:206~212는 UPDATE의 허용 칼럼만 비교하고 RETURN한다. epoch·paused·memory_off 검사는 그 뒤 INSERT 경로(:215~225)에만 있다. 허용 칼럼과 실제 writer 권한은 :236, :437이다.

따라서 이 DB 바닥만으로 모든 쓰기가 구세대를 거부한다고 말할 수 없다. 예를 들어 pause 뒤에도 needs_confirm/confirmed_at 상태 UPDATE를 허용한다. 더 직접적으로, 현재 활성 같은 슬롯 행이 없는 상황에서 withdrawn 행의 `invalid_at`·`invalid_reason`을 함께 NULL로 되돌리는 갱신은 허용 칼럼·두 NULL의 CHECK·부분 유니크를 모두 만족할 수 있다. OLD가 withdrawn인지, 무효화 상태를 현재로 복원하는지 막는 조건이 없다.

**담당 확인·보완:** 정상 CONFIRM/무효화와 금지된 재활성화를 전이 규칙으로 구분하고, 작업 세대 확인을 실제 INSERT/UPDATE 적용과 같은 직렬화 경계에 둔다. 저장 행의 옛 epoch와 지금 시작한 정상 작업의 epoch를 혼동하지 않는다. 재현 항목은 pause 후 상태 갱신, 구세대 WITHDRAW/CONFIRM, withdrawn→current 복원 시도다. 이 검토에서 실행하지 않았다.

## 2. INSERT의 세대 읽기와 forget 사이가 직렬화되지 않는다

**확인 위치:** :215는 principal을 잠금 없는 SELECT로 읽는다. forget은 :302에서 잠그고 :311에서 epoch를 올린 뒤 삭제한다. writer가 같은 principal 잠금을 먼저 잡거나 잠금 대기 후 epoch를 다시 검사하는 코드는 이 guard에 없다.

**조건부 동시성 반례:** Read Committed에서 F가 principal을 잠그고 epoch를 올렸지만 아직 미커밋한 동안 W의 INSERT guard가 이전 committed epoch를 읽어 통과할 수 있다. W의 FK 확인이 F의 잠금에 대기하더라도, F의 DELETE가 W의 미커밋 행을 보지 못한 채 끝난 뒤 W가 진행하면 principal 존재 검사만 남고 guard의 epoch 재검사는 없다. pause의 비키 UPDATE도 잠금 없는 읽기와 커밋을 한 작업으로 묶지 않는다.

이는 PostgreSQL의 MVCC 읽기와 행 잠금 규칙에 따른 정적 실행 순서다. 별도의 상위 writer 잠금이나 Serializable 정책이 있는지는 미확인이다. [공식 트랜잭션 격리 설명](https://www.postgresql.org/docs/current/transaction-iso.html), [공식 명시적 잠금 설명](https://www.postgresql.org/docs/current/explicit-locking.html).

**담당 확인·보완:** 모든 쓰기와 forget/pause가 같은 owner/범위 잠금 순서를 사용하고, 세대 판정이 잠금 획득 뒤 최신 상태에 대해 수행되도록 확인한다. 두 연결을 사용해 F 먼저/쓰기 먼저/재시도 세 순서를 재현한다. 단일 연결의 순차적인 old-epoch 거절 시험만으로 이 경쟁을 닫았다고 보지 않는다.

## 3. conversation forget에 cid 소유권 확인이 없다

**확인 위치:** :300~303은 scope/cid 존재와 principal 존재만 확인한다. :313은 전달된 cid를 그대로 cids에 넣고, :319~320 및 :336~371은 그 cid로 원문·대화·평가표를 삭제하거나 가린다. cid가 pids의 손님에게 속하는지 검사하지 않는다.

**미실행 경계 사례:** A와 B의 대화가 따로 있을 때 `forget(A, 'conversation', B의 cid)`를 writer가 직접 호출하면, 이 함수 경계에서는 B 원문까지 대상으로 삼을 수 있다. 장기표 DELETE(:323~333)는 pids 필터가 있으므로 원문과 장기 기억의 삭제 범위도 어긋난다. 실제 호출자나 다른 트리거가 사전 검증하는지는 미확인이다.

**담당 확인·보완:** 삭제 전 cid의 현재 소유자를 유효한 principal/link 범위와 대조하고, 다른 손님이면 범위 오류로 거절하는 회귀를 둔다. 공개 클라이언트가 직접 SQL을 호출할 수 있다는 주장이나 실제 타인 삭제가 일어났다는 주장은 아니다.

## 4. 해제된 링크가 forget의 범위에 다시 들어간다

**확인 위치:** memory_owner(:63~65)는 `unlinked_at IS NULL`인 링크만 사용한다. 반면 forget의 pids 수집(:305~307)은 같은 필터 없이 과거 device 링크까지 포함한다.

**미실행 경계 사례:** 기기 D→계정 A를 해제하고 D→계정 B로 다시 연결한 뒤 A를 잊으면, D가 A의 pids에 다시 들어가 :316 등에서 D의 현재 대화를 대상으로 삼을 수 있다. B 계정 명의의 모든 장기 기억까지 삭제된다고 확대하지 않는다.

**담당 확인·보완:** 현재 소유권 범위와 과거에 A에 귀속됐던 자료를 구분한다. 과거 흔적까지 지워야 한다는 이유로 해제된 기기의 현재 자료를 무조건 포함하지 않는다. active-link 필터와 자료별 귀속 시점을 함께 검토하고, 재연결 뒤 이전 계정 forget 회귀를 추가한다.

## 5. contested_from의 범위와 의미

**확인 위치:** 현재값 뷰(:249~258)의 본행은 invalid_at과 expires_at을 검사한다. 따라서 만료 사실이 일일 purge 전까지 계속 현재값 뷰에 보인다는 우려는 이 뷰에는 해당하지 않는다.

다만 contested_from 하위질의(:254~255)는 same product/principal/persona 필터와 `f.needs_confirm` 조건이 없다. superseded_by는 fact_id만 가리키는 FK(:103)이고 해당 칼럼 갱신은 허용된다. 상위 writer가 범위를 잘못 연결하면 다른 범위의 과거 값이 이 필드로 들어올 수 있다. 정상 같은 범위라도 CONFIRM 뒤 옛 contested 값이 계속 반환된다. 실제 잘못된 연결·노출이 발생했는지는 미확인이다.

**담당 확인·보완:** supersession 연결의 같은 범위/슬롯 조건과 확인 완료 뒤 반환 정책을 명시한다. M3 m11의 현재값·검색/주입 old-value 금지와, 확인 질문에 과거 후보를 설명하는 정책은 구분해야 한다. 확인형 이력 제공을 채택한다면 old current 사실로 투영하지 않고 provenance/state를 보존하며 새 평가판에 기준을 명시한다.

## 6. T 직접 장기 쓰기는 별도 계약·평가판

오케 `d0a91cbb1c`, 울지마 `fa697c9d7c`, 리소너 `6797397695`·`21f7fd133f`는 T가 ltm_fact를 직접 쓰고 C는 episode·S6 pass 약속·기한 정리를 맡는 (가)를 제안/지지했다. 기존 규격의 T chat 반영/C principal 승격과 의미가 다르다. 이를 반영한 규격·T/C 프롬프트·DDL·어댑터 판을 함께 고정해야 하며 별도의 사용자 재승인 절차를 이 검토에서 요구하는 것은 아니다.

- 봉인 M3 v0.1의 m02-q2 두 도메인은 T 후 principal old 유지/no_early_promotion을 요구한다. (가)를 같은 gold로 돌려 나온 실패를 신규 구현의 품질 결함으로 읽지 않는다. 기존 gold를 덮어쓰지 않고 후속 평가판으로 분리한다.
- 리소너는 session·동의 없는 민감 값의 대화 안 경로가 **S4 최근 원문**이라고 명시했다. 이 경로의 응답 성공은 구조화된 current_values가 있다는 증거와 다르다. 후속판에서는 대화 문맥 탐침과 장기 저장/재방문 탐침을 구분하고, 창 밖으로 밀린 경우도 별도로 기록한다. 익명 회상을 LTM 쓰기로 메우지 않는다.
- 약속은 원천 S6 pass 뒤 적용한다는 조건은 유지한다. :169~174의 현 dropped_why에는 `session`, `await_s6`, `sensitive_no_consent`가 없고, applied=false에는 dropped_why가 필수다. 자유 why만 넣으면 제약을 만족하지 못한다. 대기·최종 거부·C 재처리 적용을 구분할 enum/상태와 원천 연결이 필요하다.
- M3의 합성 product/persona/event ID를 이 DDL에 그대로 쓰는 어댑터는 성립하지 않는다. product 허용값·persona FK·bigint turn/fact 키에 대한 명시적 fixture 매핑이 필요하다. 원래 시험 범위와 출처·매핑 해시를 유지하고, 매핑 때문에 다른 손님/제품/페르소나 탐침이 같은 키로 합쳐지지 않게 한다.

## 7. 관계 단계와 long_gap의 조회 시점이 어긋난다

section_n:264~279는 턴이 있는 대화만 세고 `chats-1`을 prior_chats로 쓰면서, last_visit에는 현재 대화의 턴까지 포함한다. 이전 대화 한 번이 있는 손님의 새 대화 첫 턴 **전**에 읽으면 prior_chats=0/first가 된다. 첫 턴 **후**에 읽으면 last_visit=현재가 되어 90일 넘은 재방문의 long_gap이 false가 된다. :284 주석의 “첫 턴 직전”만으로 두 값을 동시에 맞출 수 없다.

**담당 확인·보완:** 현재 conversation ID를 명시적으로 제외한 이전 대화 집계와, 이번 방문의 존재 여부를 나누거나 두 값의 조회 계약을 따로 둔다. 첫 방문·1회 재방문·장기 공백 재방문을 첫 턴 전/후 각각 확인한다. 이 뷰의 product 차원 부재는 H91의 (persona,principal) 정의와 H86의 세 범위 관계를 먼저 명시할 문제이며 곧바로 제품 격리 위반이라고 단정하지 않는다.

## 8. 180일 정리의 기본값과 강제 조건

purge:9~21은 기본180일을 사용하고 현재 행을 가리키는 직전 과거 행을 보존한다. 다만 p_keep_days 범위 검사가 없고, 여러 과거 행이 같은 현재 fact_id를 가리키는 것을 막는 제약도 확인되지 않았다. 따라서 단일 직전 행만 보존한다는 보장은 정상 체인을 만드는 writer 규칙에도 의존한다.

**담당 확인·보완:** 실제 함수 EXECUTE 권한·기본 권한, 허용 p_keep_days, 직전 행 단일성을 확인한다. 이 파일에는 ltm_purge의 명시적인 권한 제한이 없지만 전체 DB의 기본 권한 설정은 미확인이다. 공개 실행 가능이나 실제 잘못된 삭제가 발생했다고 단정하지 않는다. cron이 기본값으로 부르는 경로와 임의 인자를 준 호출을 구분한다.

## 다음 확인 순서

DBA가 위 경계를 시험 가능한 판으로 보완하고, 오케·리소너가 T/C 및 S4·원장 어댑터 판을 맞춘 뒤 후속 M3 판을 고정한다. 이번에는 봉인 v0.1을 변경하거나 실서빙을 실행하지 않았다. 14개 기존 시험에 어떤 반례가 포함됐는지는 시험 원자료가 없어 알 수 없다. 이 문서의 SQL 경계 반례는 **소스 감사와 담당자 재현 요청**이며 DB 재현 성공 결과가 아니다.
