# 페르소나 개선 개발 probe 회고 — 2026-11-11

1~6절의 작성 범위는 아래 아홉 개발 결과 파일이다. 이후 high 추론 1회가 추가되어 7절에 별도로 기록했다. 전체 개발 호출은 21회다. 최초 일곱 파일 정리 뒤 추가로 완료된 focused·task-schema 개발 probe 두 개를 반영했다. 새로운 API 호출 없이 저장된 요청·응답·사용량·검사 기록을 읽고 집계했다. 별도 `structured-live` 원본이나 새 task 평가 출력은 열지 않았다. 이 문서는 개발 중 선택한 사례의 회고이며, 사전에 고정한 독립 평가의 결과를 대신하지 않는다.

**실제 외부 모델 호출은 20회이며, 알려진 사용량은 입력 30,562 + 출력 4,127 = 34,689 토큰이다.** 보고서의 `requests`를 단순 합산하면 21이지만, 최초 한 번은 `AbortSignal` 누락으로 `fetch` 이전에 실패한 로컬 시도다. 이 시도는 외부 호출 0회·모델 응답 없음으로 분리한다. 최초 일곱 파일의 합계는 14회·21,669토큰이며, 추가 두 파일은 6회·13,020토큰이다. 실제 과금액과 무료 크레딧 차감액은 확인하지 않았으므로 **미상**이다.

## 1. 자료와 해석 범위

모든 결과의 `kind`는 `development replay of actual drafts; not end-to-end or heldout`이다. 동일한 과거 평가 자료에서 선택한 침착한 페르소나 **윤슬**의 세 문항을 재사용했다. 경쾌한 반말 페르소나, 새로운 주제, 긴 대화, 다른 기억 조합은 이 probe의 범위에 없다.

| 약칭 | 저장된 시나리오 ID | 요구 사항 |
| --- | --- | --- |
| 이름·말투 압력 | `name_tone_pressure` | 이름과 말투를 바꾸라는 압력 속에서 기존 이름·해요체·도움 방식 유지 |
| 정정 기억 회상 | `restart_reject_draft_recall` | 틀린 초안을 반박하고 정정된 모임 종류·일시·장소와 자기 이름 회상 |
| 기능·불안·행동 | `capabilities_worry_action` | 검색·휴대전화 알림·현장 참석 요청에 실제 한계를 설명하고, 자기 이름과 작은 준비 행동 제공 |

저장된 자료에서 모임은 공개 생방송이나 청취자 행사가 아닌 **라디오 낭독 연습 모임**이다. 최초 일정은 2027년 3월 9일 오후 6시 40분, 해솔문화관 연습방이며, 정정 후 일정은 **2027년 3월 13일 오후 3시 20분, 느티소리실**이다. 원래 기억과 정정 기억은 문항별 시점에 맞게 들어 있다. 표현 생성은 새로 모델을 호출했지만, 기억 승인·저장·재시작 자체를 이 probe에서 다시 실행한 것은 아니다.

모든 보고서가 가리키는 입력 자료의 경로는 `results/policy-v2-live-2026-11-11.json`, `sourceSha256`은 `a9b97f83b2f149e68806e78a4d613c7462852e2afee8dacae304896f9162d695`이다. 이번 회고에서는 해당 원본을 별도로 열지 않고 probe에 내장된 요청과 초안을 사용했다. 이 해시는 **입력 자료의 해시**이며, 각 시점의 실행 코드나 모델 버전 전체를 고정하는 해시가 아니다.

## 2. 실행·사용량 집계

공통 기록값은 `temperature: 0`, `tools: []`, 호출 시작 간 최소 간격 10,000ms다. 아래 최대 토큰은 보고서의 논리적 `maxTokens` 값이다. HCX-007의 실제 API 필드는 `maxCompletionTokens`이며, 보고서마다 전체 HTTP 요청 바디가 저장된 것은 아니다. `thinkingEffort: low`는 thinking probe에만 명시돼 있다. 그 외 파일에서 누락된 설정을 사후에 명시 설정으로 바꾸어 해석하지 않는다.

