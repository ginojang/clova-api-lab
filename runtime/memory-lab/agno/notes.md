# Agno 기억·페르소나 실험 기록

확인일: 2026-11-10. 구현 위치: `runtime/memory-lab/agno/`.

실제 **Agno 3.1.12 Agent와 MemoryManager/UserMemory/SqliteDb**를 사용한다. 기본 회귀는 custom Model이 합성 fixture를 사용하며, 선택적으로 `--model clova:HCX-005`를 통해 프로젝트의 기존 Brain에 연결한다. 이 문서의 개발자 연결 시험은 dummy 키와 loopback 서버만 사용했다. 실제 CLOVA 호출과 말투 평가는 루트가 별도 보고서로 운영한다. 자동 기억 추출, Elda-CLI 공급자 등록, 운영 DB 변경, 웹 배포는 구현하지 않았다. EldaCore/DBA 경계의 독립 실험이며, 자매 프로젝트의 v0.0 인계 문서를 완성된 규격이라고 전제하지 않는다.

## 설치와 실행

프로젝트 루트에서 실행한다.

```bash
bash runtime/memory-lab/agno/setup.sh

runtime/memory-lab/agno/.venv.local/bin/python -B \
  runtime/memory-lab/agno/cli.py \
  --store /absolute/path/inside/clova-api-lab/memory.sqlite \
  --principal alice --conversation c1 \
  --persona /absolute/path/inside/clova-api-lab/persona.json \
  --script /absolute/path/inside/clova-api-lab/answers.json \
  --scope session --context-chars 6000
```

Python 3.12.3, Node 24.15.0에서 실행했다. `requirements.txt`는 Agno와 SQLAlchemy를 정확히 고정하고, `requirements.lock`은 설치한 전체 의존성을 고정한다. Agno의 SQLite 모듈이 async SQLAlchemy 모듈도 import하므로 `sqlalchemy[asyncio]==2.1.8`의 greenlet 의존성을 포함했다. venv·pip cache·임시 파일은 이 폴더 내부에 있고 global pip를 사용하지 않았다.

독립 회귀 시험:

```bash
runtime/memory-lab/agno/.venv.local/bin/python -B \
  runtime/memory-lab/agno/smoke.py
```

공통 비교 시험:

```bash
node runtime/memory-lab/run.mjs --frameworks agno \
  --output runtime/memory-lab/results/agno.json
```

JSONL 입력과 출력은 [공통 계약](../CONTRACT.md)을 따른다. persona 파일과 script·store 경로는 프로젝트 내부로 제한한다. `ready.workspace`는 MCP가 실제 사용하는 작업장 경로다.

선택적인 실제 모델 연결은 다음과 같다. `--script`와 `--model`은 상호 배타이며 둘 중 하나가 필요하다. 실제 키 파일은 기존 Brain이 요구하는 mode 600으로 운영자가 준비한다.

```bash
CLOVA_API_KEY_FILE=/absolute/path/to/operator-managed-key \
runtime/memory-lab/agno/.venv.local/bin/python -B \
  runtime/memory-lab/agno/cli.py \
  --store /absolute/path/inside/clova-api-lab/memory.sqlite \
  --principal synthetic-eval-user --conversation persona-eval-1 \
  --persona /absolute/path/inside/clova-api-lab/persona.json \
  --model clova:HCX-005 --tools none --max-turns 1 --max-tokens 2048
```

`--tools`는 `artifacts`가 기본이며 `none`은 Agent와 Brain 양쪽에 도구를 제공하지 않는다. 이때도 기존 계약의 ready/cleanup 검사를 위해 MCP 프로세스는 시작하지만 모델 도구로 노출하거나 호출하지 않는다. 도구를 제공하지 않았는데 모델이 tool_calls를 반환하면 `unexpected_tool_call`로 실패한다. `--max-turns`는 prompt별 1..100, 기본 8이며 실제 provider 호출 전에 확인한다. `--max-tokens`는 기본 2048, 도구가 있으면 1024..2048, 없으면 1..2048이다.

