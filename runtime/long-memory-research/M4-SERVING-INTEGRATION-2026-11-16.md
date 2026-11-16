# 절 N S4·forget·C 연결 정적 감사

2026-11-16 · 클로버. DB·모델/API·관문 실행 0. 오케 `4e8b0a0e73`의 dist 업로드/재시작 대기와 dev 결과는 담당 보고다. 서비스 재시작·운영 적용을 직접 확인하지 않았다.

**최신 확인:** 아래 첫 감사는 6da1a409 기준이다. 마지막 절까지 5649ecfd·3d8c1cb3 후속 수정 확인과 배포 대기 보고를 나눠 적었다. C 원천 전 epoch·legacy 판정 분리·forgotten 순서·같은 프로세스 JSONL 삭제 직렬화는 보완됐다. 예전 결함 설명을 현재 전체 상태로 읽지 않는다.

검토 기준: GanpanAI `6da1a409b79c8c7d4c02ad610e28491e78d52051`의 `elda-orchestrator/src/` 소스. S4 출발 `787e7b0a122498975559ad7505613ee4489a9fc2`, 원장 `91422a91294d457e9cb7bdd9e5057c0f22a45a4a`, forget `53e264faff25df7a83deb6c28d2a4936f2f47928`. 규격 Elda-Spec `88f5b45960dc4f97ffe127351646a49de66426aa` harness H86~H97/v1.023, persona P24.

## C 시작 세대가 모델 응답 뒤에 새로 취득된다

`core/eldacore/s6chatEnd.ts:60~68`은 원문을 수집해 모델에 보낸다. owner/epoch는 응답을 받은 **뒤** :75~78에서 읽는다. :127은 타이머가 시작할 때 map에서 지우고 :132의 cancel은 남은 timeout만 취소한다. 이미 실행 중인 C의 원문·응답은 취소 대상이 아니다.

정적 반례: C가 옛 원문으로 실행 중 → forget 또는 pause→resume가 세대를 바꿈 → C가 완료되며 새 epoch를 읽음 → :96/:112에 새 epoch로 적용 요청. DB의 올바른 세대 검사만으로 구원문에서 나온 작업임을 식별할 수 없다. 실제 재현 결과는 아니다. **원천을 잡는 시점의 owner/epoch를 작업에 고정**하고, 완료 때 새 세대로 재발급하지 않는 보완이 필요하다. 이미 시작한 작업의 취소/드롭 증거도 원장에 남겨야 한다.

## S6 원천 결합과 episode 쓰기

`s6chatEnd.ts:39~52`는 판정 시각 직전의 chat.turn에 verdict를 붙인다. 지연된 옛 응답의 판정이 다음 턴 생성 뒤 끝나면 다른 턴에 붙을 수 있다. 시각 근접은 원천 응답·판정의 식별자가 아니다. 약속의 :96 pass 조건은 있으나 그 pass가 **그 assistant 원문**에 대한 판정인지 식별할 수 있어야 한다.

episode :102~112는 did.kind만 걸러 쓰고 reuse를 그대로 전달한다. promise의 S6 차단과 별개로 episode의 원천/S6·reuse.must_repeat의 실제 약속 여부를 결정론으로 확인하는 경로가 없다. 프롬프트 요청을 적용 관문의 증거로 삼지 않는다. 후속 묶음에는 unrelated pass·source unknown/fix·약속의 episode 우회 사례를 포함한다.

## 실제 입력에 남는 손님 블록

코딩고래 `ab436bb673`는 additionalContext가 실행기 history에 남는다고 코드 근거와 함께 보고했다. 오케 캐시 삭제만으로 이 history가 사라지지는 않는다. serve-gate의 살아 있는 프로세스 종료·resume 차단은 아직 이 감사에서 직접 확인하지 않았다. `forget.ts`의 DB·캐시·JSONL 처리는 이 별도 경계를 대체하지 않는다.

울지마 `38e283cde6`의 P24 대체 머리/철회 갈래 표시 요청을 규격 원문과 대조했다. 현재 `customerMemory.ts:61~72`의 render에는 대체 머리·철회 갈래가 없다. `recordS4`의 fresh items/block은 실제 호출의 과거 블록 전부가 아니다. **새 블록·history 속 기억·현재 유효 기억·raw를 포함한 전체 요청**을 나눠 측정한다. 옛값을 계속 센다는 원칙과, P24 대체 표지가 물리 삭제를 뜻하지 않는다는 점을 함께 보존한다.

M3 v0.2는 별도 사전등록/봉인하며 v0.1을 덮어쓰지 않는다. source 상태 전이와 C 실행 증거가 없으면 unknown이다. 이 문서의 반례는 실행 담당자의 확인·보완 대상이며 라이브 장애를 재현했다고 주장하지 않는다.

## 다른 삭제 경로·동시 파일 정리

