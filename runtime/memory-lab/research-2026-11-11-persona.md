# 기억·페르소나 하네스 개선 조사 — 2026-11-11

조사일: 2026-11-11, Asia/Seoul. 범위는 Elda-CLI mode 2의 자체 하네스에서 CLOVA의 정체성·말투·기억 의미·도구 능력에 대한 주장을 안정시키는 방법이다. 외부 근거는 원 논문, 저자 저장소, NAVER 공식 문서로 제한했다. 이 조사 작업에서는 모델 API를 호출하지 않았으며, 아래 성능 수치는 기존 로컬 실행 결과다. 문헌이 제안 구현의 HCX-005 성능을 보증한다는 뜻은 아니다.

## 1. 현재 실패를 어떻게 해석할 것인가

조사 시작 시점의 [Pi context builder](pi/store.mjs)는 `JSON.stringify(persona)`를 immutable anchor 뒤에 붙이고, 검색된 기억도 JSON 배열로 붙였다. Agno도 persona JSON을 compact하여 anchor에 넣었다. 이전 명시적 persona 실험은 JSON 안의 규칙을 늘렸으며, **persona를 한국어 실행 지시로 컴파일하는 표현 변경**은 별도 실험하지 않았다. JSON 자체가 원인이라고 단정할 근거는 없다. 표현, 길이, 역할 지시의 주체, 모델 특성이 섞여 있다.

[기존 후속 결과](../../PERSONA-FOLLOWUP-RESULTS-2026-11-10.md)의 paired 유효 38쌍에서는 말투 준수가 15/38→19/38, 능력에 대한 정직성이 33/38→35/38로 움직였지만 이름은 10/19→10/19, 성격은 23/38→23/38이었다. 숫자는 독립 AI 검토 결과이며 인간 평가나 광범위한 벤치마크가 아니다. 429 뒤 재개한 일부 사례는 대화 이력이 없어 연속 멀티턴으로 해석할 수 없다.

실제 실패와 필요한 제어는 다음처럼 나뉜다.

| 관측된 실패 | 단순 검사로 놓치는 점 | 하네스가 제공할 근거 |
|---|---|---|
| `네 이름은 루리야` | 이름 문자열은 존재하지만 assistant/user 주체가 뒤집힘 | 이름의 소유 주체가 assistant라는 명시적 계약 |
| 전시 준비 회의를 전시 개막으로 바꿈 | 날짜·시간·장소가 모두 맞아도 사건의 뜻이 바뀜 | 사건 종류, 목적, 상태, 출처를 분리한 기억 |
| 말투가 generic assistant로 돌아감 | 이름 검사를 통과해도 말투·성격이 사라짐 | register와 personality를 별도 평가 |
| 알림·검색·실제 참석을 약속함 | 친절한 문장이 실제 실행 능력으로 오인됨 | 현재 실제 등록 도구와 실행 결과에서 만든 capability 목록 |
| 함께 경험한 일을 지어냄 | 사용자 기억을 assistant 경험으로 변환함 | 기억의 주체·증거 출처·확인 상태 |

## 2. 원문 근거와 구현 매핑

각 항목의 **적용**은 해당 근거에서 도출한 이 프로젝트의 설계 제안이다. 논문의 실험 결과와 구별한다.

### S1. NAVER Chat Completions v3 API — 공식 제공자 계약

- 출처: [텍스트 및 이미지 API](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3), 2026-11-11 열람. 문서 갱신일은 확인하지 못했다.
- 확인: `system`은 역할을 규정하는 지시문이며 요청당 최대 1개다. HCX-005는 입력·출력 합계 128000 토큰, 출력 최대 4096 토큰이다. `temperature` 범위는 0~1, `seed=0`은 기본 랜덤 설정이고 1~4294967295를 지정할 수 있다. `includeAiFilters`는 욕설·차별 등 출력 분류이며 페르소나 판정기가 아니다.
- 적용: Pi/Agno 공통 compiler가 persona, 현재 capability, 기억의 신뢰 경계, 응답 규칙을 **하나의 system 메시지 안**에 순서대로 배치한다. A/B 실행에는 실제 요청에 실린 모델·temperature·seed·maxTokens를 기록한다. `temperature=0`만으로 완전 결정성을 주장하지 않는다.
- 한계: API가 system을 지원한다는 것은 지시 준수 보장이 아니다. context 최대 크기와 문맥 활용 성능도 같은 개념이 아니다.

