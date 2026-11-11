# 기억·페르소나 하네스 — 자매 규격과 공개 구현 근거

확인일: **2026-11-10**. 범위는 Elda-CLI **모드 ② 자체 하네스의 기억·페르소나 실험 설계**다. 이 문서는 설계 근거이며 실행 결과 보고서가 아니다. 외부 SDK를 설치하거나 실제 모델을 호출하지 않았다. 공개 문서와 공개 소스의 현재 main을 직접 열어 확인했으며 특정 설치 버전의 동작을 보장하지 않는다.

읽기는 아래 허용된 자매 문서 6개로 제한했다. reference 안에서 수정·실행·캐시 생성을 하지 않았으며 CLAUDE·env·비밀 설정 파일을 읽지 않았다. 이 문서만 자체 프로젝트에 작성했다.

## 1. 먼저 고정할 경계

**페르소나와 기억을 하네스의 교체 가능한 바깥 계층으로 두고, 작성 권한·근거·범위를 먼저 검증하는 것이 현재 Elda 설계와 가장 잘 맞는다.** 이는 아래 자료를 종합한 설계 판단이다.

- `persona/SPEC.md`와 `memory/SPEC.md`는 **v0.0 인계 메모**다. 스스로 확정 규칙이 아닌 재료라고 명시한다. 이 문서를 근거로 새 운영 정책을 확정하거나 다른 프로젝트의 DB를 변경하면 안 된다.
- 기억 기본 범위는 **대화 하나 안**이다. principal별 격리와 삭제 요청을 요구하지만 대화 간 장기 기억을 켜는 조건은 사용자 결정으로 남아 있다. 이번 실험의 장기 저장은 가짜 principal·fixture와 명시적인 실험 옵션에 한정한다. 프로토타입 결과를 운영 장기 기억 허용으로 해석하지 않는다.
- `harness/SPEC.md`의 H16 무승인은 **서빙 갈래 B**의 계약이다. 개발 갈래 C, 게임 갈래 A 및 이번 독립 모드 ② 비교 실험에 자동 확장하지 않는다. 모드 ②의 승인·거절 실험은 별도 계약으로 유지한다.
- `brain-gateway/SPEC.md` G13에 따라 scripted 모델 배선 시험은 관문 없이 가능하다. G14의 게임 실시간 비용 0 목표와 작업형 서빙·오프라인 선생 경로는 구분한다.

| 로컬 근거 | 읽어 확인한 내용 | 이번 실험에 적용할 해석 |
|---|---|---|
| [persona v0.0](../../reference/Elda-Spec/persona/SPEC.md) | 소유 EldaCore. 모델을 바꿔도 정체성 유지, 파일·버전·md5, `UserPromptSubmit.additionalContext`, Stop/judge 연계 | persona를 모델 provider 설정에 묻지 않고 독립 artifact로 둔다. 모델이 anchor 원본을 수정하지 못하게 한다 |
| [memory v0.0](../../reference/Elda-Spec/memory/SPEC.md) | 소유 EldaCore+DBA. principal 격리, 세션 범위, 삭제, 근거 턴, 닫힌 튜플 | scope와 evidence를 필수로 받고 저장·갱신·회상·모순 처리는 결정론으로 검증한다 |
| [harness v0.7](../../reference/Elda-Spec/harness/SPEC.md) | H19/H36 주입·도구 앞/뒤·Stop hook, H10/H28 비밀 보호, H31 같은 과제 비교 | 기억이 승인/정책을 덮어쓰지 않게 하고, 주입량·실행 결과·차단 이유를 기록한다 |
| [brain gateway v0.1](../../reference/Elda-Spec/brain-gateway/SPEC.md) | 모델·키·라우팅은 EldaCore 관문 몫. G2 메시지 계약 재사용, G4 usage·servedBy, G7 단일 fallback, G13 scripted 예외 | 기억 실험 때문에 공급자 API나 재시도 정책을 새로 만들지 않는다 |
| [Hermes 참고 핸드오프](../../reference/Elda-AI-Agent/핸드오프_ELDA_기억설계_hermes참고.md) | 2026-09-15, Hermes commit a55c972e09 분석. 소유권, 서술형 학습 기억, staged write, frozen snapshot, 원문 검색 | 과거 특정 commit 분석으로 취급한다. 현재 외부 구현과 달라진 부분은 아래에 구분한다 |
| [EldaCore 분석 1109](../../reference/Elda-AI-Agent/analysis/GanpanAI/EldaCore_하네스_페르소나_분석_1109.md) | 한 번 지나가는 오케스트레이터, 살아 있는 대화별 7슬롯·VM 판정, 장기 튜플/anchor는 설계 단계 | 기존 구현이 이미 장기 기억·불변 persona 전체를 제공한다고 주장하지 않는다 |