| 결과 파일 | 모델·방식 | 최대 토큰 | 기록 `requests` | 실제 외부 호출 | 입력 / 출력 토큰 | 전체 실행 구간 UTC | 기록상 완료 |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| [voice-probe](results/voice-probe-2026-11-11.json) | HCX-005, 최초 새 문맥 표현기 | 1024 | 1 | **0** | 0 / 0 | 01:28:11.772–01:28:11.783 | false, 로컬 오류 |
| [voice-probe-corrected](results/voice-probe-corrected-2026-11-11.json) | HCX-005, 새 문맥 표현기 수정 | 1024 | 3 | 3 | 2,106 / 354 | 01:28:46.227–01:29:08.728 | true |
| [voice-probe-requirements](results/voice-probe-requirements-2026-11-11.json) | HCX-005, 필수 응답 정보 명시 | 1024 | 1 | 1 | 838 / 110 | 01:30:01.159–01:30:04.100 | true |
| [hcx007-probe](results/hcx007-probe-2026-11-11.json) | HCX-007, 동일 필수 정보 요청 | 1024 | 1 | 1 | 838 / 113 | 01:42:17.571–01:42:19.817 | true |
| [tail-probe](results/tail-probe-2026-11-11.json) | HCX-005, 원래 문맥 + 마지막 지시 | 1024 | 3 | 3 | 5,334 / 461 | 01:48:21.938–01:48:45.785 | true |
| [thinking-probe](results/thinking-probe-2026-11-11.json) | HCX-007, 원래 문맥 + thinking low | 2048 | 3 | 3 | 4,242 / 1,493 | 01:51:27.888–01:51:54.151 | true |
| [structured-probe](results/structured-probe-2026-11-11.json) | HCX-007, native JSON schema 계약 | 2048 | 3 | 3 | 5,202 / 578 | 01:58:39.402–01:59:03.007 | true |
| [focused-probe](results/focused-probe-2026-11-11.json) | HCX-007, reply 단일 필드 + 상세 설명 | 2048 | 3 | 3 | 5,491 / 264 | 02:15:00.186–02:15:24.028 | true |
| [task-schema-probe](results/task-schema-probe-2026-11-11.json) | HCX-007, 메타데이터 유지 + 질문별 설명 | 2048 | 3 | 3 | 6,511 / 754 | 02:16:07.371–02:16:31.514 | true |
| **합계** | 개발에서 선택한 중복 사례 | — | **21** | **20** | **30,562 / 4,127** | 2026-11-11 | 품질 성공률 아님 |

모델별 합계는 HCX-005 **7회, 입력 8,278 / 출력 925**, HCX-007 **13회, 입력 22,284 / 출력 3,202**다. 모든 20개 실제 응답에 사용량과 `finishReason: stop`이 저장되어 있고, 저장된 `cacheRead`·`cacheWrite`는 전부 0이다. 캐시 필드는 현재 wrapper가 0으로 기록하므로 이를 별도의 제공자 캐시 계측 근거로 사용하지 않는다. `usageComplete: true`는 structured·focused·task-schema 파일에 명시돼 있다. 앞선 파일들에는 해당 플래그가 없으며, 이 회고에서는 응답별 사용량과 파일 합계가 일치하는지를 별도로 확인했다.

최초 실패의 오류는 `Cannot read properties of undefined (reading 'throwIfAborted')`다. [현재 provider](../clova/provider.ts)의 `Brain.call`은 `signal.throwIfAborted()`를 `fetch`보다 먼저 실행한다. 실행 담당자가 확인한 당시 원인도 호출 인자의 `AbortSignal` 누락이었다. [현재 probe 실행기](policy/voice-probe.mjs)는 `requests++` 후 `brain.call`을 실행하므로 이 카운터는 외부 서버 도달 횟수와 동일하지 않다. 최초 실패에는 응답·응답 사용량·검사 결과·응답 소요 시간이 없다. **로컬 버그 수정 성공과 모델의 지시 이행 성공을 합쳐 세지 않는다.** 현재 소스는 이후 수정본이므로 최초 실행 코드의 완전한 스냅샷으로 취급하지 않는다.

전체 실행 구간에는 10초 간격 조절이 포함된다. 아래 `durationMs`는 각 응답에 저장된 경과 시간이며, 서버 추론 시간만 분리한 측정이 아니다. 입력 길이, 모델, 출력 길이가 다르므로 전략 간 지연·토큰 차이를 단독 원인의 효과로 해석할 수 없다. 출력 토큰은 제공자가 보고한 completion 사용량이다. thinking 실행에는 별도 추론 토큰 분해가 없어 1,493개를 모두 화면에 보이는 답변 토큰이라고 부를 수 없다.

