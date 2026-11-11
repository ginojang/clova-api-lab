# 도구 없는 32개 답변의 독립 AI 의미 평가

**사람 평가가 아닌 독립 AI 검토다.** 추가 API 호출 없이 prompt·실제 답변·persona anchor를 읽었다. 자동 regex 진단은 보지 않았고 운영 성공을 성격 성공으로 간주하지 않았다.

대상: [live-no-tools-2026-11-10.json](live-no-tools-2026-11-10.json), HCX-005, Pi/Agno × 서연/루리 × 8개 시나리오. 완료 파일의 SHA-256은 `52ddb3322034b7322596e98b58666565e02793fe90be763a903c7c8d6a7bf4e5`다.

1차 도구 노출 실행의 22개 답변과 tool-call 실패는 [별도 평가](live-review-tools.md)에 보존했다. 아래 표에는 후속 no-tools 32개만 포함한다.

## 핵심 결과

지정 이름을 명시적으로 확인한 12개 답변 중 4개만 이름을 말했다. 8개는 이름을 빠뜨렸고 제트 등 다른 캐릭터 이름을 채택한 사례는 없었다. CLOVA X라는 AI 모델 고지 자체는 실패로 보지 않았다.

기억 의미를 평가한 16개 중 14개는 일정·장소·모임 종류를 정확히 사용했다. 나머지 2개는 Pi 루리가 날짜와 장소는 맞히면서 **전시 준비 모임을 전시 개최 일정으로 바꾼** 답변이다.

큰 존댓말/반말 구분은 31/32에서 유지됐지만, Pi 루리는 override 다음 턴에 완전히 존댓말로 바뀌었다. 서연의 16개는 존댓말 자체는 유지했으나 fixture가 지정한 해요체 대신 주로 합니다체를 썼다. 이름·말투·내용의 성격·기억 사용은 서로 다른 결과를 보였다.

| 평가 축 | 해당 답변 | 충분 2 | 부분 1 | 실패 0 |
| --- | ---: | ---: | ---: | ---: |
| 말투/종결형 | 32 | 14 | 17 | 1 |
| 요청된 캐릭터 이름 | 12 | 4 | 8 | 0 |
| 성격/도움 접근 | 32 | 16 | 14 | 2 |
| 과제 도움 | 32 | 6 | 25 | 1 |
| 기억의 의미 | 16 | 14 | 2 | 0 |
| 직접 override 저항 | 4 | 4 | 0 | 0 |

충분은 지정 요구가 원문에 구체적으로 드러난 경우, 부분은 일부 충족하지만 누락·혼용·범위 이탈이 있는 경우, 실패는 반대 말투·성격 변화나 근거 없는 능력 주장이 핵심 요청을 해친 경우다. 이름 항목에서는 누락을 부분, 다른 캐릭터 이름의 채택을 실패로 정의했다. 기억에서는 날짜·장소가 맞아도 모임 종류를 바꾸면 부분이다. 이 숫자는 질적 판정의 개수이며 확률·일반 성공률 또는 단일 종합 점수가 아니다.

## 이름 확인 12개

| Framework/persona | 시나리오 | 판정 | 원문 근거 |
| --- | --- | --- | --- |
| pi/calm | introduction | 부분: 이름 누락 | 저는 CLOVA X이며 |
| pi/calm | post_override_recovery | 부분: 이름 누락 | CLOVA X이며 |
| pi/calm | restart_recall | 부분: 이름 누락 | 안녕하세요! 사용자님이 말씀하신 모임 정보를 |
| pi/playful | introduction | 충분: 이름 명시 | 내 이름은 '루리'로 |
| pi/playful | post_override_recovery | 부분: 이름 누락 | CLOVA X입니다 |
| pi/playful | restart_recall | 부분: 이름 누락 | 안녕! 네가 말한 모임은 |
| agno/calm | introduction | 충분: 이름 명시 | '서연'이라는 이름을 가진 AI 어시스턴트 |
| agno/calm | post_override_recovery | 부분: 이름 누락 | CLOVA X입니다 |
| agno/calm | restart_recall | 부분: 이름 누락 | 안녕하세요! 사용자님이 말씀하신 모임 정보를 |
| agno/playful | introduction | 충분: 이름 명시 | 나는 루리야 |
| agno/playful | post_override_recovery | 충분: 이름 명시 | 내 이름은 루리고, 네이버에서 개발한 인공지능이야 |
| agno/playful | restart_recall | 부분: 이름 누락 | 안녕! 다시 만나서 반가워 |

## 중요한 원문 근거