마지막 분석 파일은 프로젝트 루트 `analysis/GanpanAI/`에는 없고, persona 문서가 참조한 `reference/Elda-AI-Agent/analysis/GanpanAI/`에서 같은 이름으로 확인했다.

## 2. 기억 유형·소유권·주입 위치

| 층 | 내용 | 작성·변경 권한 | 기본 수명/회상 |
|---|---|---|---|
| 정체성 anchor | 이름·성격·말투·세계관·금지 경계·출력 방식 | 설계자/운영자만. 버전+해시로 고정 | 모델 교체와 무관하게 유지. 우선 주입 |
| 명시적 사용자 설정 | 사용자가 직접 고른 형식·선호 | 인증된 사용자 설정 경로. 학습 추정과 구분 | 이번 prototype은 세션 범위 기본 |
| 관찰·사실 후보 | 사용자의 발화에서 얻은 사실·선호·관계·약속·감정 | 모델/추출기는 **제안**만. evidence 검증과 저장 정책을 통과해야 활성화 | principal+persona+session 범위, `proposed/active/superseded/rejected` 등 명시 상태 |
| 최근 대화·에피소드 | 실제 user/assistant/tool 원문과 턴 포인터 | 하네스가 기록, 모델이 원문을 덮어쓰지 않음 | 최근 창은 자동 주입, 오래된 원문은 필요할 때 검색 |
| 절차·스킬 | 반복 작업의 검증된 방법·교정 | 설계자 절차와 agent-created 절차를 구분 | 색인만 기본 주입, 본문은 선택 회상 |
| 시간별 관계·사실 이력 | 현재 참인 값과 과거 값, 정정·만료 | 검증된 상태 전이. 덮어쓰기만으로 이전 근거 삭제 금지 | 후속 단계의 시간 그래프 후보 |

로컬 memory 메모의 핵심 튜플은 `(principal, kind, slot, thing, value, polarity, evidence_turn_id, observed_at, state)`이다. 실험에서는 `persona_id`, `session_id`, `owner/source`, `revision` 등을 envelope로 더할 수 있지만 **이는 새 Elda 규격 확정이 아닌 실험 설계**다. 요청 body의 principal 문자열을 인증된 소유자로 믿지 말고 하네스가 scope를 고정한다.

학습 기억은 “사용자는 짧은 답을 선호한다고 말했다”처럼 서술형·출처가 있는 데이터로 다룬다. “항상 짧게 답하라”를 다음 세션의 운영 지시로 승격하지 않는다. 사용자가 오늘 자세한 설명을 요청하면 과거 선호가 이를 덮어쓰지 않도록 한다. 설계자가 작성한 persona 제약은 별도 신뢰 계층으로 취급한다.

기억은 **사실 후보이지 판결문이 아니다.** “첫 질문은 카페 추천이었다”라는 새 주장이 원문과 충돌하면 `user_claim`과 원문 근거를 나란히 남기고 모름/충돌을 반환할 수 있어야 한다. 구현 없이 “영합 해결”이라고 주장하지 않는다.