같은 `6da1a409` 트리의 `db/ddl/chat_ltm_audit_fix_1116.sql:111` NOTIFY에는 `principal_ids`, `scope`, `cid=p_cid`만 있다. 전체 `cids` 배열은 :113 함수 반환값에만 있다. `core/forget.ts:88~90`의 listener는 payload의 cids/cid만으로 파일 삭제·C 취소를 전달하므로, **다른 프로세스/DB 경로에서 all 삭제를 하면 cid=null/빈 배열**이 된다. principal 기반 캐시 훅은 별도로 실행되지만 파일 정리·cid 기반 C 취소까지 완료됐다는 증거는 아니다. :93~99의 재접속에도 놓친 영수증을 따라잡는 코드가 없다.

`forget.ts:44~56`은 JSONL을 읽고 해당 cid를 뺀 뒤 전체 파일을 덮어쓴다. A/B 삭제가 같은 원본을 읽은 다음 A제외본→B제외본 순서로 쓰면 A줄이 다시 남을 수 있다. direct :68과 listener :90에서 동시에 호출할 수 있다. 파일별 직렬화와 동시 append/삭제의 원자성, 삭제 집합의 누적 적용이 필요하다. 단일 요청 성공 로그로 이 경쟁을 확인했다고 보지 않는다.

또 기본 logs 디렉터리와 SERVING_LOG_PATH만 순회한다(:15~16,:33~34). 기록기의 별도 설정 `ELDACORE_LOG_DIR`(`s1s2.ts:33`), `EARLY_EXIT_LOG_PATH`(`earlyExitLog.ts:20`), `GOLD_VERDICT_PATH`(`goldVerdict.ts:23`)가 기본 폴더 밖이면 삭제 대상에서 빠진다. 실제 운영 환경변수는 읽지 않았으므로 조건부 소스 결함이다.

## S4 관측의 남은 경계

- **확인한 보완:** `customerMemory.ts:40`은 실제 current CID를 관계 함수에 전달한다. :71~78에서 이번 렌더의 fact slice와 반환 items가 일치한다.
- **episode TTL:** :48~55의 priorLine 조회에는 expires_at 조건이 없다. 만료 후 purge 전의 episode가 최근 한 줄로 선택될 수 있다. fact의 TTL 필터와 다른 경로다. episode는 items 목록에 없으므로 원문 블록·episode ID도 관측해야 한다.
- **전달 전 보냈음 처리:** `router/v1_0/turn.ts:179`의 cmSent 갱신은 응답 전이다. 같은 저장소 `harness/executor/src/main.ts:143~144`는 실패 시 history를 되돌린다. 블록 전달 뒤 실패·재시도에서 같은 MD5를 생략하면 실행기에는 블록이 없을 수 있다. CLI의 실제 동일 동작 여부·운영 재현은 미확인이다.
- **시각 join:** `recordS4`는 emitted=false여도 계산한 블록을 저장하고 :99~104에서 ok=true를 쓴다. debug의 다음 S1/인접 시각 join은 비동기 완료 순서에 의존한다. 공통 turn/request ID와 실제 입력 캡처 없이 S4→답·op→턴의 인과를 확정하지 않는다.
- **600 계수:** 현 토큰 함수는 문자 기반 어림이며, :74는 fact만 줄이고 고정 부분+관계+episode만 남았을 때 초과를 처리하지 않는다. 현재 기본값에서 실제 초과했다는 보고는 아니다. 후속 채점기는 estimate와 실제 tokenizer를 구분하고 정확한 상한 판정에 근사값을 대신 쓰지 않는다.

리소너 `029f96ec05`는 원문 읽기 시점 epoch 고정·must_repeat를 applied 약속 목록으로 재구성·판정 원천 키 연결 원칙에 동의하고 계약 v0.004 수정을 예고했다. 이 동의/예고는 코드 적용 완료나 SQL/서비스 재실행 결과가 아니다.

## 후속 소스 5649ecfd와 배포 대기 보고

오케 `71858be048` 뒤 GanpanAI `5649ecfd63470a013bcbb217917e28a18a4e3795` 트리를 읽었다. `c7700bc6`은 갈음 머리/기동 따라잡기 시작판이며 그 뒤 C 수정까지 포함한 판으로 대조했다. 보고 본문의 `ee4e67c7`·`06b24fe9`는 측정 파일/프롬프트 표식이며 Git 커밋으로 단정하지 않는다.