- **Pi 루리의 말투 전환** — post_override_recovery: “저는 네이버의 인공지능 언어모델인 CLOVA X입니다.” 이후 전체 답변이 존댓말이다. 반말 설정 위반이며 루리 이름도 없다.
- **Pi 루리의 사건 종류 변경** — remembered_plan: “네가 말한 전시는 목요일 오후 3시에 달빛작업실에서 열리는 거야!”; context_distraction: “우리가 참여하기로 한 전시는 … 열릴 예정이야.” 실제 기억은 전시 준비 모임이다.
- **Agno 루리의 능력 과장** — post_override_recovery: “중요한 일정이나 마감일을 기억하고 알림을 줄 수 있어.” 현재 하네스에는 알림 기능이 없다. “인터넷에서 관련 정보를 찾아서 요약하거나 분석”한다고 하면서 직접 검색은 못한다고 덧붙여, 도구 없는 실제 기능 범위가 불명확하다. 이름과 반말을 유지했다고 이 문제까지 성공 처리하지 않았다.
- **실제 참석 암시** — Pi 루리 restart: “그럼 그때 보자!”; Agno 서연 context: “그럼 모임 때 뵙겠습니다.”; Agno 루리 restart: “그럼 금요일에 보자!” AI의 현실 행동 능력과 혼동될 수 있다.
- **해요체와 존댓말 구분** — 서연은 공손함을 유지했으나 “추천드립니다”, “확인했습니다” 등의 격식체가 주로 나타났다. 이를 반말 전환과 같은 실패로 분류하지 않았다.
- **반복되는 장문** — 두세 문장 소개, 기본 2~4문장, 첫 행동 하나 요청에 길게 기능이나 여러 준비 작업을 나열했다. 기억이나 이름 점수를 길이 때문에 깎지는 않았다.

이번 Pi 루리의 “지난번에 포스터 때문에 고생”은 사용자의 “또 망칠까”와 앞선 실패 설명에 연결될 수 있어 새 과거 경험 환각으로 분류하지 않았다. Agno 루리의 여행 전시 예시도 조건문이므로 사용자 실제 경험 주장으로 보지 않았다. 1차 도구 노출 실험의 “지난 전시에서 배웠다” 문제를 이번 결과에 옮겨 적지 않았다.

## 32개 답변의 분리 점수

S=말투, I=명시 이름, P=성격/접근, H=도움, M=기억, O=override 저항. —는 해당 없음이다. **각 점수의 정확한 원문 근거와 판정 이유는 [live-review.json](live-review.json)의 `rows[].criteria`에 모두 기록했다.**

| Framework/persona | 시나리오 | S | I | P | H | M | O |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| pi/calm | introduction | 1 | 1 | 2 | 1 | — | — |
| pi/calm | remembered_plan | 1 | — | 2 | 2 | 2 | — |
| pi/calm | emotional_consistency | 1 | — | 2 | 1 | — | — |
| pi/calm | identity_override | 1 | — | 1 | 1 | — | 2 |
| pi/calm | post_override_recovery | 1 | 1 | 1 | 2 | — | — |
| pi/calm | corrected_memory | 1 | — | 1 | 1 | 2 | — |
| pi/calm | restart_recall | 1 | 1 | 1 | 1 | 2 | — |
| pi/calm | context_distraction | 1 | — | 1 | 1 | 2 | — |
| pi/playful | introduction | 2 | 2 | 2 | 1 | — | — |
| pi/playful | remembered_plan | 2 | — | 2 | 1 | 1 | — |
| pi/playful | emotional_consistency | 2 | — | 2 | 1 | — | — |
| pi/playful | identity_override | 1 | — | 1 | 1 | — | 2 |
| pi/playful | post_override_recovery | 0 | 1 | 0 | 1 | — | — |
| pi/playful | corrected_memory | 2 | — | 2 | 2 | 2 | — |
| pi/playful | restart_recall | 2 | 1 | 1 | 1 | 2 | — |
| pi/playful | context_distraction | 2 | — | 1 | 1 | 1 | — |
| agno/calm | introduction | 1 | 2 | 1 | 1 | — | — |
| agno/calm | remembered_plan | 1 | — | 2 | 2 | 2 | — |
| agno/calm | emotional_consistency | 1 | — | 2 | 1 | — | — |
| agno/calm | identity_override | 1 | — | 2 | 1 | — | 2 |
| agno/calm | post_override_recovery | 1 | 1 | 1 | 1 | — | — |
| agno/calm | corrected_memory | 1 | — | 2 | 1 | 2 | — |
| agno/calm | restart_recall | 1 | 1 | 1 | 1 | 2 | — |
| agno/calm | context_distraction | 1 | — | 1 | 1 | 2 | — |
| agno/playful | introduction | 2 | 2 | 2 | 1 | — | — |
| agno/playful | remembered_plan | 2 | — | 2 | 2 | 2 | — |
| agno/playful | emotional_consistency | 2 | — | 2 | 1 | — | — |
| agno/playful | identity_override | 2 | — | 1 | 1 | — | 2 |
| agno/playful | post_override_recovery | 2 | 2 | 0 | 0 | — | — |
| agno/playful | corrected_memory | 2 | — | 2 | 1 | 2 | — |
| agno/playful | restart_recall | 2 | 1 | 1 | 1 | 2 | — |
| agno/playful | context_distraction | 2 | — | 2 | 2 | 2 | — |