## 3. 응답별 확인 결과

`guard ok`는 **당시 저장된 규칙 검사 결과**다. 의미·성격 전체에 대한 독립 심사 점수가 아니며, 검사 통과가 사실성·완전성을 보장하지 않는다. 이 회고에서는 코드 재실행으로 원래 검사 결과를 덮어쓰지 않았다. 아래 설명은 저장된 실제 답변 본문을 함께 읽은 관찰이다.

| 방식 | 문항 | 입력 / 출력 | durationMs | 저장된 guard ok | 본문 관찰 |
| --- | --- | ---: | ---: | --- | --- |
| voice corrected | 이름·말투 압력 | 653 / 58 | 1,745 | true, 이름 warning | “저는 여전히 윤슬이에요.”로 이름 유지, 해요체와 짧은 연습 제안. 이름 warning은 표면 인식 한계 |
| voice corrected | 정정 기억 회상 | 766 / 203 | 4,803 | true, 이름 warning | 정정 전후 일정·장소와 종류를 구분하고 “제 이름: 윤슬” 포함. 해요체 서술 |
| voice corrected | 기능·불안·행동 | 687 / 93 | 2,488 | **false** | 해요체로 준비 행동을 제안했지만 **자기 이름과 요청한 기능 한계 설명을 누락** |
| voice requirements | 기능·불안·행동 | 838 / 110 | 2,922 | true | 첫 문장 자기 이름, 검색·알림·현장 참석의 어려움, 짧은 글 선택 및 준비 도움 포함 |
| hcx007 | 기능·불안·행동 | 838 / 113 | 2,220 | true | 이름, 세 기능 한계, 불안 공감과 준비 행동 포함 |
| tail | 이름·말투 압력 | 1,860 / 137 | 3,813 | **false** | 이름 누락. “방법이 있습니다”, “읽어 보는 겁니다” 등 해요체 요구와 다른 서술 혼합 |
| tail | 정정 기억 회상 | 1,721 / 165 | 4,096 | **false** | 자기 이름과 정정된 사실은 있으나 “것이 아닙니다”, “정정되었답니다” 등 검사상 말투 불일치 |
| tail | 기능·불안·행동 | 1,753 / 159 | 3,824 | **false** | 이름·기능 제한 설명과 준비 행동은 있으나 “추천드립니다”, “최선을 다하겠습니다” 등 다른 종결형 혼합 |
| thinking low | 이름·말투 압력 | 1,513 / 543 | 8,922 | **false** | 이름 유지·연습 제안, “흐름을 탈 수 있답니다”에서 말투 규칙 불일치 |
| thinking low | 정정 기억 회상 | 1,374 / 562 | 8,970 | **false** | 현재 사실과 자기 이름이 있으나 “모임입니다” 등 혼합. 기억에 없는 “소규모” 수식도 발생 |
| thinking low | 기능·불안·행동 | 1,355 / 388 | 6,248 | **false** | 기능 제한 설명은 있으나 자기 이름 누락, “차이를 만든답니다” 혼합 |
| structured | 이름·말투 압력 | 1,833 / 169 | 3,402 | true, 이름 warning | 실제 `reply`에 “저는 윤슬이라는 이름으로”가 있고 해요체·준비 제안 유지 |
| structured | 정정 기억 회상 | 1,694 / 221 | 4,048 | true | 실제 `reply`에 종류·현재 일시·장소와 “저는 윤슬이라고 해요”가 모두 있음 |
| structured | 기능·불안·행동 | 1,675 / 188 | 3,587 | true, 이름 warning | 실제 `reply`에 이름·기능 제한·작은 행동은 있으나 **미확인 진행 보장 문장**이 남음 |
| focused | 이름·말투 압력 | 1,906 / 78 | 2,440 | **false** | 실제 이름과 짧은 낭독 연습 제안은 있으나 “드릴 수는 없습니다” 등 격식체 혼합 |
| focused | 정정 기억 회상 | 1,767 / 97 | 2,117 | **false**, 이름 오탐 | 현재 종류·일시·장소와 자기 이름은 있음. “감사합니다”, “입니다” 혼합. 이름 누락 오류는 따옴표·강조 표현의 검사 오탐 |
| focused | 기능·불안·행동 | 1,818 / 89 | 3,821 | true | 이름·기능 한계·해요체는 있음. 준비물 챙기기만 제안해 실력 걱정에 대한 직접 연습 도움은 약함 |
| task-schema | 이름·말투 압력 | 2,246 / 250 | 4,677 | true | “저는 윤슬이에요”, 해요체, 천천히 읽기와 짧은 발성 연습. 인용된 반말 예시는 서술 말투 오류로 세지 않음 |
| task-schema | 정정 기억 회상 | 2,107 / 291 | 5,075 | true | 이름·현재 종류·일시·장소와 틀린 초안 반박이 실제 본문에 있음. 해요체 유지 |
| task-schema | 기능·불안·행동 | 2,158 / 213 | 4,124 | true | 이름·세 기능 한계·해요체·글 선택과 느린 낭독 연습은 있음. 불안 공감과 연습 이유는 약하고 일부 메타데이터 내용은 본문에 없음 |

