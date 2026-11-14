# 훅 ↔ 오케 계약 v1.0 — harness v1.000 (사용자 결정 2026-11-13) — `turn/before` · `turn/after`

> 오케스트레이터 · 2026-11-13. **v1.0** — S4.5 최종(풀스택 0af8a9b41a: 훅 길 · serve 레인 · 위험 두 축 묶음 판정 22/22 · 턴당 +≈$0.0007 = 위험 바닥 값)을 사용자가 받아들였다(「v1.000 으로 가자」). 처음 판(v0.1)은 같은 날 S4.0이었다. 기준은 harness v0.816(Elda-Spec `afdf660` · fail-closed · 자리별 시간 상한 · block+reason 답 · `hookSpecificOutput.brain`)과 model-serving v0.104 절 5(테이 · TEI를 부르는 모양 · 두 층 시간)다.
> 실행기는 표준 틀 사본이고, 훅 모듈은 이 두 문을 부르는 얇은 HTTP 하나다. **판단은 오케 한 자리에서만 한다.**
> 다리(B · 두뇌 `elda`, f0661269)는 이 계약이 라이브가 될 때까지 비교 기준선으로 남는다.

## 1. `POST /api/v1_0/turn/before` ← `UserPromptSubmit`

요청
```jsonc
{ "session_id": "<실행기 sessionId>",        // = 오케 conversation_id (그대로 쓴다)
  "prompt": "<손님 말 원문>",
  "origin": { "kind": "human" },              // H57 — 실행기가 아는 출처. 없으면 human 으로 본다(③ 서빙은 늘 사람)
  "persona": "elda" | "<npc id>" | null,      // 입구가 정한다(손님이 못 고름)
  "cwd": "…", "hook_event_name": "UserPromptSubmit" }
```

응답 — 셋 중 하나(HTTP 200)
```jsonc
// ① 두뇌가 답한다 — 맥락을 실어 보낸다
{ "decision": null,
  "hookSpecificOutput": { "hookEventName": "UserPromptSubmit",
    "additionalContext": "<페르소나 지침 + RAG 근거 + 지도 결과 + 기억 + 이번 턴 제약>",
    "brain": "eldacore:small" },             // 그 턴 두뇌(입구 ELDA_BRAIN_ALLOW 안에서만). 스몰톡·집중 = 거인 등급
  "elda": { "turn_token": "…", "stamps": { "intent": {…}, "coref": {…}, "rag": {…}, "k2": {…} } } }

// ② 오케가 답을 정했다 — 두뇌 없이 손님에게 그 문장(풀스택 v0.815 · answeredBy:hook)
{ "decision": "block", "reason": "<손님에게 갈 답 문장>",
  "elda": { "turn_token": "…", "answered_by": "risk_floor" | "npc_deterministic" | "identity" | "giant_focus" } }
//   위험 바닥의 말하는 거절 · 결정론 NPC · 정체성 답 · 집중 모드 거인 답(그림 포함 턴은 오케가 직접 부른다)

// ③ 입력 자체가 안 된다(너무 긺 등) — reason 없는 block ⇒ 실행기 error{blocked}
{ "decision": "block" }
```

**두 층 기준**(⛔ 섞지 않는다)
- 안쪽(오케 ↔ TEI · 테이 절 5-1)
  - `measured`를 먼저 읽는다.
  - 429는 막지 않는다(한 번 다시 하거나 그 서비스 없이 간다).
  - **TEI 실패는 턴 실패가 아니다.** 그 서비스 없이 맥락을 짠다. `stamps`에 「모른다」 사유를 남긴다.
- 바깥(실행기 ↔ 오케 · harness v0.816)
  - `turn/before` **자체가** 실패하거나(5xx·연결 끊김) 시간을 넘기면 실행기가 입력을 막는다(fail-closed).
  - `ELDA_HOOK_FAIL_REPLY`로 정해진 사과 문장을 낸다. 위험 바닥 없이 두뇌로 넘어가는 길은 없다.