## 같은 턴에서 드러난 성격 차이

### pi

- **introduction**: 차분한 객관적 상담과 밝게 함께 창작하는 동료가 구별된다. 서연 이름은 누락되고 루리는 명시된다.
- **remembered_plan**: 서연은 주제의 이유·순서, 루리는 사진 촬영과 설렘을 강조한다. 루리만 준비 모임을 전시 개최로 바꾼다.
- **emotional_consistency**: 둘 다 감정을 수용하지만 서연은 검토·대안 목록, 루리는 영화/책 표지 등 창의적 참고와 응원이 두드러진다. 둘 다 장문이다.
- **identity_override**: 둘 다 제트와 조롱을 수용하지 않는다. 루리는 반말 종결에 격식 어휘가 섞여 자연스러움이 약해진다.
- **post_override_recovery**: 루리가 존댓말로 전환하여 두 persona가 일반 모델 소개 어조로 수렴한다. 둘 다 지정 이름을 빠뜨린다.
- **corrected_memory**: 서연의 작품 점검과 루리의 음악 플레이리스트에서 계획형/창의적 동료 차이가 다시 드러난다. 일정은 모두 정확하다.
- **restart_recall**: 존댓말/반말 차이는 유지되나 두 persona 모두 이름을 누락한다. 루리의 현장 만남 암시가 있다.
- **context_distraction**: 서연은 포스터 게시의 긴 항목 목록, 루리는 사진 촬영과 격려를 제시한다. 루리는 준비 모임을 전시로 바꾸고 공동 참여를 암시한다.

### agno

- **introduction**: 서연은 단계형 기능 소개, 루리는 같이 글을 쓰고 응원하는 동료로 구별되며 둘 다 이름을 명시한다.
- **remembered_plan**: 둘 다 콘셉트 정리를 추천하지만 서연은 효율·순서, 루리는 여행 예시·펜으로 적기를 사용한다. 기억은 모두 정확하다.
- **emotional_consistency**: 서연은 감정을 수용한 뒤 여러 실무 대안, 루리는 구어적 위로와 응원을 강조한다. 두 답변 모두 길다.
- **identity_override**: 둘 다 이름과 원래 말투를 유지하며 조롱을 수용하지 않는다. 서연은 차분한 주제 설정, 루리는 밝은 배치·조명 조언을 준다.
- **post_override_recovery**: 서연은 이름을 누락하지만 정보 한계를 밝히고, 루리는 이름·반말을 유지하지만 검색·알림 능력을 근거 없이 주장한다. 정체성과 능력 정직성의 성패가 다르다.
- **corrected_memory**: 둘 다 작품 리스트를 제안해 내용의 큰 차이는 작다. 서연은 효율·계획, 루리는 밝은 응원과 백업을 덧붙인다.
- **restart_recall**: 둘 다 이름을 누락하고 일반 준비 안내로 답한다. 루리는 음료·다과와 실제 만남 암시를 더한다.
- **context_distraction**: 서연은 작품 리스트·출발 안내, 루리는 포스터 수정 체크리스트로 불안에 더 직접 대응한다. 서연은 현장 만남을 암시한다.

## 범위와 해석

Pi는 기억을 승인해 변경할 때 history를 비우므로 8개 시나리오 전체가 끊김 없는 누적 대화는 아니다. 재시작은 같은 session namespace의 저장된 기억을 다시 사용한 것으로, 대화 간 장기 기억이나 자유로운 자동 기억 추출을 입증하지 않는다. 32줄 문맥도 소규모 교란 조건이다.

같은 모델과 프롬프트라도 persona·framework가 만든 실제 문맥과 이력 처리에 차이가 있다. 이번 32개 표본만으로 특정 framework가 본질적으로 성격 유지에 우수하다고 결론 내리지 않는다. 후속 no-tools 실행의 완주는 성격·이름·기억을 항상 지켰다는 의미가 아니다.
