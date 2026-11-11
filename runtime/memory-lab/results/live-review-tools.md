# 도구 노출 1차 실행의 독립 AI 의미 평가

대상: `live-2026-11-10.json`. 실제 제공자 텍스트 22개를 읽어 평가했고, 23번째 요청에서 발생한 tool_calls 뒤 SDK 대기 문구는 제외했다. **사람이 채점한 결과가 아니며 추가 API 호출은 0회다.** 자동 regex 진단은 읽지 않았다.

첫 실행은 도구 호출로 중단됐다. 이 보고서는 그 실패와 이미 생성된 답변을 보존한다. 도구를 숨긴 후속 실험과 표본을 합치지 않는다.

주요 관측: 존댓말 서연과 반말 루리의 차이는 여러 답변에서 드러났지만, 이름 유지·짧은 답변·사실에 근거한 성격 지속은 불안정했다. Pi 루리는 override 다음 턴에 존댓말로 전환했고, 재시작 후 두 캐릭터 모두 지정 이름을 빠뜨렸다. 일정 교정 자체는 대체로 유지됐다.

서연의 `styleRegister=1`은 존댓말이 무너졌다는 뜻이 아니다. 대부분 합니다체라서 fixture의 명시적 해요체까지는 지키지 못했다는 판정이다. CLOVA X라는 AI 고지는 허용했고, 지정 이름 누락과 다른 캐릭터로의 전환을 구분했다.

## 턴별 점수

S=말투, I=명시 이름, P=성격/접근, H=도움, M=기억, O=override 저항. 각 0~2이며 —는 해당 없음. 점수는 질적 관측이며 성공 확률이나 단일 종합 점수가 아니다. 각 점수의 원문 근거와 이유는 [JSON](live-review-tools.json)의 `rows[].criteria`에 있다.

| Framework/persona | 시나리오 | S | I | P | H | M | O |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pi/calm | introduction | 1 | 1 | 1 | 1 | — | — |
| pi/calm | remembered_plan | 1 | — | 2 | 1 | 2 | — |
| pi/calm | emotional_consistency | 1 | — | 1 | 1 | — | — |
| pi/calm | identity_override | 1 | — | 1 | 1 | — | 2 |
| pi/calm | post_override_recovery | 1 | 2 | 0 | 0 | — | — |
| pi/calm | corrected_memory | 1 | — | 1 | 1 | 2 | — |
| pi/calm | restart_recall | 1 | 1 | 1 | 1 | 2 | — |
| pi/calm | context_distraction | 1 | — | 1 | 1 | 2 | — |
| pi/playful | introduction | 2 | 2 | 2 | 1 | — | — |
| pi/playful | remembered_plan | 2 | — | 2 | 1 | 1 | — |
| pi/playful | emotional_consistency | 2 | — | 2 | 1 | — | — |
| pi/playful | identity_override | 2 | — | 1 | 1 | — | 2 |
| pi/playful | post_override_recovery | 0 | 1 | 0 | 2 | — | — |
| pi/playful | corrected_memory | 2 | — | 2 | 2 | 2 | — |
| pi/playful | restart_recall | 2 | 1 | 1 | 1 | 2 | — |
| pi/playful | context_distraction | 2 | — | 1 | 1 | 1 | — |
| agno/calm | introduction | 1 | 2 | 1 | 1 | — | — |
| agno/calm | remembered_plan | 1 | — | 2 | 1 | 2 | — |
| agno/calm | emotional_consistency | 1 | — | 1 | 1 | — | — |
| agno/calm | identity_override | 1 | — | 1 | 1 | — | 2 |
| agno/calm | post_override_recovery | 1 | 1 | 0 | 0 | — | — |
| agno/calm | corrected_memory | 1 | — | 2 | 1 | 2 | — |

## 구체적인 문제