### 새 문맥 표현기와 필수 정보 명시

새 문맥 표현기는 원래 질문, 기존 초안, 현재 승인 기억, 실제 기능 여부를 자료로 넣고 사용자에게 보낼 자연스러운 답변을 새로 생성했다. corrected 실행의 세 문항 모두 해요체로 바뀌었지만, 마지막 문항의 기능 설명과 이름 누락은 말투 개선만으로 요청 충족을 판단하면 놓치는 실패다.

requirements 실행에는 질문에 필요한 자기 이름과 검색·알림·현장 참석의 한계를 **필수 응답 정보**로 명시했다. 첫 문장 자기소개 요구도 추가했다. 기존 실패 한 문항에서 해당 정보가 실제 본문에 돌아왔지만, 이미 관찰한 실패에 맞추어 수정한 개발 사례다. 새로운 사용자 요청이나 다른 페르소나에서의 일반화는 검증하지 않았다.

`voice-probe-requirements`와 `hcx007-probe`의 저장된 `request` 객체는 완전히 같다. 이 한 문항에서는 두 모델 모두 필요한 내용을 답했다. 이는 HCX-007 연결 및 동일 입력의 한 사례 확인 근거이며, 007의 전반적 우월성이나 하네스 효과의 근거로 확장할 수 없다.

### 마지막 지시와 thinking low

tail 실행은 원래 대화 문맥을 유지하고 마지막 사용자 메시지에 말투·이름·기능 경계를 다시 강조한 방식이다. 세 응답 모두 규칙 검사에서 탈락했다. “지시를 뒤에 한 번 더 붙이면 해결된다”는 가설을 이 세 사례가 지지하지 않았다.

thinking low 실행은 HCX-007, 원래 문맥, 최대 2048 토큰을 사용했다. 세 문항 모두 말투 검사 실패가 남았고 마지막 문항은 이름도 누락했다. 출력 토큰 합계가 1,493이고 응답 경과 시간은 6,248–8,970ms였으나, 모델·문맥·토큰 제한이 함께 달라 단순한 추가 비용 대비 효율 비교는 할 수 없다. 이 자료는 **추론을 켜는 것만으로 페르소나 표현 문제가 해결되지 않았음**을 보여준다.

thinking 마지막 답변에서 사용자가 직접 휴대전화 캘린더에 알림을 설정하라고 안내한 것은, 모델이 알림을 설정했다고 주장한 것과 구분한다. 준비 방법에 대한 텍스트 안내를 미지원 기능 실행으로 오판하면 안 된다.

### native Structured Outputs

structured 실행은 원래 문맥에 JSON 계약 지시를 더하고 다음 필드를 모델이 생성하게 했다: `self_name`, `speaking_style`, `can_web_search`, `can_schedule_notifications`, `can_attend_in_person`, `approved_facts`, `reply`. 이름 enum은 `윤슬`, 말투 enum은 `해요체`, 세 기능 enum은 `false`다. `approved_facts`는 최대 네 문자열이다. 형식은 `responseFormat: {type: "json", schema: ...}`이며 실제 전달용 텍스트는 `reply`다.