## SDK 기본 기능과 직접 구현한 부분

| 항목 | 실제 사용 방식 |
|---|---|
| 모델·도구 반복 | 실제 `Agent.arun` / `acontinue_run`; custom `Model.ainvoke`가 fixture 또는 기존 Brain의 응답을 반환 |
| 도구 사전 승인 | Agno `Function(requires_confirmation=True)`, native paused requirement의 confirm/reject |
| 파일 효과 | 기존 `runtime/clova/mcp.ts`의 실제 stdio MCP; 네 artifact 도구만 허용 |
| 저장 | 실제 `MemoryManager.add_user_memory/get_user_memories/delete_user_memory`와 `SqliteDb`; 자체 SQL 메모리 엔진을 대체 구현하지 않음 |
| 기억 내용 | `UserMemory.memory` 문자열에 adapter가 검증한 tuple·active revision·이전 revision·증거 metadata를 JSON으로 저장 |
| 격리 | adapter가 만든 namespace hash를 native `user_id`로 전달 |
| 기억 저장·삭제 승인 | JSONL adapter에서 처리. 일반 MemoryManager CRUD에 승인 정책이 자동 제공된다고 주장하지 않음 |
| 페르소나 주입 | native Agent `name`, `role`, `instructions`로 불변 anchor와 구분된 기억 데이터를 구성 |
| 회상·문맥 예산 | native 저장소에서 읽은 active tuple을 adapter가 정렬·선택해 매번 새 Agent의 instructions에 주입 |
| 출력 검사 | adapter가 최종 텍스트를 보류한 뒤 literal forbidden phrase 검사, 최대 한 번 교정 요청 |

## 선택적 CLOVA 연결과 측정 경계

`brain_client.py`는 비동기 JSONL 자식 프로세스 연결기이며, `brain_bridge.mjs`는 **기존 `runtime/clova/provider.ts`의 Brain을 import**한다. CLOVA HTTP 요청 형식·응답 검증·사용량 파싱·키 읽기·60초 timeout은 기존 Brain 구현을 사용한다. Agno용 provider를 새로 구현하거나 SDK의 외부 provider로 우회하지 않는다.

실제 SDK `Model.ainvoke`에 들어온 system/user/assistant/tool 메시지를 기록한 뒤 Brain에 넘긴다. `tool_calls`/`tool_call_id`를 Brain의 `toolCalls`/`toolCallId`로 바꾸고 JSON 문자열 arguments를 객체로 변환한다. 메시지의 순서와 텍스트는 유지한다. native Agent가 붙이는 role/instructions wrapper는 그대로 남으므로 다른 프레임워크와 system 문자열이 완전히 같다고 주장하지 않는다. 현재 연결은 텍스트·함수 도구와 async Agent 실행에 한정되며 streaming과 멀티모달은 지원하지 않는다.

- `ready`에는 `model`, `syntheticOnly`, `providerTransport`, `bridgePid`, `tools`, `maxTurns`, `maxTokens`를 포함한다.
- `model_context`는 실제 SDK callback 메시지와 `synthetic:false`를 기록한다. `model_response`는 `requestIndex`, `ok`, 원 응답 `content`, `finishReason`, `usage`, `providerTransport:'remote'`를 기록한다. loopback 시험에서도 이 값은 Brain의 네트워크 transport 경로를 뜻하며 외부 서비스에 호출했다는 뜻은 아니다.
- `provider_request`는 기존 Brain의 실제 fetch 호출 직전에 발생한다. `turn_end.providerCallAttempts`와 `externalModelCalls`는 해당 prompt의 HTTP 시도 수이며 실패·취소도 포함한다. `totalProviderRequests`는 worker 누적 값이다. 별도의 자동 재시도는 없고 native Model/Agent retries도 0이다.
- `turn_end.usage`는 확보한 provider 사용량의 합계다. 실패·취소 요청의 usage를 알 수 없으면 `usageComplete:false`다. 이때 기록된 0을 과금 0으로 해석하지 않는다. native SDK metrics와 adapter usage를 다시 더하지 않는다.
- `interrupt`는 진행 중인 Brain 요청의 AbortSignal로 전달한다. 응답을 2초 안에 정리하지 못하면 bridge를 종료한다. 기존 Brain의 요청 timeout은 60초, 연결기의 응답 상한은 65초, 기존 전체 operation 상한은 승인 대기를 포함해 120초다. EOF에서도 모델 요청을 중단하고 bridge·MCP를 종료한다.

