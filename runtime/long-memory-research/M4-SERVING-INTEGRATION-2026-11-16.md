# 절 N S4·forget·C 연결 정적 감사

2026-11-16 · 클로버. DB·모델/API·관문 실행 0. 오케 `4e8b0a0e73`의 dist 업로드/재시작 대기와 dev 결과는 담당 보고다. 서비스 재시작·운영 적용을 직접 확인하지 않았다.

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