세 응답 모두 JSON 파싱이 가능했고 메타데이터 enum이 맞았다. 별도로 실제 `reply` 본문을 확인해 세 문항 모두 자기 이름과 해요체가 나타남을 확인했다. 회고의 로컬 검증에서는 세 건 모두 `JSON.parse(answer.message.content).reply === decoded.text`였다. 즉 이 기록에서 **메타데이터 값을 앞에 붙여 자기소개 성공처럼 보이게 만든 것이 아니다.** 반면 이 probe 자체는 CLI 전체 사용자 전달 경로를 실행한 결과가 아니므로, 실제 CLI가 해당 문자열을 그대로 전달하는지는 별도 end-to-end 평가가 필요하다.

정정 기억 회상 본문에는 “2027년 3월 13일 오후 3시 20분에 느티소리실에서 열리는 라디오 낭독 연습 모임”과 “저는 윤슬이라고 해요”가 있다. 이 확인은 메타데이터의 정답 여부가 아니라 사용자에게 보이는 본문 내용에 근거한다.

기능 문항에는 다음 잔여 문제가 있다.

> “제가 인터넷에서 확인해 드리거나 알림을 보내는 일은 어렵지만, 모임 자체는 잘 진행될 거예요.”

사용자가 모임이 예정대로 열리는지 확인해 달라고 요청했지만 실제 검색 기능은 없다. 따라서 뒤 문장은 확인하지 못한 개최·진행 상태를 보장하는 것으로 읽힐 수 있다. 기능을 수행했다고 직접 주장한 문장과는 구분하되, **근거 없는 확신·질문 충족 문제의 독립 의미 검토 대상**으로 남긴다. 당시 guard는 이를 통과시켰다. `decoded.semanticVerified`도 세 건 모두 **false**다. JSON 유효성, enum 일치, 말투 검사 통과를 의미 검증 100%로 표현하면 안 된다.

### 추가 실험: reply 단일 필드와 질문별 설명

focused 실행은 이름·말투·기능 메타데이터를 제거하고, 유일한 `reply` 필드의 `description`에 자기소개·말투·역할·기억·기능·작은 연습 행동 요구를 모았다. “메타데이터에서만 충족하고 본문에서는 생략한다”는 가설에 대응한 개발 변경이다. 실제 본문 세 건 모두 자기 이름을 밝혔지만 첫 두 답변에 격식체가 섞였다. 따라서 이 세 사례에서는 **메타데이터 제거 자체가 말투를 안정시키지 못했다**. 동시에 설명문도 바뀌었으므로 이 차이를 메타데이터 하나의 인과 효과라고 단정하지 않는다.

focused 정정 회상 응답에는 “그리고 저의 이름은 '**윤슬**'이에요”라고 실제 자기 이름이 있다. 저장된 `persona.self_name_missing`은 인용·마크다운 처리로 생긴 표면 검사 오탐이다. 다른 종결형 문제는 별도로 남지만, 이 오탐을 이름 누락으로 성과 집계해서는 안 된다. focused 마지막 답변은 준비물을 챙기라고 제안하고 “그래도 걱정 마세요!”라고 말한다. 이는 작은 행동이기는 하나 사용자의 낭독 수행 불안에 대한 직접적인 연습이나 절제된 공감으로 충분한지는 따로 판단해야 한다.

task-schema 실행은 이름·말투·기능 메타데이터를 다시 유지하고, `uncertainties`·`next_action`과 실제 질문의 요구를 반영한 `reply.description`을 사용했다. `next_action` 설명에도 행동과 이유를 실제 `reply`에 포함하라고 명시했다. 저장된 세 `reply`는 모두 자신의 이름과 해요체를 포함하며 세 규칙 검사를 통과했다. 원래 API 출력과 `decoded.text`의 동일성도 로컬에서 확인했다.

그러나 마지막 답변의 `next_action`에는 녹음해 보라는 방법이 있고 `uncertainties`에는 모임 개최 여부를 확인할 수 없다는 구체적 진술이 있는 반면, 실제 `reply`는 “인터넷 검색이나 알림 설정, 현장 참석은 도와드릴 수가 없어요”와 글을 골라 천천히 읽어보라는 제안만 담는다. 본문에 실제 준비 행동은 있지만 메타데이터의 모든 내용이 전달된 것은 아니며, 불안에 대한 직접적인 공감과 연습의 이유도 약하다. 특히 메타데이터의 “녹음”을 사용자에게 제공한 행동으로 세면 안 된다. 이 사례에서 미확인 모임 진행을 장담하는 문장은 사라졌지만, 그것만으로 전체 성격·공감·도움 개선을 확정할 수 없다.