키 본문은 Node Brain만 읽는다. Python은 키 파일 경로를 제한된 자식 환경에 전달하며, MCP 환경에는 모델 키나 키 경로를 전달하지 않는다. 임의 환경변수 전체를 bridge에 복제하지 않는다. `CLOVA_BASE_URL`은 기존 Brain의 HTTPS/loopback 정책을 그대로 따른다.

Agno는 모델 예외를 `RunOutput(status=ERROR)`로 반환할 수 있다. adapter는 native 상태를 정규화하고 마지막 모델 오류도 확인해 성공 텍스트로 내보내지 않는다. 최종 모델 응답이 아직 `tool_calls`인 경우도 `incomplete_model_turn`으로 실패한다. 따라서 승인 안내문이나 오류 문자열을 실제 모델의 성공 답변으로 취급하지 않는다. 승인·거절에 따른 도구 효과는 별도로 `tool_result.ok`와 실제 파일을 검사한다.

MCP 연결기는 이전 실험에서 가져온 최소 stdio JSON-RPC 연결기다. **Agno MCPTools 자체를 시험한 구현은 아니다.** 파일 도구의 실제 동작은 기존 서버에 맡긴다. MCP 자식에게 모델 키를 전달하지 않는다.

`update_memory_on_run=False`, `enable_agentic_memory=False`, `add_memories_to_context=False`다. 자동 추출과 native 자동 문맥 추가는 명시적으로 끄고 검증한 구조화 기억만 주입한다. Agent에는 session DB를 설정하지 않는다. MemoryManager에만 native SQLite 저장소를 연결한다. `telemetry=False`이며 별도 exporter를 설정하지 않는다.

## 저장·격리·증거 계약

- 기본 `session` namespace는 principal + persona ID + scope + conversation을 포함한다. 실험용 `long_term`에서는 기억 namespace에서 conversation을 제외한다. 두 scope의 기록은 서로 자동 합쳐지지 않는다.
- artifact 작업장은 scope와 관계없이 principal + persona ID + scope + conversation을 모두 포함한 hash로 분리한다. 장기 기억 공유가 파일 접근 공유로 이어지지 않는다.
- `observe`는 현재 프로세스에 digest/pointer만 등록한다. 원문 전체를 저장하지 않는다. 승인받기 전에는 기억·증거 ledger를 저장하지 않는다.
- `remember`는 닫힌 tuple과 유효한 시각·등록된 증거를 확인한 뒤 승인 요청을 보낸다. 승인 payload는 복사한다. 입력 tuple의 principal/scope/authority 등 추가 필드는 거부한다.
- 동일 `(kind, slot, thing)`의 value 또는 polarity가 바뀌면 revision을 증가시키고 이전 version을 superseded로 보관한다. 동일 value와 polarity는 idempotent다. 회상에는 최신 active 값만 들어간다.
- 승인 뒤에만 store 단위 POSIX `fcntl` lock을 취한다. 이 lock 안에서 durable 증거를 다시 확인하고 native read/upsert/delete를 수행한다. 승인 대기 중에는 lock을 잡지 않는다. 같은 turn ID를 다른 digest로 준비한 두 worker가 순서대로 승인돼도 나중의 충돌 저장은 거절된다.
- fact row에는 tuple와 해당 증거가 함께 저장된다. 추가로 별도 native `UserMemory` namespace에 **digest-only 증거 ledger**를 둔다. 이 ledger는 turn ID·digest·pointer·principal/persona/conversation metadata만 포함한다. 원문이나 tuple value는 넣지 않는다. ledger는 일반 recall과 모델 문맥 조회에서 제외한다.
- ledger는 마지막 관련 기억을 forget한 뒤에도 같은 증거 ID에 다른 원문을 연결하지 못하도록 유지한다. 값과 revision 삭제를 증거 ID 재사용 허용으로 해석하지 않는다.
- `forget`은 선택한 namespace의 matching fact rows와 그 안의 모든 revision을 native API로 삭제하고, 이전 응답·도구 결과에 남은 값의 재주입을 막도록 인프로세스 대화 history도 비운다.