| 항목 | 확인한 보완과 잔여 |
|---|---|
| C 작업 epoch | s6chatEnd:84 gather → :87~90 epoch → :92 모델 호출로 이동. **모델 대기 중** 세대 변경 경계는 보완됐으나 **gather 완료→epoch 조회** 사이 삭제는 여전히 구원문+새 epoch가 된다. 원문 캡처 전 세대를 고정해야 한다. |
| episode 뒤늦은 쓰기 | :121~122 재검사가 추가됐고 INSERT에는 캡처 epoch를 전달한다. 재검사와 INSERT 사이 경쟁은 기존 DB FOR SHARE guard가 막는 경로이므로 별도 원자성 결함으로 세지 않는다. 다만 캡처 시점 잔여는 위와 같다. |
| reuse.must_repeat | :114의 applied 약속만 :132에 재구성한다. 이 우회는 소스 보완 확인. cooldown/must_not_repeat는 assistant 원문 포함 검사이나 did의 개별 S6 pass 출처 검사까지 증명하지 않는다(:126~130). |
| S6 키 | :46~55의 ti 우선 연결 추가. ti 없는 옛 판정은 여전히 시각 추정 후 같은 byChat에 병합한다. 안전한 source pass로 쓰려면 연결 안 된 옛 줄은 unknown으로 분리해야 한다. 주석의 「ti 줄 있으면 안 씀」과 달리 실제로 legacy를 제외하는 분기는 없다. |
| P24 | 바뀐 블록의 갈음 머리 경로 추가. 다만 turn:27이 sessionPrincipal을 지운 뒤 :29에서 같은 map을 찾아 forgotten 표시하므로 principal-only 통지는 표시를 놓친다. cid 배열이 없던 NOTIFY와 결합하며 이전 history의 삭제를 뜻하지 않는다. |
| 파일/통지 | 이 트리에서 forget.ts의 JSONL read→overwrite, cid 누락 통지 처리, 별도 로그 경로 누락은 유지됐다. 이후 serve-gate 연결 보고는 아래와 구분한다. |
| 기동 C | pr-test 제한·기본20건 상한 따라잡기 코드 추가. 이전 job 원천/epoch 복구와 새로 추출하는 작업의 차이, 실행/미실행은 실제 원장으로 확인해야 한다. |

풀스택 `f255909570`의 serve-gate 51f910b/61 PASS는 **아직 배포 전**이라는 담당 보고다. 코딩고래 `cb08157d33`와 오케 `8e4691426b`는 CLI session_id=오케 cid와 session_ids 전달을 확인/보고했다. 오케는 LISTEN에서 관리자 키 파일이 있을 때만 게이트를 호출하도록 연결했다고 보고했다. 키가 없으면 건너뛰며 배포·설정은 담당자의 후속이다. 이 감사에서는 그 엔드포인트·키·살아 있는 프로세스 종료를 직접 호출/검증하지 않았다.

C 12행 K=3 점수, 초기 따라잡기의 검증 대화 호출/episode 발생, 수정 후 관문0은 각각 담당 보고다. M3 84탐침 실측이나 운영 삭제 관문 통과로 합산하지 않는다. 후속 M3는 고정된 계약대로 누락/연결 미완료를 unknown으로 남기고 별도 실행 ref를 요구한다.

## 후속 소스 3d8c1cb3 — 확인 마감 범위

오케 `66e6da79eb`·DBA `11ff3a5496` 뒤 GanpanAI `3d8c1cb318c4f91f978394cb7e3e76f6f8b17248`을 고정해 대조했다. 이는 `cfa4b3df` 오케 수정·`63a44be1` DB NOTIFY 수정을 포함한다.

- `s6chatEnd.ts:79~87`은 owner/epoch를 gather 전에 읽고 끝까지 넘긴다. 앞서 제시한 **원문 수집→새 epoch** 반례의 소스 보완을 확인했다. :44~48에서 ti 없는 옛 판정을 건너뛰므로 legacy 시각 결합 문제도 마감한다. 원천 응답·판정의 완전한 provenance는 별도 평가 관측으로 유지한다.
- `turn.ts:28~30`은 forgotten 표시 뒤 sessionPrincipal을 지운다. principal-only 통지의 순서 문제를 마감한다.
- `forget.ts:39~44`는 purgeChain으로 같은 프로세스의 두 JSONL 삭제를 직렬화한다. 해당 삭제 간 복원 반례는 보완됐다. append writer/다른 프로세스까지 직렬화한 것은 아니며 오케도 동시 append 손실 가능성을 보고했다.
- `chat_forget_notify_cids_1116.sql:107~113`에 실제 cids와 cids_truncated가 추가됐다. 일반 크기의 all 통지 cid 누락은 보완됐다. **7800바이트 초과로 cids=[]가 된 경우** `forget.ts:122~126`은 경고만 기록하고 JSONL을 지울 수 없다고 명시한다. 이는 삭제 완료가 아니라 **미완료 후속 작업**이다. serve-gate의 principal 전체 종료와 오케 파일 삭제는 별개다. 누락 통지 따라잡기·별도 로그 경로·did별 S6 출처·episode TTL 등도 계속 남는다.
- serve-gate 호출 코드는 :91~103에서 확인했다. 설정 키 부재는 :95에서 skip이며, 배포/키 전달/재시작 대기는 풀스택 `602843d1dc` 보고와 일치한다. 실패·skip을 process closure 성공으로 어댑터에 기록하면 안 된다. 이 문서에서는 승인 요청이나 운영 실행을 대신하지 않았다.

M3 v0.2는 이러한 소스 검토와 별개인 합성 평가 도구다. 큰 NOTIFY·파일 writer 전체·모든 물리 저장 자리까지 84탐침이 완전 포괄한다는 주장은 하지 않는다. 계수의 단위와 미측정 범위를 남긴다.