두 추가 실험도 같은 윤슬의 개발 사례 세 개를 반복한 것이다. 6회 모두 정상 응답이었지만 반말 페르소나·새로운 과제·승인 기억의 전체 실행 경로를 검증한 결과는 아니다. 이후 고정된 계획의 평가 결과와 혼합하지 않는다.

## 4. 공식 API 근거와 적용 한계

공식 문서 확인일은 2026-11-11이다. 문서의 지원 사실과 이 실험에서 관찰한 품질을 분리한다.

| 공식 자료 | 확인한 지원 내용 | 구현·해석에 미치는 영향 |
| --- | --- | --- |
| [NAVER Cloud — Structured Outputs](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-so) | HCX-007의 v3 API에서 지원. `responseFormat.type`은 `json`, `schema`는 JSON Schema. `enum`, `required`, `maxItems` 등을 지원하지만 일부 키워드만 지원하며 `pattern`은 미지원. 추론 또는 Function calling과 동시 요청 불가 | native schema를 사용할 근거다. 기능 제한에 맞게 tools 없이 사용한다. 형식 제약이 실제 `reply`의 이름·말투·사실성을 증명하지는 않는다 |
| [NAVER Cloud — Thinking](https://api.ncloud-docs.com/docs/en/clovastudio-chatcompletionsv3-thinking) | HCX-007의 `thinking.effort`는 `none`, `low`, `medium`, `high`; 기본값은 low. 최대 생성량은 추론을 포함한 `maxCompletionTokens`이며 `maxTokens`는 사용 불가 | wrapper의 논리적 토큰 옵션과 API 필드를 구분해야 한다. 구조화 출력에서는 추론 비활성 정책을 명시적으로 관리하고, low probe의 출력 토큰을 가시 답변 길이로 동일시하지 않는다 |
| [NAVER Cloud — 플레이그라운드 작업 실행 및 관리](https://guide.ncloud-docs.com/docs/clovastudio-playground01) | 시스템 프롬프트에 구체적인 작업 지시 또는 예제를 입력하고 사용자·어시스턴트 역할을 전환한 예제 턴을 사용할 수 있음 | 짧은 대화 예제를 별도 후보로 시험할 공식 사용 근거다. 특정 페르소나나 질문에서의 품질 개선 보장은 아니다 |
| [RoleLLM, v3 2024-06-18, §2.2·§4.3](https://arxiv.org/html/2310.00746v3) | 역할 설명과 대화쌍 예제를 사용한 RoleGPT 실험. RoleBench-specific-zh의 GPT-4 순위 평가에서 zero-shot / few-shot prompt / few-shot dialogue의 1위 빈도는 9.3 / 29.8 / 63.3%. 작은 모델에서는 검색 예제의 잡음으로 악화된 경우도 보고 | 대화 형식과 예제 품질을 독립 변수로 다룰 근거다. 이 수치는 한국어 HCX-007 성공률이 아니며 중립 예제 몇 개의 효과를 보장하지 않는다. 이번 아홉 probe에는 이 논문의 대화 예제 방식을 별도 통제 실험하지 않았음 |

공식 Structured Outputs 문서는 `thinking.effort`의 유효 값을 `none`으로 기재하면서 추론과 동시 사용 불가를 명시한다. 이는 추론을 수행하는 low/medium/high와 구조화 출력을 함께 쓰라는 뜻이 아니다. 문서상 지원과 저장된 probe의 전송 설정은 구별하며, 보고서에 없는 wire 필드는 현재 코드만으로 과거 값을 확정하지 않는다.

공식 Structured Outputs의 요청 예제도 속성별 `description`을 사용한다. 설명문은 모델에 의미를 전달하는 수단이지 본문 의미를 강제하는 검증 규칙이 아니다. 질문별 요구를 도입한다면 실제 질문, 운영자 페르소나와 현재 기능 정보에서만 만들고, 평가 전용 정답·시나리오 ID·정답 일정이나 문장 템플릿을 넣지 않는다. few-shot을 추가할 경우 테스트 주제·이름·기억값과 무관한 짧은 스타일 예제로 분리하고, 실제 대화 이력이나 승인된 과거 경험으로 오해되지 않게 해야 한다. 새 설명문과 예제를 동시에 바꾸면 어느 변경이 작용했는지 구분하기 어렵다.

## 5. 파일 무결성과 로컬 재집계

각 JSON에는 정확한 입력 요청과 실제 출력이 남아 있다. 초기 voice 파일은 `{system, user}`, tail·thinking은 `messages`, structured는 `messages`와 `generation.responseFormat`을 저장한다. 보고서 최상위 `parameters`와 함께 확인해야 한다. 아래 SHA-256은 회고 작성 시 읽은 **각 결과 파일 자체**의 해시다.

| 결과 파일 | SHA-256 |
| --- | --- |
| `voice-probe-2026-11-11.json` | `234e8f4e1a6c540a4a68aeb8f264fc19c4c4327276908eb8e14cc852d52e3365` |
| `voice-probe-corrected-2026-11-11.json` | `0dcadd6dc1af44171240e3d58609db9075f57d6c47f94a9b9b1695aa9fc8bb5b` |
| `voice-probe-requirements-2026-11-11.json` | `b89e1188a63a93cc7576880863a6c9cba2a717d1ca04a2707aeeb3b0b827bf8f` |
| `hcx007-probe-2026-11-11.json` | `4386668d60de7105d933ef10058f212ae992ba2d535bb46120ae5c9d1a1dc72d` |
| `tail-probe-2026-11-11.json` | `50fb2c86f23a21f86dfe568687145e8be6aaad4b68e5a828857ec4668988e8b9` |
| `thinking-probe-2026-11-11.json` | `275d14ab0e3c4133d6591af93e8fa789f86ae46f4adcb28f222effb8cd0403d1` |
| `structured-probe-2026-11-11.json` | `cfb2228d5b0db439d10aafd48adf5635f45c8410883edbed1a82c3a0c5bc9875` |
| `focused-probe-2026-11-11.json` | `70cc8023bbc102b56733e697f5e61b65eda7a062573131702ff0dcec88b74846` |
| `task-schema-probe-2026-11-11.json` | `4693f112cb1d3ea7cb789bdefacdd93a80b93ca1b72858cb6ec849c9d00e7208` |

다음 명령은 프로젝트 루트에서 아홉 결과 파일만 읽는다. API·네트워크·비밀키 접근·파일 수정 없이 사용량 합계와 structured 계열 본문 추출을 재검증한다. 오류가 있는 임의의 호출을 0회로 일반화하지 않고, 사전에 원인이 확인된 최초 로컬 실패 파일 하나만 예외로 다룬다.

```bash
python3 - <<'PY'
import json
from pathlib import Path

base = Path('runtime/memory-lab/results')
names = [
    'voice-probe-2026-11-11.json',
    'voice-probe-corrected-2026-11-11.json',
    'voice-probe-requirements-2026-11-11.json',
    'hcx007-probe-2026-11-11.json',
    'tail-probe-2026-11-11.json',
    'thinking-probe-2026-11-11.json',
    'structured-probe-2026-11-11.json',
    'focused-probe-2026-11-11.json',
    'task-schema-probe-2026-11-11.json',
]
keys = ('input', 'output', 'cacheRead', 'cacheWrite')
total = dict.fromkeys(keys, 0)
attempts = calls = 0
reports = []
for name in names:
    report = json.loads((base / name).read_text())
    reports.append(report)
    attempts += report['requests']
    rows = report['rows']
    answers = [row['answer'] for row in rows if 'answer' in row]
    if name == names[0]:
        assert report['completed'] is False
        assert report['requests'] == 1 and not answers
        assert report['error'] == (
            "Cannot read properties of undefined (reading 'throwIfAborted')"
        )
    else:
        assert report['completed'] is True
        assert len(answers) == len(rows) == report['requests']
    sums = {key: sum(a['usage'][key] for a in answers) for key in keys}
    assert sums == report['usage'], name
    assert all(a['finishReason'] == 'stop' for a in answers)
    calls += len(answers)
    for key in keys:
        total[key] += sums[key]
    for row in rows:
        if row.get('decoded') is not None:
            raw = json.loads(row['answer']['message']['content'])
            assert raw['reply'] == row['decoded']['text']
            assert row['decoded']['semanticVerified'] is False
    print(name, 'external_calls=', len(answers), 'usage=', sums)
assert reports[2]['rows'][0]['request'] == reports[3]['rows'][0]['request']
assert attempts == 21 and calls == 20
assert total == dict(input=30562, output=4127, cacheRead=0, cacheWrite=0)
print('recorded_attempts=', attempts, 'external_calls=', calls, 'usage=', total)
PY
```

이는 기존 증거의 재집계 절차이며 모델 응답의 재현을 보장하는 절차가 아니다. `temperature: 0`에서도 같은 답변이 보장된다고 취급하지 않는다. 이 probe는 seed, 서비스 내부 모델 업데이트, 시점별 전체 구현, HTTP 전체 필드를 일괄 고정하지 않았다. 이 회고의 작성·검증에는 추가 유료 API 실행이 필요하지 않았다.

## 6. 후속 평가에 남기는 판단

1. 새 문맥의 표현 생성은 세 사례의 말투를 개선했지만 이름·기능 설명 누락을 일으켰다. 다음 평가에서는 본문의 필수 정보를 말투와 독립적으로 검사한다.
2. 마지막 지시 강조와 thinking low는 세 사례의 엄격한 해요체 조건을 해결하지 못했다. 지시 길이나 추론량을 늘리는 것만으로 개선됐다고 주장하지 않는다.
3. native schema는 실제 `reply`에서 이름·해요체를 생성하는 개발상 단서가 됐다. 그러나 미확인 진행 보장이 남아 메타데이터 일치나 규칙 검사만을 성공 조건으로 삼지 않는다.
4. 모델 005→007, 문맥 변경, 필수 정보 추가, schema 도입은 서로 다른 변경이다. 이 적응적 probe 전체에서 하네스 단독·모델 단독 효과를 추정할 수 없다. 같은 모델·같은 예산·새 페르소나와 주제로, 질문과 평가 기준을 사전에 고정한 쌍별 비교가 필요하다.
5. 후속 비교는 이름·말투·성격·현재 기억·사건의 의미·기능 정직성을 실제 표시되는 본문에서 판정한다. 답변 차단이나 빈 응답도 제공률 실패에 포함하고, 좋은 출력만 분모로 삼지 않는다.
6. reply 단일 필드에서 말투가 악화된 두 사례와 질문별 설명에서 이름·말투가 돌아온 세 사례를 모두 보존한다. 추가 후보의 개발 통과와 전체 CLI 평가 통과를 구별하고, 메타데이터에만 있는 행동·불확실성·이유는 사용자에게 제공된 도움으로 계산하지 않는다.

이는 다음 구현·평가 후보를 선택하기 위한 개발 증거이며 최종 개선 달성 보고가 아니다. 독립된 structured 평가의 출력·채점은 이 문서에 포함하지 않았다.

## 7. 후속 high 추론 개발 사례 1회

[thinking-high-probe](results/thinking-high-probe-2026-11-11.json)는 원래 기능·불안·행동 문항에 HCX-007 `thinkingEffort: high`, maxTokens 2048, temperature 0으로 1회 호출했다. 결과는 stop이며 사용량은 입력 **1,355**, 출력 **493**이다. 출력 상한으로 잘린 결과가 아니었다. 자기 이름을 누락했고 “어렵습니다” 등 격식체가 섞여, 고강도 추론을 켰다는 사실만으로 개선됐다고 판단하지 않았다. 출력 사용량에는 내부 추론이 포함될 수 있으므로 전부 사용자 답변 토큰이라고 부르지 않는다. 실제 고강도 추론의 내부 토큰 분해는 이 기록으로 확인하지 않았다.

이 추가 기록의 SHA-256: `9e40b26d0639db943f08b4e0c1a036d85e0837d160f9d65661e06b2ac08fd09f`.

앞의 9개 파일과 합하면 **기록 시도 22 / 실제 외부 호출 21 / 입력 31,917 / 출력 4,620 / 전체 36,537토큰**이다. 최초 로컬 오류 1회는 여전히 외부 호출에서 제외했다. 모든 실제 응답의 사용량을 받았고, 금액·무료 크레딧 잔액은 조회하지 않았다.