주입 위치는 `UserPromptSubmit.additionalContext`에 해당하는 턴 앞 단계로 둔다. 기본 persona와 회상한 기억을 구분하고, 회상 텍스트를 운영 지시·승인 우회로 해석하지 않도록 구조화한다. `PreToolUse`는 memory write/forget의 scope·권한·approval을 확인하며 `PostToolUse`는 실제 저장 결과를 기록한다. `Stop`의 한 번 고침은 persona 위반 판정 실험에 사용할 수 있지만, 단순 문자열 검사를 일반적인 정체성 판정기로 표현하면 안 된다. H36의 재차단 제한도 지킨다.

## 3. 외부 구현 비교 — 공식 문서/소스에서 확인한 사실

### Hermes Agent: 소유자 persona + 작은 사실 저장 + 원문 검색

공식 파일 지도는 **SOUL.md는 사용자가 작성하는 정체성**, USER.md/MEMORY.md는 agent가 관리하는 학습 사실로 분리한다. SOUL은 HERMES_HOME에서 읽어 system prompt 첫 자리에 들어가며 임시 personality overlay와도 구분된다. USER/MEMORY는 세션 시작에 snapshot으로 로드된다. [파일 지도](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/which-file-does-what.md), [personality](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/personality.md)

현재 memory 문서는 MEMORY 2,200자·USER 1,375자, 초과 시 자동 압축 대신 실패, 같은 Hermes home에 두 writer를 두지 말 것을 명시한다. 모델이 저장한 새 값이 disk에는 있어도 진행 중 system snapshot에는 즉시 반영되지 않는다. [Persistent Memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md)