`new`는 대화 history만 비운다. 명시한 store/namespace, 저장된 기억, operator persona, script 소비 위치를 임의로 바꾸지 않는다. principal/conversation은 실험을 실행하는 operator가 선택하는 식별자이며 로그인·인증 구현은 아니다.

## 페르소나와 실제 모델 문맥

persona는 시작 시 읽어 schema/알 수 없는 필드를 검증한다. 파일 bytes의 SHA-256을 `ready`와 모델 문맥 metadata에 노출한다. 모델·기억 명령에는 persona 수정 기능이 없으며 원본 파일을 다시 쓰지 않는다.

`role`과 JSON persona anchor를 native Agent의 역할/지시문에 전달한다. retrieved memory는 지시가 아닌 데이터라고 명시하며 권한 변경은 허용하지 않는다. 그 문구에 의존해 도구 승인을 구현하지 않는다. 승인 경계는 native HITL과 adapter 정책으로 따로 유지한다.

`--context-chars`는 Unicode code point 기준이다. anchor·기억 JSON·native role wrapper가 예산에 들어가도록 선택한다. anchor 자체가 안 들어가면 실패한다. Model.ainvoke가 **SDK에서 실제 받은 메시지 배열**을 `model_context.messages`로 내보내고 최종 system 문맥 길이도 다시 확인한다. `selectedCount`와 `omittedCount`를 기록한다.

2,400자 예산에 300자 값 8개를 넣은 실제 시험에서는 **1개 선택, 7개 생략, 실제 system 문맥 1,486자**였고 persona anchor가 유지됐다. 이전 system 메시지는 history에 보존하지 않으며, 매 prompt에서 최신 native 저장소를 다시 읽는다. 일반 대화 history까지 포함한 총 모델 토큰 예산을 구현한 것은 아니다.

선택적인 `outputRules.forbiddenPhrases`는 literal substring 검사다. 위반 최종 답변을 `text`로 내보내기 전에 한 번만 수정 feedback으로 Agent를 다시 호출한다. 재위반하면 `persona_violation`으로 종료하고 금칙 답변을 `text`로 전달하지 않는다. 이는 의미 기반 성격 평가나 실제 LLM의 페르소나 준수 성능을 측정한 것이 아니다. 실험 진단 이벤트인 `model_response.content`에는 검사 전 원 응답이, `model_context`에는 교정에 사용된 이전 assistant 메시지가 보일 수 있다. 실제 성격 비교는 outputRules를 넣지 않은 persona와 도구 없는 모드를 별도로 사용한다.

## 실제 실행 결과