### S2. NAVER Playground 사용 가이드 — 프롬프트와 파라미터

- 출처: [Run and manage Playground tasks](https://guide.ncloud-docs.com/docs/en/clovastudio-playground01), 2026-11-11 열람.
- 확인: system에 수행 지시나 예시를 넣고 결과를 보며 예시를 수정하는 흐름을 안내한다. 일반적인 topP는 0.8~1.0, topK는 0, repetitionPenalty는 1.0~1.1에서 0.05 단위 조정을 권장한다.
- 적용: 말투를 형용사 나열로만 설명하지 않고 화자·호칭·존대 수준·응답 길이를 실행 가능한 문장으로 만든다. 단, A/B에서는 sampling 설정을 고정해 프롬프트 개선과 파라미터 효과를 혼동하지 않는다. 말투 예시는 별도 개발용 상황으로 작성하고 평가 질문·정답을 재사용하지 않는다.
- 한계: 공식 문서도 JSON 대비 산문 우위를 실험으로 입증하지 않는다. prose compiler는 검증할 가설이다.

### S3. RoleLLM / RoleBench — 지식과 말투를 분리

- 출처: [논문 v3](https://arxiv.org/abs/2310.00746v3), 2024-06-18 개정; [저자 공개 저장소](https://github.com/InteractiveNLP-Team/RoleLLM-public), 2026-11-11 열람.
- 확인: 역할 프로필, 역할 지식 추출, 발화 스타일 모방, 역할 조건부 instruction tuning을 구분한다. RoleBench는 100개 역할과 168093개 샘플을 제시한다. 저장소도 Context-Instruct의 지식·에피소드 추출과 RoleGPT의 말투 모방을 나눈다.
- 적용: operator persona의 identity/style과 사용자에 관한 기억 facts를 별도 필드로 유지한다. 역할 지식을 더 넣는 것과 말투를 고치는 것을 별도 실험한다. persona에는 평가 사건 답을 넣지 않는다.
- 한계: RoCIT/RoleLLaMA/RoleGLM 결과에는 학습이 포함된다. API 호출 전 프롬프트 편집만으로 그 효과를 재현했다고 말할 수 없다. 공개 저장소의 확인된 최상위 내용은 README·assets·데이터 연결이며 완성형 CLI 하네스로 취급하지 않는다.

### S4. PersonaGym — 이름, 말투, 판단을 별도 측정

- 출처: [논문 v5](https://arxiv.org/html/2407.18416v5), 2025-09-05 개정, EMNLP Findings 2025.
- 확인: persona에 맞는 환경·질문을 동적으로 만들고 Action Justification, Expected Action, Linguistic Habits, Persona Consistency, Toxicity Control을 따로 평가한다. 10개 모델·200개 persona를 보고하며 큰 모델이 항상 더 좋은 persona 결과를 내지는 않았다. 자동평가가 언어 습관을 높게 평가했으나 인간은 낮게 평가한 사례도 제시한다.
- 적용: `identity`, `register`, `personality`, `eventMeaning`, `currentFacts`, `capabilityHonesty`를 독립 축으로 유지한다. 정체성 질문만 잘 답하는 상태를 persona 성공이라 부르지 않는다. persona와 맞는 업무·감정·관계 상황을 바꿔 평가한다.
- 한계: 한국어 존대/반말이나 HCX-005를 직접 검증한 논문이 아니다. 전체 사회집단을 균등 대표하지 않는 한계도 저자가 명시한다. 자동 점수는 인간 판단의 대체 정답이 아니다.

### S5. CharacterEval — 멀티턴과 평가 기준 예시

- 출처: [ACL 2024 논문](https://aclanthology.org/2024.acl-long.638/), 2024-08; [저자 코드](https://github.com/morecry/CharacterEval), 2026-11-11 열람.
- 확인: 중국어 역할 대화 1785개·77개 캐릭터, 4개 차원·13개 지표를 제시한다. 코드에는 응답 생성→평가 형식 변환→CharacterRM 평가→축별 점수 계산 경로가 분리되어 있다. annotation 문서는 최상·최하 점수 예시와 사람 간 이견 조정 절차를 제공한다.
- 적용: 생성기와 평가기를 분리하고 raw 출력, 근거, 판단을 보존한다. 각 축에 성공/실패/평가불가 예시를 작성한다. 해당 턴에 이름을 말할 필요가 없다면 identity 언급 누락을 무조건 실패로 세지 않는다.
- 한계: Chinese reward model을 한국어 성격 판정기로 바로 사용하면 언어·문화 편향이 생길 수 있다. 논문 페이지와 현재 README의 example 수가 달라 여기서는 그 수치를 사용하지 않았다. 전체 성공률만 보고하지 말고 적용 가능한 사례 분모를 표시한다.

### S6. DMT-RoleBench — 고정 문항 외 동적 멀티턴

- 출처: [AAAI 2025 원 논문 페이지](https://ojs.aaai.org/index.php/AAAI/article/view/34768), 2025-04-11; [저자 논문 PDF](https://ojs.aaai.org/index.php/AAAI/article/download/34768/36923).
- 확인: 역할·system 형식·주제·평가 의도에 따라 동적으로 멀티턴 대화를 생성한다. 996개 seed, 6개 역할 종류, 7개 평가 의도 및 지표별 판정을 기술한다. 원문 페이지 직접 open은 접근 차단되었고 검색 인덱스의 원문 페이지/논문 발췌를 확인했다.
- 적용: 기존 10개 회귀문항과 별도로 미사용 이름·역할·일정·장소를 갖는 holdout을 만든다. 주제 전환, 사용자 오인, 인용문 안의 지시, 이미 정정된 옛 사실, capability 요청 뒤 말투 유지 등을 연속 대화로 검사한다.
- 한계: 매번 새 질문을 생성하면 A/B 난이도가 달라진다. 비교할 때는 생성한 대화를 먼저 고정하고 동일 입력·기억 상태를 재생한다. 여기서 DMT-Score를 재현한 것은 아니다.

### S7. Self-Refine — 피드백의 위치와 수정 지시

- 출처: [논문](https://arxiv.org/abs/2303.17651), 2023-05-25 개정; [저자 설명](https://selfrefine.info/), [공식 코드](https://github.com/madaan/self-refine).
- 확인: 초안→피드백→수정 구조이며 추가 학습 없이 같은 모델을 쓸 수 있다. 저자 설명은 문제가 있는 위치와 개선 방향을 특정하는 actionable feedback을 강조한다. 원 실험은 7개 과제에서 개선을 보고했다.
- 적용: `다시 잘해` 대신 `assistant 이름의 소유 주체 오류`, `실제로 사용할 수 없는 도구 실행 주장`처럼 확인된 제약 위반을 짧게 전달한다. 수정은 최대 1회로 제한하고, 수정 전후 출력과 검사 결과를 따로 기록한다.
- 한계: 본 프로젝트의 규칙 기반 외부 검증+1회 수정은 논문 전체 알고리즘의 재현이 아니다. 추가 호출·지연·토큰이 발생하고 올바른 초안을 악화시킬 수 있다. 피드백 자체가 틀리면 수정도 틀릴 수 있다.

### S8. Large Language Models Cannot Self-Correct Reasoning Yet — 자기확신의 한계

- 출처: [ICLR 2024 논문](https://arxiv.org/abs/2310.01798v2), 2024-03-14 개정.
- 확인: 외부 피드백 없는 intrinsic self-correction을 추론 문제에서 평가하고, 고치지 못하거나 성능이 내려가는 경우를 보고한다.
- 적용: validator는 모델의 `잘 지켰습니다` 주장에 의존하지 않는다. 애플리케이션이 이미 아는 persona, 현재 도구 등록 상태, 승인된 기억의 필드에서 피드백을 만든다. repair 이후도 다시 검사하고, 원래 정답을 망친 사례를 별도 집계한다.
- 한계: 추론 과제 결과를 한국어 persona에 직접 일반화할 수 없다. 이 자료는 repair를 금지하는 근거가 아니라 **외부 기준 없는 자기평가를 성공 증거로 사용하지 말아야 할 이유**다.

### S9. The Instruction Hierarchy — 권한과 데이터 분리

- 출처: [원 논문](https://arxiv.org/abs/2404.13208), 2024-04-19.
- 확인: 상위 지시와 비신뢰 입력의 우선순위를 구분하는 데이터를 만들어 모델을 학습시킨 연구다. 효과를 평가한 대상에는 GPT-3.5가 포함된다.
- 적용: operator persona는 사용자 기억이나 검색 결과에서 갱신하지 않는다. 기억에는 출처·주체·유효성·인용 데이터 경계를 유지한다. persona hash와 버전을 기록하고 runtime의 승인·도구 접근 제어는 애플리케이션이 집행한다.
- 한계: 제목이나 구분자를 추가하는 것만으로 학습된 hierarchy 능력이 생기는 것은 아니다. 메모리를 system 본문에 포함하더라도 그 텍스트가 안전한 지시로 승격되는 일이 없도록 경계와 테스트가 필요하다. model output이 permission을 부여하게 만들지 않는다.

### S10. Lost in the Middle — 기억의 양보다 배치와 관련성

- 출처: [TACL 2024 논문](https://aclanthology.org/2024.tacl-1.9/).
- 확인: 다문서 QA와 key-value retrieval에서 관련 정보 위치에 따라 성능이 바뀌고 긴 문맥 중간에서 저하하는 현상을 보고한다.
- 적용: immutable identity/style은 짧게 전면에 두고, 현재 턴에 필요한 승인된 기억을 작은 evidence block으로 구성한다. 오래된 사실을 무작정 늘리기보다 active/superseded 상태와 사건을 선택한다. prompt 문자수뿐 아니라 선택·누락 record 수와 실제 토큰 사용을 기록한다.
- 한계: 더 짧거나 앞에 배치하면 항상 이긴다는 증거는 아니다. HCX-005의 특정 길이 임계값도 알려주지 않는다. 충분한 근거를 잘라내지 않도록 예산·누락을 함께 검증한다.

### S11. MT-Bench / LLM-as-a-Judge — 평가 편향을 측정

- 출처: [NeurIPS 2023 논문](https://arxiv.org/abs/2306.05685v4), 2023-12-24 개정.
- 확인: LLM 판정에서 응답 위치, 장황함, 자기 선호 편향과 추론 한계를 분석한다. 특정 실험에서 사람 선호와 높은 일치를 보였지만 모든 언어·축의 객관 정답 판정기를 뜻하지 않는다.
- 적용: A/B 이름과 framework 이름을 가린 채 같은 rubric으로 평가한다. 비교 순서를 바꾼 표본을 두고, 이름·사건·능력 검증은 원문 근거를 요구한다. 말투는 독립 검토 대상으로 남긴다. 같은 생성 모델의 repair 승인 여부를 최종 성적표로 사용하지 않는다.
- 한계: 소수 표본의 AI 검토 결과를 인간 평가로 표시하면 안 된다. 평가자 불일치, 평가불가 사례, 누락 결과를 함께 보고한다.

## 3. 이번 구현에 바로 연결할 설계

### 3.1 Prompt compiler

제안 입력은 `persona`, `runtimeCapabilities`, `retrievedEvidence`, `policyVersion`이다. 출력은 하나의 system 메시지와 감사용 메타데이터다.

1. assistant의 이름·역할·화자 기준을 한국어로 명확히 기술한다. 사용자 정보와 분리한다.
2. 반말/존대 등 register와 성격을 서로 다른 지시로 둔다. 매 답마다 이름을 반복하는 기계적 스타일을 강요하지 않는다.
3. capability는 실제 tool registry에서 만든다. 미등록 검색·스케줄러·외부 알림·물리 행동을 수행했다고 주장하지 않도록 한다. 도구가 있어도 실행 성공은 실제 tool result가 있을 때만 주장한다.
4. 기억을 사건 종류/목적/상태/시간/장소/주체/출처로 표현한다. 원문 인용과 현재 승인 사실을 구별한다.
5. 평가용 정답·시나리오 ID·기대 출력은 compiler나 repair 입력에 전달하지 않는다. 개발 문항과 holdout을 분리한다.

이는 S1~S3, S9~S10에서 동기를 얻은 실험 설계다. prose가 JSON보다 낫다는 결론은 실제 paired 출력으로 판단해야 한다.

### 3.2 검증과 최대 1회 수정

검사기는 **전체 의미 평가기가 아니라 일부 확인 가능한 위반을 탐지하는 도구**로 정의한다.

- identity: 이름 존재 여부만으로 통과시키지 않는다. assistant 이름을 사용자에게 귀속하는 명확한 문장을 별도 탐지한다.
- capability: 실행 주장과 안내·가정·부정·인용을 구분한다. `알림을 보낼 수 없어`를 `알림` 키워드만으로 실패시키지 않는다.
- register: 코드 블록·인용문·사용자에게 보여주는 예시와 assistant의 실제 서술을 구별한다. 정규식만으로 한국어 말투·성격 전체를 보장하지 않는다.
- facts: 구조화되어 승인된 데이터로 검사 가능한 필드와 의미 해석이 필요한 부분을 구분한다. 임의의 자유 텍스트를 정규식으로 사건 schema로 추정한 값은 확정 근거가 아니다.
- repair: 확정 또는 높은 신뢰도의 위반만 근거와 함께 1회 전달한다. 입력에 원 초안과 관련 근거를 넣되 새 기억으로 저장하지 않는다. 재검사 실패는 명시적인 실패 상태로 기록한다.

반드시 기록할 값: `rawText`, `rawViolations`, `repairAttempted`, `repairText`, `finalViolations`, `responseStatus`, `extraCalls`, `usage`, `latency`, `personaHash`, `contextHash`, `memoryIds`, `modelParams`. 실제 구현의 필드명은 달라도 이 정보는 남겨야 한다.

### 3.3 결과 판정

| 층 | 확인할 것 | 피해야 할 해석 |
|---|---|---|
| 단위 검증 | quote/negation/subject 및 실제 capability 설정에 대한 검사 경계 | fixture 통과를 모델 성능으로 보고 |
| 회귀 replay | 기존 실패가 같은 조건에서 줄었는가 | 익숙한 10문항 개선을 일반화로 보고 |
| holdout | 새로운 persona·사건·표현에서도 유지되는가 | 테스트 정답을 persona에 넣고 성공 주장 |
| 실제 연속 대화 | 이력 유지·주제 전환·오류 복구 이후에도 유지되는가 | 새 세션 replay를 연속 대화로 보고 |
| 독립 검토 | 주체·사건 의미·말투·성격이 실제 맞는가 | guard의 통과를 의미적 완전 성공으로 보고 |

기준 비교는 최소 `기존 JSON`, `compiler only`, `compiler + guard/repair`로 나눈다. 예산상 일부만 실행하면 그 범위를 명시한다. raw→final 변화, 수정된 수/악화된 수, withheld·empty·HTTP 오류 수, 평가 가능한 분모, 추가 토큰·지연을 함께 보고한다. 실패 응답을 표시하지 않는 것만으로 품질이 올라간 것처럼 계산하지 않는다.

## 4. 후속 실험 우선순위

1. 동일 provider·모델·파라미터에서 공통 compiler를 Pi/Agno에 적용하고 기존 출력과 비교한다.
2. 확인 가능한 capability/identity 오류에 한해 외부 피드백+1회 repair를 붙여 raw/final 차이를 측정한다.
3. 인용·부정·주체 반전·가정 표현의 false positive를 검증한다. guard의 미탐도 독립 AI 검토로 찾는다.
4. 미사용 persona와 새로운 사건으로 holdout을 실행한다. 이름·사건 사실·말투·성격 지표를 분리한다.
5. 추가 효과가 확인되면 관련성/시간성 기반 기억 선택, 별도 judge, few-shot 스타일 예시를 각각 독립 실험한다. 큰 framework 도입이나 fine-tuning은 현재의 소규모 프롬프트/검증 개선과 비용을 비교한 뒤 결정한다.

이 문서는 연구와 구현 접점의 기록이다. 실제 코드 적용 여부·실제 모델 호출 결과·배포 여부는 이번 작업의 실행 보고서에서 별도로 확인해야 한다.