- 시간: `ELDA_HOOK_TIMEOUT_MS_UserPromptSubmit = 8000`.
  - 근거: TEI 최악 ≈3.5초(테이 5-2) + 판정 Sonnet 병렬 ≈1.6초 + RAG·지도·조립 ≈1.5초에 여유를 더했다.
  - 오케 안쪽 각 호출은 자기 타임아웃을 건다. 그래서 오케는 7초 안에 ①·②·③ 중 하나로 답한다.
  - ⏳ 실측(p95)으로 다시 정한다.

## 2. `POST /api/v1_0/turn/after` ← `Stop`

요청
```jsonc
{ "session_id": "…", "turn_token": "<before 가 준 것>", "last_assistant_message": "…", "stop_hook_active": false,
  "hook_event_name": "Stop" }
```

응답
```jsonc
{ }                                              // 통과(기본)
{ "decision": "block", "reason": "<고칠 이유>" } // 일관성 판정이 막을 때만 · stop_hook_active 면 막지 않는다
```

- 하는 일
  - 일관성 판정(R10): 정체성 누출 · 근거 없는 단정 · 근거 없는 수.
  - 원장: `recordTurn` · chat_snapshot 한 줄 · 도구 원장.
  - 기억 쓰기(`/read` → 조립 → 쓰기).
- **지금 오케가 「재기만 하고 막지 않는」 검사는 계약에서도 막지 않는다**(numberBacking · K0 준수 · 날조 조기탐지 = 센다). 막는 것은 사용자 결정으로 하나씩 켠다.
- `turn/after`가 실패해도 답은 이미 나갔다. 실행기는 「결정 없음」으로 넘긴다(v0.816 · Stop은 fail-open). 오케는 실패를 원장에 남긴다.
- 시간: `ELDA_HOOK_TIMEOUT_MS_Stop = 5000`. 기록은 fire-and-forget이라 답을 늦추지 않는다.

## 3. 입력 출처 거르기(H57 · S4.3 · 리소너 0e93b0b0d3 · 풀스택 합의)

- `origin.kind ≠ human`이면 `/read`를 부르지 않고 기억 쓰기에서 뺀다. `/coref` 문장 목록에서도 뺀다(기본).
- 그 턴 맥락은 짠다(두뇌는 알림을 알아야 한다). 기억에는 안 남긴다.
- 리소너 점검(S4.4)이 이것을 잰다.

## 4. 상태 — `turn_token`

- `turn/before`가 만든 그 턴의 상태(엔티티·근거·지도·판정·페르소나·판 표지)는 오케 메모리에 둔다. 키는 `turn_token`, 수명은 10분이다.
- `turn/after`가 이 토큰으로 찾는다. 못 찾으면(재시작 등) 기록만 하고 판정은 건너뛰며, 「모른다」 사유 `turn_state_lost`를 남긴다.
- 대화 기록(history)은 **실행기가 들고 있다.** 오케는 additionalContext에 대화 기록을 다시 넣지 않는다(중복 금지). 대신 기억 되살리기·주제 승계처럼 오케만 아는 것을 넣는다.

## 5. 고리 금지(인프라 4ca76e56eb)

- 오케 안쪽 호출은 관문의 **`elda` 두뇌를 부르지 않는다.** 안쪽은 `small`·`judge`·실제 모델 이름만 쓴다.
- 관문은 `x-elda-hop` 머리가 붙은 `elda` 요청을 400으로 막는다.

## 6. 다리(B)에도 같은 H57