1. 첫 공통 실행은 22개 중 21개 통과했다. 유일한 실패는 문맥 생략 수의 출력 필드명 누락이었다. `omittedCount` / `selectedCount`를 추가하고 해당 시험을 다시 실행해 통과했다.
2. 사용자별 실제 MCP 작업장 분리, forget 후 assistant가 echo했던 값의 재주입 차단, 두 프로세스의 같은 증거 ID 충돌을 각각 실행해 통과했다. 이후 루트 통합 실행에서 Agno 24개가 모두 통과했다.
3. 마지막 digest ledger 보완 후 `smoke.py`를 실제 실행해 통과했다. 승인된 저장 → forget → 새 프로세스의 변경된 증거 등록 거절, SQL 현재 행에 원문/tuple 값 없음, ledger의 recall/model context 제외를 확인한다.
4. digest-only ledger를 포함한 마지막 source 변경 후 공통 시험을 다시 실행해 **24/24 통과**했다. 실행 시각·source hash·개별 판정은 [agno.json](../results/agno.json), Pi와 합친 **48/48** 결과는 [comparison.json](../results/comparison.json)에 있다. 통합 시 현재 entrypoint의 hash가 실행 기록과 같은지도 확인했다.

위 1~4번은 합성 모델 응답, 실제 Agent, 실제 SQLite, 실제 로컬 MCP를 사용한 이전 기억 실험 결과다. 외부 모델 API 비용은 없다. native 자동 기억 추출, 임베딩 검색, 모델 답변 정확도, 대규모 성능 또는 운영 준비 상태를 실증한 결과는 아니다.

실제 모델 연결을 추가한 후에는 다음을 실행했다.

```bash
runtime/memory-lab/agno/.venv.local/bin/python -B runtime/memory-lab/agno/live_smoke.py

node runtime/memory-lab/run.mjs --frameworks agno \
  --output runtime/memory-lab/agno/.tmp/live-adapter-final-regression.json
```

- `live_smoke.py`: **PASS**, loopback HTTP 12회, 외부 provider 0회. 실제 SDK 메시지·도구 schema 전달, 승인된 MCP 쓰기, 사용량·종료 사유, 승인/거절 뒤 1회 요청 상한, `--tools none`, 임의 tool_calls 차단, HTTP 503, 중단 후 새 요청, EOF와 자식 정리를 검사했다. timeout 검사는 시험용 Node 프로세스에서 기존 Brain의 타이머만 500ms로 단축해 수행하며 production의 60초 값은 바꾸지 않는다.
- 최종 공통 회귀: **24/24 PASS**, 모든 cleanup 검사 통과. [최종 결과](../results/agno-live-adapter-final-regression-2026-11-10.json)의 source SHA-256은 `01f85ba04f49cce9e26144153b70727de499363f518c579aceff0f17a3a300bf`이며 최종 `cli.py`와 일치한다. 결과 생성 시각은 `2026-11-10T12:15:52.382Z`다.

첫 실제 모델 비교에서는 도구가 노출된 HCX-005가 기억 회상 요청에 파일 쓰기를 제안했다. 루트가 거절했고 실제 파일 효과는 없었으나, 1회 요청 상한 뒤 native 승인 문구가 성공 텍스트로 표시되는 오류가 드러났다. 이 실패를 성공한 persona 응답으로 세지 않는다. 해당 [첫 실행 보고서](../results/live-2026-11-10.json)와 raw events를 보존한다. 위 실패 경로를 loopback 회귀에 추가하고, 원 응답과 native 안내문을 구분하며 `--tools none`으로 순수 persona 평가를 할 수 있게 수정했다.

첫 실행의 CLI 원본은 [보존한 소스 snapshot](../results/agno-live-initial-cli-b61caeee76149d31fb1c99d3816520c6bfe19649e92cb172d5b6bb847e1161e7.py)에 복원했고 SHA-256 `b61caeee76149d31fb1c99d3816520c6bfe19649e92cb172d5b6bb847e1161e7`이 원 보고서와 일치한다. 첫 실행의 Agno restart ready는 `12:11:14.008249Z`, 마지막 idle은 `12:11:17.572726Z`, 이후 수정 시각은 `12:11:46.755229Z`였으므로 첫 실행 전체는 최초 코드로 수행됐다. 이 기록은 실패를 지우거나 수정 후 코드의 실제 모델 성공으로 바꾸기 위한 것이 아니다.