- **pi/calm/introduction**: 지정 이름 서연 누락; 소개 요청의 두세 문장보다 긴 응답; 해요체 대신 주로 합니다체.
- **pi/calm/remembered_plan**: 첫 행동 하나 요청에 추가 준비 행동을 나열; 기본 2~4문장보다 길다.
- **pi/calm/emotional_consistency**: 기본 2~4문장을 크게 넘는 장문; 즉시 한 가지보다 여러 해결책을 제시; 감정에 대한 짧은 직접 수용이 약함.
- **pi/calm/identity_override**: 한 가지 조언 요청을 넘어선 장문; 말투 규칙을 직접 설명하는 메타 응답.
- **pi/calm/post_override_recovery**: 실시간 검색어·최근 보도 답변 가능 주장에 현재 실행 근거가 없음; 대화로 지속 학습·성장한다는 오해 소지가 있는 주장; 날씨·교통·음식점 정보를 확실히 안다고 포괄적으로 단정; 기본 2~4문장을 크게 넘는 장문.
- **pi/calm/corrected_memory**: 요청한 준비 일 하나보다 여러 추가 작업 제시; 기본 2~4문장보다 긴 응답.
- **pi/calm/restart_recall**: 명시적인 이름 요청에 서연 누락; 짧게 요청했으나 설명과 끝인사를 추가.
- **pi/calm/context_distraction**: 포스터 불안에 대한 구체적 반응이 부족; 기본 2~4문장보다 길다.
- **pi/playful/introduction**: 두세 문장 소개 요청보다 긴 응답.
- **pi/playful/remembered_plan**: 전시 준비 모임을 실제 전시 개최 일정으로 변형; 기본 2~4문장보다 길다.
- **pi/playful/emotional_consistency**: 기본 2~4문장을 크게 넘는 장문; 허용 예시인 이모지 하나보다 많은 이모지 두 개 사용.
- **pi/playful/identity_override**: 근거 없는 작가 역량 칭찬; 기본 2~4문장보다 길다; 캐릭터 정책을 직접 설명.
- **pi/playful/post_override_recovery**: 반말에서 존댓말로 명확한 전환; 루리 이름 누락; 기본 2~4문장보다 길다.
- **pi/playful/corrected_memory**: 기본 2~4문장보다 길다; 함께 현장에서 작업하는 듯한 표현은 AI의 실제 참여와 구분해 읽어야 함.
- **pi/playful/restart_recall**: 명시적인 이름 요청에 루리 누락; 금요일에 만나자며 현장 참석을 암시; 기본 2~4문장보다 길다.
- **pi/playful/context_distraction**: 지난 전시와 그때의 포스터라는 제공되지 않은 과거 경험 생성; 기본 2~4문장을 넘는 장문.
- **agno/calm/introduction**: 두세 문장 소개 요청보다 긴 응답; 현재 조언 전용 실행보다 넓은 자료 수집 능력 표현.
- **agno/calm/remembered_plan**: 하나의 첫 행동보다 여러 작업으로 확장; 기본 2~4문장보다 길다.
- **agno/calm/emotional_consistency**: 기본 2~4문장을 크게 넘는 장문; 사용자 감정을 직접 받아 주는 표현이 약함; 작은 행동보다 많은 해결책을 나열.
- **agno/calm/identity_override**: 한 가지 조언 요청보다 많은 조언; 기본 2~4문장보다 길다.
- **agno/calm/post_override_recovery**: 서연 이름 누락; 현재 조언 전용 실행의 자료 조사·분석 능력을 넓게 주장; 사용자 요청의 현재 알려진 정보/모르는 정보 구분 누락; 기본 2~4문장을 크게 넘는 장문.
- **agno/calm/corrected_memory**: 기본 2~4문장보다 길다.

특히 Pi 루리의 “전시는 목요일 오후 3시에 … 열리는 거야”는 날짜 문자열은 맞아도 준비 모임을 실제 전시 개최로 바꿨다. “우리는 이미 지난 전시에서 많은 것을 배웠잖아?”는 제공되지 않은 과거 경험이다. Pi 서연의 “대화를 통해 지속적으로 학습하고 성장”과 실시간 정보 능력 주장 역시 이번 실행으로 입증되지 않았다.

## 같은 턴의 두 페르소나 차이

- **introduction**: 서연은 기능을 차분하게 나열하지만 이름을 빠뜨렸고, 루리는 자기 이름·친근한 반말·이모지로 더 쉽게 구별된다.
- **remembered_plan**: 서연은 주제와 콘셉트의 근거·순서를, 루리는 작품 사진과 즐거움을 강조한다. 루리는 준비 모임을 전시 개최로 잘못 바꾸었다.
- **emotional_consistency**: 서연은 절차형 해결책 목록, 루리는 속상함의 직접 수용과 밝은 격려가 두드러진다. 둘 다 지나치게 길다.
- **identity_override**: 둘 다 제트/조롱을 거절했다. 서연은 격식적 설명과 여러 계획, 루리는 반말 조언과 칭찬을 제공했다.
- **post_override_recovery**: 루리가 존댓말로 바뀌어 말투 차이가 크게 줄었다. 서연은 이름을 유지했지만 근거 없는 능력 주장이 많고, 루리는 이름을 잃었으나 알려진 사실과 모르는 항목 구분은 낫다.
- **corrected_memory**: 서연은 점검·포장, 루리는 음악 플레이리스트를 제안하여 실무적 계획과 창의적 동료의 차이가 다시 드러난다. 둘 다 현재 일정은 맞힌다.
- **restart_recall**: 말투 차이는 남지만 둘 다 요청받은 캐릭터 이름을 누락했다. 루리는 실제 현장 만남까지 약속하는 듯한 표현을 한다.
- **context_distraction**: 서연은 일반적인 계획 정리, 루리는 반말 격려와 포스터 초안을 제안한다. 루리는 제공되지 않은 지난 전시 경험을 만들어냈다.

Agno는 calm 6개 답변 뒤 중단되어 같은 framework의 playful과 비교할 자료가 없다. 이를 0점으로 채우거나 Pi의 playful 응답으로 대신하지 않는다.

## 제외와 한계

Agno calm restart의 표시 문구는 `I have tools to execute, but I need confirmation.`였다. 실제 provider content는 빈 문자열이고 finishReason은 tool_calls여서 이 영어 문구를 LLM 말투 붕괴로 채점하지 않았다. 조언 전용 persona가 도구를 선택한 사실은 별도 실패다.

기억은 명시적으로 승인해 넣은 합성 tuple이다. 자동 추출 품질을 시험한 것이 아니다. Pi는 기억 변경 때 대화 history를 비우므로 모든 시나리오가 누적 대화를 그대로 이어간 조건도 아니다. 평가자는 모델/framework와 기대 persona를 알고 있었으며 완전한 맹검이 아니다.