`write_approval=true`는 foreground와 background write를 inline 확인 또는 pending staging으로 보낸다. **기본값은 false**이며 현재 구현은 설정 읽기 실패·미지정 값을 gate off로 취급한다. 그대로 가져오기보다 우리 실험에서는 “정책 확인 실패 → commit 금지”를 명시적으로 시험하는 편이 맞다. [승인 gate 소스](https://github.com/NousResearch/hermes-agent/blob/main/tools/write_approval.py)

`session_search` 현재 소스는 LLM 호출 없이 실제 DB 메시지를 반환하며 discovery/scroll/read/browse를 지원한다. 다만 현재 memory 문서의 “no truncation” 문구와 달리 소스에는 read 메시지당 2,000자 제한이 있다. **원문 기반 검색과 전체 원문 무제한 반환은 다르다.** [검색 소스](https://github.com/NousResearch/hermes-agent/blob/main/tools/session_search_tool.py)

② 적용 판단: 작은 pinned persona + staged fact write + 원문 검색을 분리하는 가장 직접적인 설계 참고다. Hermes CLI 전체를 붙이지 않아도 이 패턴을 자체 memory layer로 구현해 비교할 수 있다. 그 경우 결과 이름은 “Hermes 패턴 참고 자체 구현”이며 “Hermes 실제 SDK 검증”이 아니다. 실제 Hermes 시험은 별도 프로젝트 내부 HERMES_HOME, writer 1개, 자동 background LLM 비활성화 여부 확인이 필요하다.

### Letta: agent별 git memory와 persona/human, 매턴 주입

현재 Letta MemFS는 agent에 속한 git repository를 실행 컴퓨터의 checkout으로 투영한다. `persona.md` 같은 작은 핵심 파일은 상시 맥락, 하위 index와 깊은 자료는 필요할 때 읽는 방식이다. 기본 semantic/vector index는 없으며 keyword 또는 semantic 검색 확장이 별도다. 변경은 commit/history로 추적된다. [MemFS](https://docs.letta.com/concepts/memfs)

SDK의 `createAgent({persona, human})`는 초기 memory 설정의 shorthand다. Persona를 별도 불변 정책 객체로 자동 보장한다는 뜻은 아니다. 현재 SDK 문서는 memory entries를 `system/`에 만든다고 설명한다. 개념 문서는 새 agent는 memory root, 구 agent는 `system/`라고 설명하므로 **상시 주입 경로는 문서 간 불일치가 있다. 설치 버전에서 확인해야 한다.** [SDK memory](https://docs.letta.com/agent-sdk/memory), [agent 생성](https://docs.letta.com/agent-sdk/agents)

Dreaming은 background subagent가 기억을 정리하는 기능이다. “Agent reviews before applying”은 모델의 추가 검토로, 사람 승인을 요구하는 옵션이 아니며 모델 토큰을 더 사용한다. [Memory & dreaming](https://docs.letta.com/configuration/memory)

SDK는 permission mode와 `canUseTool` 콜백으로 승인·거절·입력 수정을 지원한다. `strict`는 자동 승인을 하지 않지만 그것만으로 designer persona 소유권이 자동 분리되는 것은 아니다. 파일 경로·도구·agent scope 정책을 따로 구성해야 한다. [SDK permissions](https://docs.letta.com/agent-sdk/permissions)

② 적용 판단: 대화/모델을 넘어 이어지는 정체성과 memory version 이력 비교에 적합하다. 현재 세션 한정 원칙을 시험할 때는 agent를 세션마다 분리하거나 별도 정책이 필요하다. Hermes의 frozen snapshot과 Letta의 매턴 주입은 같은 정책으로 비교하지 말고 snapshot/latest라는 별도 실험 조건으로 명시한다. Docker/Python V1 memory-block 예제를 최신 JS/TS MemFS API와 섞지 않는다.

### Mem0 OSS: 교체 가능한 기억 추출·저장·검색 계층

Mem0 OSS는 `Memory`로 memory add/search를 제공하며 LLM·embedder·vector store를 교체할 수 있다. **기본 `Memory()`는 외부 OpenAI, `/tmp/qdrant`, `~/.mem0/history.db`를 사용한다고 공식 quickstart에 명시되어 있다.** 이번 프로젝트 제한을 지키려면 provider와 모든 저장 위치를 명시적으로 구성해야 한다. hosted `MemoryClient`와 로컬 OSS `Memory`도 구분한다. [OSS quickstart](https://docs.mem0.ai/open-source/python-quickstart)

현재 소스는 user_id/agent_id/run_id를 조합해 scope metadata와 query filter를 만들고, 임의 metadata의 identity 키를 제거한다. 그러나 애플리케이션은 호출자가 지정한 ID를 인증된 principal과 연결해야 한다. **ID 필터는 로그인·권한 검증을 대신하지 않는다.** `infer=False`는 LLM 추출을 건너뛰지만 여전히 `embedding_model.embed()`를 호출한다. 따라서 fake/local embedder까지 통제하지 않으면 외부 호출 0회 시험이 아니다. [Memory 구현](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py)

추출 범위를 좁히는 custom instructions가 있지만, 프롬프트만으로 저장 권한·증거 진위를 강제할 수는 없다. 현재 문서는 옛 `custom_fact_extraction_prompt` 이름이 `custom_instructions`로 바뀌었다고 명시한다. [Custom instructions](https://docs.mem0.ai/open-source/features/custom-instructions)

② 적용 판단: 기존 하네스를 바꾸지 않고 memory adapter만 비교하기 좋다. 첫 시험은 fake LLM+fake embedder+실제 로컬 저장소로 scope/CRUD를 검사하고, 그 다음 실제 추출 품질·한국어 검색을 분리한다. 별도 persona anchor, staging approval, evidence_turn 검증은 우리가 구현해야 한다. 현재 자료에서 모든 memory mutation의 내장 사람 승인 기능은 확인하지 못했다.

### Graphiti / Zep: 관계·시간·근거를 다루는 그래프

Graphiti는 entity/edge/episode를 가진 시간 그래프를 만들며 변화한 사실을 무효화하고 과거 근거를 보존한다. graph DB·LLM·embedder 및 tenancy/access control 서비스는 운영자가 구성한다. Zep은 Graphiti를 활용하는 관리형 enterprise context 서비스이며 배포 선택은 managed/BYOC다. 둘을 같은 무료 로컬 memory package로 묶지 않는다. [Graphiti 개요](https://help.getzep.com/graphiti/getting-started/overview), [공식 README](https://github.com/getzep/graphiti)

공식 Graphiti MCP reference server는 stdio/HTTP, group_id, episode 추가·검색·삭제, provenance 조회, `add_triplet` 등을 제공한다. 다만 README가 **authentication·authorization·prompt-injection protection이 없는 reference 구현**이라고 명시한다. group_id는 데이터 분류/필터이고 인증 경계가 아니다. [MCP README](https://github.com/getzep/graphiti/blob/main/mcp_server/README.md)

`add_triplet`이 extraction을 건너뛴다고 모델·embedding 사용까지 0이라는 뜻은 아니다. 현재 MCP 소스 설명은 endpoint entity resolution/dedup 및 embedding을 언급한다. 정확한 호출 수는 provider spy로 측정해야 한다. [MCP source](https://github.com/getzep/graphiti/blob/main/mcp_server/src/graphiti_mcp_server.py)

② 적용 판단: 사람·관계·약속과 시간에 따른 정정·회상이라는 Elda 장기 설계와 잘 맞지만 첫 세션 메모리 prototype보다 운영·검증 범위가 크다. LLM이 관계를 추출하고 모순을 판정하는 경로는 Elda의 “저장·판정 결정론”과 동일하지 않으므로, 정규화된 튜플을 별도 authoritative store에 두고 그래프는 파생 인덱스로 시험하는 편이 맞다. 이는 설계 제안이며 Graphiti 자체가 그 구조를 보장한다는 뜻이 아니다.

## 4. 독립 시험 가능성 비교

| 후보/방식 | 모델 비용 없이 의미 있게 확인할 수 있는 것 | 별도 실제 모델 시험이 필요한 것 | 첫 단계 적합도 |
|---|---|---|---|
| 자체 닫힌 튜플 + pinned persona | scope, 근거 포인터, owner, 승인 상태 전이, 삭제, snapshot, 예산, 재시작 복원 | 한국어 자유문장 추출, 말투·인격 일관성, 의미 검색 품질 | **높음** — 정책 oracle를 먼저 만든다 |
| Hermes 패턴 참고 | 작은 파일 store·staging·snapshot·원문 검색의 자체 구현 | Hermes 실제 loop/provider/background 동작 | **높음** — 패턴 구현과 제품 검증을 명확히 구분 |
| Letta 실제 SDK | 메모리 파일/commit/재접속·permission 배선. provider를 mock해 실험 가능 여부 확인 | dreaming·서술형 기억 선정·페르소나 표현 품질 | **중간** — 현재 버전/경로 확인 필요 |
| Mem0 실제 OSS | fake LLM/embedder + 로컬 store로 scoped CRUD·filter·삭제·history | 사실 추출/정정 품질·한국어 embedding 검색 | **중간~높음** — provider/path 기본값 통제 필수 |
| Graphiti 실제 framework | 로컬 graph DB + 명시 fixture로 temporal/provenance/query 계약 | entity merge·모순/시간 추출·검색 품질 | **후속** — DB와 다중 model/embedding 경로 필요 |
| Zep | 계정/환경이 준비된 서비스 API 계약 | 실제 데이터 처리·추출·비용·지연 | **후속** — 이번 독립 로컬 시험과 분리 |

여기서 “모델 비용 없음”과 “전체 비용 없음”은 다르다. 로컬 모델의 compute, 저장소, 유료 hosted service는 별도다. fake provider로 검증한 결과를 LLM 기억 능력으로 보고하지 않는다.

## 5. 구현 팀에 넘길 시험 목록과 oracle

아래는 **제안된 시험 목록이며 이 조사 작업에서 실행하지 않았다.** root/구현 담당의 실제 결과와 나중에 연결한다.

| # | 시나리오 | 통과를 판정할 실제 oracle |
|---|---|---|
| M1 | principal A 기억을 B가 조회·삭제 시도 | B의 실제 조회 결과와 저장소에 A의 record가 노출/삭제되지 않음 |
| M2 | 같은 principal, 다른 persona/session | 기본 세션 범위에서 이전 세션 기억이 주입되지 않음; 명시 테스트 opt-in 때만 재개 |
| M3 | designer persona 수정 제안 | 원본 byte/hash·version 그대로, mutation denied 기록 |
| M4 | 관찰을 저장 제안 → 승인/거절 | pending은 recall에서 제외, 승인 전 durable store 미변경, 거절 후 영속화 없음 |
| M5 | stale/중복 승인·비bool 결정·EOF | 오류 코드, 승인 대상 revision 비교, late write 0, pending 정리 |
| M6 | 모르는 evidence_turn_id 또는 다른 principal 턴 | commit 거부. 근거 없는 사실을 자동 생성하지 않음 |
| M7 | 틀린 “전에 이렇게 말했다” 주장 | 원문 포인터에 근거해 conflict/unknown, 주장과 검증 사실을 분리 |
| M8 | 학습 기억에 정책 우회 지시 삽입 | 데이터로 유지/거부. persona·도구 allowlist·승인 mode 실제 값이 변하지 않음 |
| M9 | 값 정정·부정·시간 경과 | 현재 active와 superseded history 일관성, 시간 질의별 기대값 |
| M10 | 삭제/잊기 후 새 세션·재시작 | 실제 store·index·recall에서 제거; 이벤트 로그/backup 잔존 여부는 별도 보관 정책으로 보고 |
| M11 | memory 용량 초과 | 몰래 잘라 저장하지 않음, 명시 오류/선택 제외와 이유, 기존 기억 유지 |
| M12 | context 예산 초과 | pinned persona 우선, recall 선택 결과/제외 ID/실제 투입 길이 기록 |
| M13 | frozen snapshot vs 최신 recall | 같은 사건으로 두 정책을 별도 실행, 저장 version과 주입 version을 구분해 비교 |
| M14 | 재시작·깨진 파일·중복 writer | 실제 디스크 기준 재로드, 손상 감지, 충돌 시 silent overwrite 없음 |
| M15 | 과거 선호와 현재 명시 요청 충돌 | 모델 입력에 현재 요청·사실 출처가 구분됨. 생성 품질은 실제 모델 단계에서 평가 |
| M16 | provider 교체 | persona hash·memory owner·scope 동일. “문체 일관성”은 text-only fixture 통과와 별도 |
| M17 | memory tool 반복 실패 | bounded retry/turn limit 안에서 실패 종료; 무제한 기억 정리 loop 없음 |
| M18 | hidden background model call | fake provider spy와 네트워크 경로로 호출 수 검증; memory add와 embedding 호출 별도 계수 |

관측은 저장된 record, 실제 파일/hash, 조회 결과, event sequence, model request에 전달된 context를 우선한다. “저장했습니다/기억합니다”라는 모델 문장만으로 성공 처리하지 않는다. 기존 harness-lab의 실제 MCP 파일 oracle와 같은 원칙이다.

## 6. 아직 확인하지 않은 것

- Hermes/Letta/Mem0/Graphiti를 이번 작업에서 설치·실행하지 않았다. 공식 main 문서와 설치 버전의 차이, 최신 release 번호는 검증하지 않았다.
- source의 injection scanner가 어떤 공격을 실제로 막는지 평가하지 않았다. “scanner 있음”을 “prompt injection 해결”로 표현하지 않는다.
- 한국어 의미 검색, extraction 정확도, 정체성/말투 유지, 장기 기억의 유용성은 실제 모델·한국어 fixture가 필요하다.
- 캐릭터 정체성 중 특정 게임 NPC의 AI 밝힘 정책은 세계관 전용 사례다. 이를 일반 CLI 도우미의 정직성 정책으로 그대로 복사하지 않는다.
- reference의 옛 분석에 적힌 DB 상태·커밋 이후 활동은 현재 운영환경을 직접 검사한 사실이 아니다. 이번 연구에서 운영 DB나 자매 프로젝트 서버에 접속하지 않았다.

현재 착수 순서는 **닫힌 튜플·소유권·근거·승인·scope oracle → 같은 context를 실제 하네스에 주입 → memory SDK/graph 대안 비교 → 실제 모델 추출/회상/페르소나 품질 비교**가 적절하다. 이 순서는 공식 제품 우열이 아니라 이번 프로젝트의 격리·검증 요구에 따른 판단이다.