- 두뇌 `elda`(f0661269)는 마지막 user 메시지에 H57 고정 문구가 있거나 `x-elda-origin`이 human이 아니면 `/chat`에 `origin_kind`를 넘긴다.
- 그러면 `/chat`은 `/read`·기억 쓰기·가리키는 말 맞대기를 끈다(dev 실측 `chat.origin.non_human_no_memory`).
- **섞인 턴**(H58 queue_only 묶음 + 사람 말이 한 메시지 · 리소너 5e9c3c75b1)은 ⓑ로 처리한다. 알림 덩어리(`<kind…>…</kind>` + 고정 문구)만 떼고, 남은 사람 말로 기억을 읽고 쓴다(`origin_kind:'mixed'` + `memory_text`). 두뇌가 보는 글은 그대로다. ⇒ 실행기가 알림을 따로 보내 주면(ⓐ) 더 깨끗하다. 전달 모양은 풀스택과 정한다.
- ✅ ③ 그 턴도 chat 한 줄에는 남는다(`ai.memory_gate`가 실린다). **다음 턴 조응 창은 그 표지를 보고 user 줄을 뺀다.** 섞인 턴은 사람 말만 들어간다. 관측 칸은 `memory_gate.window_dropped`(뺀 앞 턴 수)다. 두 길 모두 같다.

## 7. 구현 상태(S4.1-A · dev 실측 11-13)

- `src/router/v1_0/turn.ts`와 `src/core/harnessTurn.ts`로 구현했다. 처리기를 **디코드 자리에서 멈췄다가 잇는다**(`/chat` 판단 복사 0).
- 일반 턴: before 1.6초에 맥락과 `eldacore:small`을 낸다. after에서 `resumed`된 뒤 기억 쓰기까지 끝난다.
- 오케가 답을 정하는 턴(정체성 등): before가 block+reason을 낸다.
- v0.818 알림 칸: `prompt`는 사람 말만이고 `notifications[]`는 따로 온다.
  - 섞인 턴은 사람 말로만 기억을 쓴다.
  - 알림만 있는 턴은 기억 0이다.
- ⚠ **거인 갈래는 하네스 턴에서 건너뛴다**(`harness.giant_skipped`). 거인은 10~30초가 걸려 before 상한 8초를 넘는다(dev 실측 21초 → 504). 규격 길은 훅이 거인 **등급**을 고르고 실행기가 관문으로 부르는 것이다. 관문에 거인 등급(텍스트 chat/completions)이 생기면 그때 `brain`으로 낸다(인프라 청구).

## 8. 레인 — 도구 서빙 턴(풀스택 c4ad70bedb · a3d12413)

- 훅 설정 `headers`에 `x-elda-lane: serve-…`를 박으면(`elda-cli-hooks.serve.json`) before가 **맥락·두뇌를 바꾸지 않고** `{elda:{turn_token, lane}}`만 돌려준다.
- 위험 바닥 block+reason · 기억 · 원장은 그대로다.
- 채팅 갈래(거인 두뇌 · 채팅 지침 맥락)는 그 레인에서 건너뛴다.

## 9. 관측 칸 `memory_gate` (리소너 S4.4 정본)

- 칸: `{origin_kind, read, write, referents, memory_text(사람 말 글자|null), window_dropped(조응 창에서 뺀 앞 턴 수|null)}`
- 실리는 곳: `/chat` done · 다리 응답 `elda_memory_gate` · 훅 `turn/after` 응답 `elda.memory_gate`(block 턴은 before 응답).
- 리소너 자 `g_h57_origin_gate.py`(0b3114f)는 prod 14/14 GREEN이다(11-13). **S4.4는 닫혔다.**

## 10. 열린 것

- 집중 모드 거인 답(②)은 오케가 직접 부른다. 그림(시안·제안서)은 실행기 줄에 그림 칸이 없어서 `reason`에 글만 싣는다. 그림은 v1.000 뒤 `notice`·첨부 칸으로 정한다.
- 판 표지(`stamps`)를 실행기 기록(`turn_end.diag`)으로 넘길 칸이 없다. 지금은 오케 원장에만 남긴다.
- `/link` 판 표지 없음(테이 T1) — GPU 홀딩 뒤.