위 두 증거는 2026-11-11 커밋 준비 때 `.tmp` 원본의 바이트를 그대로 `results`에 복사하고 해시 일치를 확인했다. `.tmp` 원본은 변경하지 않았다. 결과 JSON 내부의 `rawArtifacts`는 당시 로컬 실행 경로이며 이 두 파일의 보존이 전체 임시 DB·로그의 배포를 뜻하지 않는다.

## 삭제 확인과 남는 데이터

삭제 후 실제 SQLite store를 읽어 확인했다. 해당 시험의 테이블은 `agno_lab_memories`, `agno_schema_versions`였으며 **sessions/runs 테이블은 없었다**. 따라서 이 구현이 native session history에 이전 assistant 응답을 별도로 보존하는 경로는 없다. 최종 ledger 구현에서는 삭제 후 digest-only ledger row가 남을 수 있으나, active 값과 revision은 recall 대상에서 제거된다.

이 확인은 SQL로 보이는 현재 데이터와 이후 모델에 전달하는 문맥에 대한 검사다. SQLite의 삭제된 페이지, OS 캐시, 별도로 남긴 비교 시험 event log·raw artifact에서의 **물리적·포렌식 삭제를 주장하지 않는다**. 실험 logs에는 이전 model_context와 합성 답변이 남는다.

## 장점과 실제 한계

- native SQLite와 사용자 기억 CRUD를 바로 활용해 프로세스 재시작 후 회상을 확인할 수 있다. native Agent의 role/instructions와 도구 HITL도 실제 연결됐다.
- 중요한 비교 결과는 기본 MemoryManager만으로 이번 격리·증거·revision·승인·삭제 문맥 계약이 완성되지 않는다는 점이다. 그 부분을 adapter가 명시적으로 보완했다.
- model-bound 메시지를 기록하므로 “저장됐는가”와 “실제로 모델에 전달됐는가”를 분리 검사할 수 있다. persona 준수 품질은 별도 live 모델 시험이 필요하다.
- 동시성 lock은 같은 규칙을 따르는 이 CLI worker 사이의 직렬화다. SQLite 파일을 직접 고치는 외부 프로그램까지 통제하지 않는다. POSIX fcntl을 사용하므로 이 설치 형태의 Windows 지원은 검증하지 않았다.
- native fact upsert 자체는 SQLite 작업이다. 별도 digest ledger와 fact upsert는 두 native 쓰기다. process lock으로 다른 worker와의 read/write 경쟁은 막지만, 두 쓰기 사이의 crash를 하나의 SQLite transaction rollback으로 묶지는 않았다. crash 시 digest binding만 남을 수 있으며 그것을 기억 생성 완료로 표시하지 않는다.
- 여러 row를 forget하는 도중 저장소 오류가 나면 전체 삭제의 transaction rollback은 제공하지 않는다. 완료 여부를 재조회해 오류를 표시한다. WAL 손상·강제 전원 중단 등의 복구 시험은 하지 않았다.
- revision history의 압축·만료·보존 기간은 구현하지 않았다. 명시적인 forget이 해당 fact의 이전 revision도 제거한다.
- 성공적인 최종 텍스트만으로 도구 효과 성공을 판정하면 안 된다. `tool_result.ok`, SQL 상태, 실제 파일 검사를 함께 본다.

공식 API 확인 자료: [Standalone Memory](https://docs.agno.com/memory/working-with-memories/standalone-memory), [Memory with SQLite](https://docs.agno.com/memory/working-with-memories/sqlite-memory), [Agent Context Engineering](https://docs.agno.com/context/agent/overview), [Native User Confirmation](https://docs.agno.com/hitl/user-confirmation). 실제 호출 가능한 signature는 설치한 3.1.12 소스에서 추가 확인했다.
