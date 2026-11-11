# Elda-CLI용 CLOVA Wrapper

2026-11-11 후속: [H20+ 본문 오류 전달 수정과 H31 준비 결과](H20-CYCLE4-RESULT-2026-11-11.md). 공급자 코드·오류 분류·재시도 가능 여부를 보존하며, 세 하네스의 실제 동일 과제 비교는 아직 미수행이다.

전체 구현·검증·실패 수정·배포 이력과 남은 작업은 [2026-11-10 작업 기록](../../WORKLOG-2026-11-10.md)에 정리했다. 아래의 초기 독립 루프 시험과 현재 LangGraph 시험은 서로 다른 단계의 기록이다.

자체 하네스의 다른 구축 방식과 공식 근거는 [② 하네스 후보 조사](../../HARNESS-OPTIONS-2026-11-10.md)에 정리했다. 그중 Vercel·PydanticAI·Pi는 별도 프로토타입을 구현해 기존 LangGraph와 비교했다. [51개 공통 검사와 장단점](../../HARNESS-PROTOTYPE-RESULTS-2026-11-10.md), [재현 명령](../harness-lab/README.md)을 참고한다. 신규 후보는 아직 실제 Elda-CLI·웹에 연결하지 않았다.

기억·페르소나는 별도 [조사·48개 실행 검사](../../MEMORY-PERSONA-RESULTS-2026-11-10.md)로 확장했다. 기본 대화 범위, 근거·승인·정정·잊기·persona anchor를 Pi/Agno에서 실제 DB·SDK·MCP로 검증했다. 모델 응답은 scripted이며 운영 장기 기억을 활성화하지 않았다.

후속으로 [실제 HCX-005 말투·성격 유지 검사](../../LIVE-PERSONA-RESULTS-2026-11-10.md)를 수행했다. 최종 32개 원문과 첫 도구 호출 실패를 별도 보존했으며, API 완료와 페르소나 유지 판정을 구분한다.

## 추가 API 비교 — ②만 (2026-11-10)

이번 추가 범위는 **Elda-CLI → 얇은 어댑터 → 자체 LangGraph 하네스 → API + MCP**의 ② 승인 모드다. Groq `openai/gpt-oss-120b`, OpenRouter `cohere/north-mini-code:free`, 중국 Z.ai `glm-4.7-flash`를 고정 후보로 연결한다. 새 공급자를 ①·③으로 확장하지 않으며 기존 CLOVA 경로는 유지한다.

**현재 검증:** 세 공급자의 로컬 모의 HTTP API를 대상으로 실제 Elda-CLI 격리 사본, LangGraph, MCP 파일 도구를 실행했다. 각각 생성·수정·undo/read의 정확한 파일 내용, 승인 4회, 대화 유지, 키 격리, 종료 후 프로세스 정리를 통과했다. 모의 응답의 사용량은 합성값이다. **신규 공급자의 실제 API 키가 없어 실제 모델 검증은 아직 하지 않았다.** 키 등록 여부는 인증 성공이나 모델 과제 성공을 뜻하지 않는다.

```bash
# 외부 API 호출 없이 실제 CLI/하네스/도구 연결 검사
npm run test:mode2-compare -- --mock
# 키 값 없이 전용 저장소/환경변수 경로 준비
npm run configure:mode2 -- --init
# 서비스 콘솔에서 발급한 키를 터미널에서 숨김 입력
npm run configure:mode2 -- groq
npm run configure:mode2 -- openrouter
npm run configure:mode2 -- zai
# 저장된 키 값은 출력하지 않음
npm run configure:mode2 -- --status
# 키를 등록한 공급자만 실제 비교 실행
source ~/.config/elda-clova/providers/providers.env
npm run test:mode2-compare -- --live --providers groq
```

등록 도구는 키를 발급하지 않는다. 발급된 키를 `~/.config/elda-clova/providers/{groq,openrouter,zai}.key`에 권한 600으로 저장한다. 폴더 권한은 700이며 `providers.env`에는 키 값 없이 파일 경로만 있다. 키를 명령 인자·채팅·브라우저에 넣지 않는다. 서버는 `GROQ_API_KEY_FILE`, `OPENROUTER_API_KEY_FILE`, `ZAI_API_KEY_FILE`을 사용한다. 파일 경로 설정을 반영한 서버에서는 키 저장 후 새 세션부터 읽는다. 신규 공급자의 기본 URL은 고정된 공식 HTTPS 주소이고 `*_BASE_URL` 재정의는 loopback 모의 서버만 허용한다.

로컬 CLI와 배포 서버의 저장소는 별개다. 현재 둘 다 경로 설정만 준비돼 있고 실제 키 파일은 없다. 기존 배포 서버의 웹 테스트용 등록은 아래처럼 실행한다. 서버 `.env`에는 세 파일 경로를 이미 등록했다. 키를 저장한 뒤 페이지를 새로 고침하면 등록 상태를 다시 읽는다.

```bash
ssh -t hellcat python3 /home/gino/apps/clova-api-lab/configure-provider.py groq
# 마지막 인자를 openrouter 또는 zai로 바꿔 각각 등록
```

공개 가능한 모의/실제 미실시 요약은 `public/mode2-comparison-report.json`이며 웹에서 내려받을 수 있다. 키 저장 도구 검사는 `python3 runtime/clova/test/test_configure_provider.py`로 실행한다.

Groq의 무료 사용 여부는 계정 요금제·할당량에 따른다. OpenRouter는 `:free` 모델과 가격 0 조건을 고정하고 유료 대체 모델로 전환하지 않는다. Z.ai는 위 Flash 모델만 허용한다. 무료 모델 제공 여부와 계정 한도는 실행 시 공급자 콘솔에서 확인해야 한다. 한도가 소진되거나 지원 모델이 바뀌면 실패로 기록한다.

결과는 기본 `mode2-mock.local/` 또는 `mode2-live.local/`에 JSON, 이벤트, 실제 파일 스냅샷으로 남는다. `--output DIR`로 경로를 지정한다. 상태는 `mock_passed`, `live_passed`, `failed`, `not_configured`로 분리하고 키 없는 live 시험은 `pass:false`다. 설치 CLI를 복사해 패치를 적용하며 설치본을 직접 수정하지 않는다.

기존 웹의 하네스 화면에서 신규 공급자는 ②만 선택할 수 있다. 키 미등록이면 실제 실행 버튼이 비활성화된다. ‘무료 연결 확인 · 대본’은 API를 부르지 않는 별도 배선 검사다. **웹은 같은 LangGraph 하네스를 직접 구동하며 Elda-CLI 프로세스 자체를 띄우지는 않는다. 실제 Elda-CLI 경유 검증은 위 비교 명령으로 수행한다.** 기존 CLOVA 3모드 결과는 이전 기록으로 별도 표시한다.

이 프로젝트의 담당은 **기존 Elda-CLI가 사용할 CLOVA Wrapper와 비교 시험용 자체 하네스**다. 사용자 확정: ①은 Claude Code 하네스에 CLOVA 모델을 연결할 수 있는지 검증하고, ②는 별도로 만든 자체 하네스에 같은 CLOVA 모델을 연결해 비교한다. ③은 자체 경로의 서빙 정책을 검증한다. ①·②를 같은 루프로 합치면 비교 목적이 사라진다. 소스 직접 실행은 Node.js 24 이상이며, 배포 번들은 Node.js 20을 대상으로 한다.

## 자매 프로젝트 분석과 담당 범위 (2026-11-10)

분석 기준: Elda-Spec `8bcf06c`, Elda-AI-Agent `02e8af0`, 실제 Elda-CLI `4f6d90e`.

- Elda-AI-Agent의 `cli-wrapper/`는 폐기된 사본이다. 현재 실행본은 별도 Elda-CLI 저장소의 `elda`이며 이 환경에서는 `/home/gino/apps/elda-cli/elda`다. PATH에 남은 옛 `elda`를 사용하지 않는다.
- Elda-AI-Agent는 mini-api·워크스페이스·serve-gate·Runtime·기록을 제공한다. 기존 서빙 길은 `serve-gate → Elda-CLI → vector-mcp → VectorCraft`다.
- Elda-CLI의 `events.py`, `adapters/loop.py`, `providers/`, `mcp_client.py`가 이번 연결의 소비자다. 공급자 블록은 text/tool_use/tool_result이며 일반 외부 profile 파일 로더나 provider 플러그인 로더는 아직 없다.
- EldaCore는 모델 관문·라우팅·페르소나·학습 쪽 담당이다. CLOVA Wrapper는 단일 네이버 API의 연결·형식 변환을 담당하며 EldaCore 전체를 구현하지 않는다.
- 규격은 Elda-Spec의 최신 SPEC를 따른다. Elda-AI-Agent의 옛 규격 사본·전략 문서·미래 계획을 현재 구현으로 취급하지 않는다. 세 모드 문서에는 ② 보류 표기도 있으므로 아래 테스트가 ② 제품 UI·봇 운영 전체의 완성을 뜻하지 않는다.

| 모드 | Elda-CLI의 역할 | CLOVA 연결 | 자체 테스트의 범위 |
|---|---|---|---|
| ① 조수/attach | Claude Code 본체에 붙어 입력·기록 중계 | Claude Code 하네스 → Anthropic 형식 변환 Wrapper → CLOVA API | 실제 Claude Code print 세션과 Elda interactive attach를 별도로 검증. Claude 모델을 사용하지 않음 |
| ② 구동 | 자체 하네스로 CLOVA 모델과 도구를 운전, 승인 처리 | LangGraph StateGraph → 공통 Brain → CLOVA API | ①과 같은 모델·과제·도구·한도로 하네스 차이 비교. 기존 Elda-CLI loop 연결 검사는 별도 통합 검사 |
| ③ 서빙 실행 | 같은 루프를 승인 질문 없이 격리된 대화에서 실행 | LangGraph StateGraph + 무승인 정책 → CLOVA API | 대화 유지·도구 결과 재주입·중단·반납 계약; 운영 입구는 기존 serve-gate 영역 |

```text
① Claude Code 하네스 ← Elda-CLI attach
      └─ Anthropic Messages 변환 Wrapper → CLOVA Studio v3

② 자체 LangGraph 하네스 / ③ 서빙 정책 ← Elda-CLI 얇은 어댑터
      ├─ 공통 Brain → CLOVA Studio v3
      └─ MCP → 도구 Wrapper
```

2026-11-10 공식 공개 문서 확인: 네이버는 Function calling API, OpenAI 호환 API, [langchain-naver 및 LangGraph 연동 안내](https://guide.ncloud-docs.com/docs/en/clovastudio-dev-langchain)를 제공한다. Claude Code처럼 설치해서 사용하는 완성된 공식 에이전트 하네스는 확인하지 못했다. 이는 모든 하네스 연동을 지원하지 않는다는 뜻은 아니다. [Claude Code의 비-Claude 모델 연결은 Anthropic 공식 지원 대상이 아니므로](https://code.claude.com/docs/en/llm-gateway) ①은 별도 호환 실험으로 표시한다.

HTTP Wrapper는 Anthropic `/v1/messages?beta=true`와 OpenAI `/v1/models`, `/v1/chat/completions`를 제공한다. OpenAI 경로는 기존 Elda-CLI의 `openai-compat:HCX-005@http://127.0.0.1:<port>/v1`로 연결한다. 네이버 키는 Wrapper의 `CLOVA_API_KEY_FILE`(권한 600)에만 둔다. 별도 Wrapper 접속 토큰은 `CLOVA_WRAPPER_TOKEN_FILE`로 설정하고, 기존 CLI는 그 접속 토큰을 `ELDA_API_KEY`에서 읽는다. 이 토큰은 네이버 키가 아니다. 현재 CLI는 `ELDA_API_KEY_FILE`을 지원하지 않으므로 전체 서빙 키 파일 계약의 완성으로 주장하지 않는다.

네이버 형식 변환 근거: [CLOVA Studio Function calling 공식 문서](https://api.ncloud-docs.com/docs/en/clovastudio-chatcompletionsv3-fc). `toolCalls`, `toolCallId`, 인자 객체, 종료 이유, 토큰 사용량을 보존한다. 모델 호출을 자동 재시도하지 않는다.

`harness.ts`, `live.ts`는 앞서 만든 독립 루프의 참고 구현이다. 새 자체 하네스와 웹 실행기는 `langgraph.ts`를 사용한다. `test/elda-modes.test.ts`의 기존 Elda LoopAdapter 시험과 새 LangGraph 어댑터 시험은 구분한다.

## 재현 가능한 비교 실행

2026-11-10 실제 HCX-005 결과: 공통 v2 과제에서 세 경로 모두 생성·수정·undo/read 3턴과 정확한 파일 내용 검사를 통과했다. 직접 하네스 비교에서는 각각 모델 6회·도구 4회였다. 추가로 Elda interactive attach와 격리 CLI 사본의 LangGraph 어댑터 ②·③ 경로도 실제 API로 각각 3턴을 통과했다. 설치 CLI는 변경하지 않았다. 공개 가능한 요약은 `public/comparison-report.json`, 원본 이벤트와 파일은 `comparison-live-v2.local/`, `comparison-attach-live.local/`, `comparison-elda-live.local/`에 보관한다.

첫 v1 과제는 문구 끝의 마침표가 모호해 세 하네스가 마침표까지 저장하여 정확한 내용 검사가 실패했다. 원본 `comparison-live.local/`은 보존했다. v2는 JSON 문자열로 저장 내용을 명시했다. 실패 결과를 성공으로 바꾸거나 출력 파일을 수정하지 않았다.

공개 웹의 첫 실API 검사에서는 이전 시스템 지시문을 쓰던 프로필에서 두 번째 턴의 모델이 도구 없이 완료를 주장해 파일 검사가 실패했다. 웹 프로필을 같은 `comparison.json.systemPrompt`에서 읽도록 통일하고 모의 HTTP 요청에서도 일치를 검사한다. 재배포 후 공개 페이지에서 ②·③ 각각 3턴·모델 6회·도구 4회·정확한 파일 내용·승인 4/0회·브라우저 오류 0건을 확인했다. `results.local/deployed-langgraph/`에 실패와 최종 성공 기록을 함께 보관한다. UI의 '응답 완료'는 모델 턴 종료이며, 임의 작업의 정확성을 자동 보증하는 표시가 아니다.

```bash
npm run test:clova-runtime
npm run check:clova-runtime
# 모의 CLOVA + 설치된 실제 Claude Code + 실제 LangGraph/MCP, 과금 없음
npm run test:clova-compare -- --mock
# 같은 과제를 실제 유료 API로 실행 (키 내용은 파일에만 둠)
CLOVA_API_KEY_FILE=/absolute/path/to/clova.key npm run test:clova-compare -- --live
# 자체 하네스 단독 실행
npm run clova:graph -- --events --workspace /tmp/clova-graph --model clova:HCX-005 --approve ask
# 서빙에서는 --approve never
```

`fixtures/comparison.json`이 공통 과제다. 모델 HCX-005, temperature 0, 출력 최대 2,048토큰, 턴당 모델 왕복 최대 4회·120초, 동일한 네 파일 도구로 생성 → 수정 → undo/read를 수행한다. 실제 파일 바이트, 도구 결과, 대화 유지, 사용량과 정리를 검사한다. ② 비교 실행에서는 시험 제어기가 네 파일 도구만 승인하며, 웹에서는 사람이 승인·거절한다. ③은 승인 질문이 없다.

Claude Code 고유 프롬프트와 도구 접두어, native max-turns의 세부 의미는 LangGraph와 다르다. 따라서 단일 과제 성공은 기능 연동 증거이며 일반 모델 품질·속도 순위가 아니다. 결과는 `comparison-mock.local/` 또는 `comparison-live.local/`의 report.json·events.jsonl·파일 스냅샷에 남는다. `.local` 디렉터리는 git에서 제외한다. `--output DIR`로 실행별 기록을 분리할 수 있다.

①은 `claude-probe.ts`가 별도 설정 폴더에서 설치된 Claude Code를 실행한다. 원본 네이버 키는 Wrapper에만 두며 Claude에는 별도 접속 토큰만 전달한다. native Claude가 켜는 thinking/cache/effort/beta 기능은 명시적으로 끈다(`MAX_THINKING_TOKENS=0`, `DISABLE_PROMPT_CACHING=1`, `CLAUDE_CODE_EFFORT_LEVEL=unset`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`). 지원하지 않는 입력은 조용히 무시하지 않고 거절한다. SSE는 CLOVA의 완성 응답을 받은 뒤 이벤트로 전달하며 `x-clova-streaming: buffered-native`로 표시한다. 실시간 토큰 스트리밍·TTFT 측정으로 해석하지 않는다.

기존 Elda-CLI에 등록할 얇은 어댑터와 패치는 `integration/`에 있다. 설치된 CLI는 변경하지 않는다. 격리한 CLI 사본에 패치를 적용해 `elda clova --events --approve ask|auto`가 실제 LangGraph 자식으로 중계되는지 검사한다. 모델 루프를 Elda와 LangGraph에서 이중 실행하지 않는다. ① Elda attach 검사는 설치된 Claude interactive 세션을 별도 private tmux에 띄워 실제 CLI의 attach·tool 이벤트·EOF 후 native 생존을 검사한다.

기존 웹페이지의 하네스 화면은 로컬 실제 비교 결과와 ②·③ 직접 실행을 제공한다. ①의 Claude native 세션은 로컬 검증 대상이며, 웹에서 Claude를 새로 실행하는 기능은 제공하지 않는다. 본 기능은 전체 다중 사용자 운영·Core 완성이 아니다.

## 이전 독립 실행기 구조와 기준

```text
JSONL 입력 → harness.ts → provider.ts → CLOVA Studio v3
                    ↕
               client.ts → stdio MCP 서버(대화 동안 유지)
                                └ 기본: clova-mcp → 작업장 파일

외부 MCP 클라이언트 → clova-mcp → clova_chat → CLOVA Studio v3
```

- 규격: `reference/Elda-Spec/harness/SPEC.md` v0.7, `mcp-wrapper/SPEC.md` v1.1, records v0.1. 분석 기준 커밋 `8bcf06c`.
- API: [네이버 공식 Function calling 문서](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-fc). `/v3/chat-completions/{model}`, Bearer 인증, `toolCalls`, `toolCallId`를 사용한다. legacy v1은 도구 실행 하네스에 사용하지 않는다.
- 구현은 **실행기·MCP와 기존 웹페이지의 인증된 테스트 입구**다. 다중 고객용 serve-gate, 일일 한도, cgroup 자원 격리는 별도 계층이다. 실행기 키트 통과는 전체 서빙 하네스 적합 인증이 아니다.
- 외부 앱 MCP는 Elda-Spec 적합성·소유자 리뷰를 마친 구현을 운영자가 프로필에 등록한다. 이 실행기가 외부 앱의 적합성을 대신 인증하지 않는다.

## 무료 배선 실행

저장소 루트에서:

```bash
node runtime/clova/harness.ts --events --workspace /tmp/clova-demo \
  --model scripted:runtime/clova/fixtures/brain.json
```

프로세스의 stdin에 한 줄씩 넣는다. `idle`을 받은 뒤 다음 줄을 넣는다.

```json
{"op":"prompt","text":"작업장 목록을 확인해 줘"}
{"op":"new"}
{"op":"prompt","text":"다시 확인해 줘"}
```

대본은 목록 호출 → 완료 답변을 반복한다. 모델 품질 시험이 아닌 무료 프로토콜·도구 배선 시험이다. EOF·SIGINT·SIGTERM은 진행 중인 턴을 취소하고 MCP 프로세스 그룹을 정리한다. 입력을 모두 파이프로 보내자마자 EOF를 닫으면 실행을 취소하므로 자동 클라이언트는 `idle`까지 stdin을 열어 둔다.

## 네이버 API로 실행

운영자가 발급받은 API 키를 파일에 저장하고 권한을 600으로 설정한다. 키 내용을 명령줄·프런트에 넣지 않는다.

```bash
export CLOVA_API_KEY_FILE=/absolute/path/to/clova.key
chmod 600 "$CLOVA_API_KEY_FILE"
node runtime/clova/harness.ts --events --workspace /tmp/clova-live \
  --model clova:HCX-005 --records /tmp/clova-records
```

`HCX-005`는 공식 문서의 모델 예시다. 계정에서 사용 가능한 Function calling 지원 모델을 선택한다. 실 API 실행은 유료다. 자동 회귀 시험은 대본 및 로컬 HTTP 모의 서버를 사용하며, 실제 호출은 아래 라이브 시험 명령으로 따로 실행한다.

`CLOVA_BASE_URL`은 기본 `https://clovastudio.stream.ntruss.com`이다. HTTPS를 요구하고 로컬 테스트용 loopback HTTP만 예외로 허용한다. 키 파일의 값만 사용하며 `CLOVA_API_KEY` 환경 값은 읽지 않는다.

## MCP 직접 실행

```bash
node runtime/clova/mcp.ts mcp --workspace /tmp/clova-tools
node runtime/clova/mcp.ts mcp --workspace /tmp/clova-tools --lean
```

패키지 명령: `npm run clova:mcp -- mcp --workspace DIR`, `npm run clova:harness -- --events --workspace DIR`.

| 도구 | 기능 |
|---|---|
| `api_version` | API 버전 `1.0.0` |
| `artifact_list` | 작업장 최상위 목록, 링크를 따라가지 않음 |
| `artifact_read` | UTF-8 파일 읽기, 최대 1 MiB |
| `artifact_write` | UTF-8 파일 원자적 저장, 최대 100000자. 부모 폴더는 이미 있어야 함 |
| `artifact_undo` | 최근 쓰기 한 단계 복원, 세션 안 최대 40개 |
| `clova_chat` | 단일 텍스트 생성. 유료. 도구 실행 없음 |
| `batch` | 최대 40단계, `as`·`$이름.id` 참조, 실패 단계에서 정지 |

`clova_chat`은 `CLOVA_MODEL`(기본 `clova:HCX-005`)을 사용한다. 모델·키·URL을 도구 인자로 받지 않는다. `CLOVA_MCP_NOTE`는 시작 안내에 덧붙인다. lean 모드의 도구 목록은 batch 하나다.

모든 파일 도구는 상대·절대 경로 이탈과 기존 심볼릭 링크 이탈을 차단한다. 파일은 임시 파일 기록 후 rename으로 교체한다. batch 전체를 롤백하지 않으며 `completed`, `results`, `failed`를 확인해야 한다. 참조 이름은 MCP 프로세스 수명 동안 유지한다.

이 래퍼에는 별도의 메모리 문서가 없고 `artifact_write`가 즉시 저장하므로 AUTOSAVE·convert는 제공하지 않는다. W25 권장 항목은 키트에서 경고 1로 나온다. `clova_chat`은 외부 API 사용량이 발생하므로 실패 시 외부 과금까지 롤백하는 원자성을 보장할 수 없다. 파일 쓰기의 원자성과 구분한다.

## 실행기 프로필

`--config /path/to/profile.json` 예:

```json
{
  "model": "clova:HCX-005",
  "system": "작업장 안에서 요청한 문서를 만들고 결과를 확인한다.",
  "maxTurns": 12,
  "timeoutMs": 300000,
  "servers": [
    {
      "name": "clova",
      "command": ["node", "/absolute/path/to/runtime/clova/mcp.ts", "mcp", "--workspace", "{workspace}"],
      "allowedTools": ["artifact_list", "artifact_read", "artifact_write", "artifact_undo"]
    }
  ]
}
```

- 모델 우선순위: `--model` → `CLOVA_MODEL` → 프로필 → 기본.
- 왕복 상한: `CLOVA_MAX_TURNS` → 프로필 → 12. 시간 상한 기본 300초.
- 서버 명령은 작업장을 cwd로 실행하므로 실행 파일·스크립트는 절대 경로를 권장한다. `env`로 필요한 환경만 명시한다. 부모의 API 키 환경은 MCP 자식에 자동 전달하지 않는다.
- 모델에 보이는 도구 이름은 `<서버>__<도구>`다. 기본 프로필은 파일 도구만 허용하여 모델이 다시 `clova_chat`을 호출하는 중첩 과금을 피한다.
- `allowedTools`가 없으면 등록 서버의 모든 도구를 허용한다. batch를 허용하면 그 서버의 내부 도구 전체를 실행할 수 있으므로 부분 허용 프로필에는 batch를 넣지 않는다.
- `toolCallLimits`로 이름별 한 턴 실행 상한을 둘 수 있다. 예: `{"clova__artifact_undo":1}`은 중복 되돌리기를 실행하지 않고 모델에 거절 이유를 돌려준다. 기본은 제한 없음이며, 작업 정책에 맞춰 명시한다.
- 모델별 fallback은 수행하지 않는다. EldaCore 관문 연결 때 관문 한 곳에서 담당한다.

가격 상한을 켜려면 `maxBudgetUsd`와 `prices` 네 칸을 함께 지정한다. `prices`는 USD/1M tokens 단위의 운영자 제공 단가다. 실제 단가를 추측해 내장하지 않는다.

```json
{"maxBudgetUsd":0.5,"prices":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0}}
```

위 단가는 **형식 예시이며 네이버 실제 가격이 아니다**. 비스트리밍 API 응답 후 실제 usage를 알 수 있으므로 한 호출만큼 초과할 수 있다. 응답 후 상한에 닿으면 도구 실행·답변 전달 전에 멈추고 이후 모델 호출도 막는다. `new`로 비용 누계를 초기화하지 않는다. usage 누락은 0으로 속이지 않고 오류로 처리한다. 네이버 캐시 사용량은 이 계약에서 제공받지 않으므로 두 캐시 칸은 0이다.

## 이벤트·중단·오류

stdout은 `{v:1,seq,ts,t,data}` JSONL만 출력한다. seq는 프로세스 전체에서 연속 증가한다.

- 입력: prompt, new, interrupt, notify, approve. 서빙은 승인을 묻지 않으며 approve에는 `approval_disabled` 오류를 반환한다.
- notify는 다음 턴에 주입한다(최대 16개). 진행 중 prompt/new는 busy 오류다.
- `new`는 대화 기록·sessionId를 갱신한다. 작업장과 MCP 프로세스는 유지한다.
- `turn_end`는 usage 네 칸·모델·세션·왕복·도구 호출·시간·endReason을 포함하며 비용은 포함하지 않는다.
- 시간 초과·사용자 중단은 `error{code:interrupted}` 다음 `idle`, turn_end 없음.
- API 429/500/502/503/529는 실제 도구가 실행되기 전 한 번만 재시도한다. 도구 실행 이후에는 재시도하지 않는다.
- 도구 실행 후 턴이 실패하거나 전송이 중단되면 상태를 추측해 이어가지 않는다. `idle.requiresRestart:true`를 내고 추가 prompt/new를 거절한다. 입구가 프로세스를 반납하고 새 작업장으로 시작해야 한다.
- EOF 때 프로세스 그룹을 종료한다. 사용자가 지정한 작업장·결과물 자체는 삭제하지 않는다.

## 훅과 판정

프로필 `hooks`에 `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`을 등록할 수 있다.

```json
{"hooks":{"Stop":{"command":["node","/absolute/path/judge-hook.js"],"timeoutMs":5000,"onFailure":"block"}}}
```

훅은 JSON 요청 한 개를 stdin으로 받고 JSON 응답 한 개를 stdout에 반환한다. 공통 입력은 session_id·cwd·hook_event_name, 각 자리의 prompt/tool_name/tool_input/tool_use_id/tool_response/stop_hook_active/last_assistant_message를 추가한다.

지원 출력은 continue, decision:block, reason, hookSpecificOutput.additionalContext, PreToolUse의 permissionDecision·updatedInput이다. 현재 LangGraph에서 deny/defer는 거절하고, ask는 ②에서 실제 승인 대기를 만든다. 무승인 정책에서 ask를 요구하면 거절한다. 초기 `harness.ts`의 ask/defer 처리와 구분한다. Stop 차단은 한 번 수정시킨 뒤 다시 차단되면 실패로 끝낸다. 최종 답변은 Stop 통과 후에만 전달한다. 훅 실패 기본은 차단이며 명시적으로 onFailure:continue를 선택할 수 있다.

전체 Claude 훅 API 구현을 주장하지 않는다. updatedToolOutput, 정규식 매처, SDK 고유 필드는 아직 지원하지 않는다. 훅 명령은 운영자가 관리하는 신뢰된 프로그램이다.

## 기록·격리 책임

`--records DIR`을 사용하면 비밀을 가린 세션 이벤트 jsonl과 summaries.ndjson을 기록한다. 요약에는 시간·종료 이유·usage·세션 누적 비용을 남긴다. 시작할 때 90일이 지난 jsonl을 삭제한다. 모델 입력 대화 원본은 별도 저장하지 않는다.

R1~R5 기반 공통 가림 함수는 등록한 실제 키, 대표 키 패턴, 인증 문자열과 비밀 필드를 처리한다. 모든 개인정보를 판별하는 PII 분류기는 아니다. 요약 영구 보관·사람별 삭제·DB 복제 정책은 입구/DB 계층에서 구현해야 한다.

작업장은 독점 사용해야 한다. 경로 검사는 OS 샌드박스가 아니며 다른 프로세스의 동시 링크 교체와 외부 MCP·훅 자체의 권한을 제한하지 못한다. 공개 서빙 시 H22~H25에 따라 입구 인증, 사용자별 작업장, 동시 빌림 2개, cgroup 메모리·CPU·스왑 상한, idle/detach 반납을 갖춘 serve-gate에서 실행해야 한다. 아래 웹 테스트 입구는 전용 접속 코드와 세션 제한을 갖춘 내부 시험용 기능이다.

## 검증

저장소 루트에서:

```bash
npm run check:clova-runtime
npm run test:clova-runtime
node reference/Elda-Spec/mcp-wrapper/kit/check.ts runtime/clova/conformance.json
node reference/Elda-Spec/harness/kit/check.ts runtime/clova/harness.json
```

외부 reference 링크 없이도 첫 두 명령은 동작한다. 규격 키트 경로만 공유 reference에 의존한다. 키트 소스를 복사하거나 수정하지 않는다.

추가 회귀 시험은 파일 원자성·undo·경로와 링크 이탈·batch 부분 실패, 로컬 HTTP v3 계약, 인증 파일 권한, 두 턴 세션 유지/new, max_turns, Stop 차단, timeout, 도구 전/후 재시도 경계, 비용 상한을 검증한다. 라이브 API 시험 결과는 별도 report.json으로 보관한다. 운영 서비스 배포와 공개 서빙 입구 검증은 포함하지 않는다.

## 실제 유료 API 시험

사용자가 크레딧 사용을 승인한 경우 다음 명령으로 MCP 생성 1건과 하네스 파일 생성·수정·되돌리기 3턴을 시험한다. 결과 문구뿐 아니라 실제 파일 내용과 필수 도구 호출을 확인한다. 라이브 시험 프로필은 undo를 턴당 한 번으로 제한한다(실제 HCX-005의 중복 호출에서 발견한 회귀).

```bash
export CLOVA_API_KEY_FILE=/absolute/path/to/clova.key
export CLOVA_MODEL=clova:HCX-005
npm run test:clova-live -- --live --out /tmp/clova-live-results
```

출력 폴더는 새 경로를 사용한다. 세 턴은 같은 sessionId로 진행하고 각각 모델 왕복 최대 3회, 시간 120초다. 생성당 출력 상한은 2048토큰이며 도구 실행 전 일시 오류 재시도는 별도 한 번이다. 실패하면 다음 과제를 진행하지 않는다. `report.json`, `workspace/hello.txt`, `records/`에서 결과·usage·이벤트를 확인한다. 실제 단가와 크레딧 차감액은 네이버 콘솔에서 확인하며 보고서 비용은 임의로 추정하지 않는다.

Node 20 호스트에서는 TypeScript 원본 대신 번들을 사용한다.

```bash
npm run build:clova-runtime
node server-dist/clova/live.mjs --live --out /tmp/clova-live-results
```

번들 세 파일(live.mjs·harness.mjs·mcp.mjs)을 같은 폴더에 배치한다. 기존 웹 서버를 재시작하거나 변경할 필요가 없다. 인증 파일은 운영자 환경에서 공급하며 시험용으로 만든 키 사본은 종료 후 삭제한다.

2026-11-10 HCX-005 실제 시험: 보완 후 4/4 통과(단일 생성·파일 생성/읽기·후속 수정/읽기·undo/읽기). 중복 undo는 턴별 실행 상한이 차단했다. 최종 실행 usage는 입력 3,164·출력 336토큰, 실패 분석을 포함한 3회 실행 합계는 입력 8,586·출력 977토큰이다. API 키 임시 사본은 삭제했고 기존 운영 서비스는 변경하지 않았다. 로컬 상세 증거는 `results.local/final/report.json`, 전체 실행 요약은 `results.local/summary.json`에 보관한다(개발 환경 증거, git 제외).

## 기존 웹페이지에서 테스트

배포 위치는 기존 `https://elda-ai.org/giants/`의 **Clova → 하네스 테스트** 탭이다. 바로 열기 경로는 `?view=harness`다. 운영자가 전달한 전용 링크의 fragment `#access=…`는 서버 요청·nginx 로그에 전송되지 않으며, 화면에서 읽은 즉시 주소에서 제거한다. 테스트 접속 권한만 브라우저 탭의 sessionStorage에 보관하고, 실제 네이버 API 키는 서버 밖으로 보내지 않는다.

1. 실제 CLOVA 또는 무료 대본을 선택한다.
2. 파일 만들기 → 내용 수정 → 되돌리기 예제를 하나씩 실행한다.
3. 도구 실행 내역을 펼쳐 입력·결과를 확인한다.
4. 오른쪽 결과 파일과 ‘파일 내려받기’, ‘기록 저장’으로 결과를 저장한다.
5. 중단 또는 새 테스트로 실행을 정리한다.

웹 입구는 인증된 요청만 받고 브라우저별 세션을 분리한다. 동시 세션 2개, 세션당 20회 요청, 요청당 모델 왕복 4회·120초, undo 턴당 한 번으로 제한한다. 15분 동안 사용하지 않거나 생성 후 1시간이 지나면 종료한다. 새 테스트·만료 시 임시 작업장과 기록을 삭제하므로 필요한 결과는 먼저 내려받는다. 사용량은 관측한 turn_end의 합계이며, 중단된 API 요청의 청구 사용량까지 보장하는 결제 장부는 아니다.

백엔드 설정:

```text
CLOVA_LAB_ACCESS_TOKEN_FILE=/private/path/to/harness-access
CLOVA_RUNTIME_DIR=/absolute/path/to/runtime/clova
CLOVA_LAB_DIR=/private/path/to/test-workspaces
```

접속 파일에는 32자 이상의 무작위 접속 코드를 넣고 권한을 600으로 설정한다. 설정이 없으면 웹 API는 비활성 상태(503)다. 기존 서버의 CLOVA_API_KEY_FILE 또는 CLOVA_API_KEY를 재사용하되, 실행기에는 전용 임시 파일로만 전달한다. 서버 종료 시 생성한 키 사본을 삭제한다. 허용 모델·실행 명령·작업장·훅은 서버가 정하며 브라우저 요청으로 바꾸지 못한다.

API: `GET /api/harness/info`, `POST /sessions`, `GET/DELETE /sessions/:id`, `POST /sessions/:id/prompt`, `POST /sessions/:id/approve`, `POST /sessions/:id/interrupt`, `GET /sessions/:id/files`, `GET /sessions/:id/file?path=…`, `GET /sessions/:id/report` (모두 `/api/harness` 아래). Authorization Bearer는 테스트 전용 코드, X-Harness-Client는 브라우저 탭 식별자다.

```bash
npm run build:clova-runtime
npm run test:harness-web
VITE_API_BASE=/giants npm run build
npm run build:server
```

`build:server`가 런타임 번들과 대본도 준비한다. 배포 시 index.js와 runtime/clova 디렉터리를 함께 배치한다. 웹 테스트는 제한된 내부 시험용 입구이며, 임의 앱·다중 고객용 OS 자원 격리나 전체 Elda-Spec 서빙 입구 인증을 주장하지 않는다.

배포된 웹 시험에서 HCX-005가 정상 도구 호출과 `arguments:null` 호출을 함께 내는 사례를 확인했다. null은 빈 객체로 정규화해 MCP의 필수 인자 검사에서 수정 가능한 오류로 처리하며, JSON 문자열 인자도 객체로 파싱한다. 식별자가 없거나 잘못된 구조는 계속 거절한다. 같은 파일 내용을 다시 저장하는 호출은 undo 이력을 추가하지 않는다. 관련 회귀 시험은 `runtime.test.ts`와 웹 API 시험에 포함한다.

초기 독립 루프의 배포 검증(2026-11-10): 기존 `/giants/?view=harness` 웹 화면에서 실제 HCX-005로 파일 생성·수정·되돌리기 3개를 수행하고 파일·기록 다운로드까지 통과했다. 당시 브라우저 시험 usage는 입력 3,682·출력 588토큰, 모델 왕복 8회·실제 도구 실행 8회, 브라우저 JavaScript 오류 0건이었다. 증거는 `results.local/deployed-web/checks.json`, `report.json`, `desktop.png`에 보관한다. 이후 LangGraph 웹 ②·③을 별도로 재검증한 결과는 위의 ‘재현 가능한 비교 실행’ 및 전체 작업 기록을 따른다. 로컬 모의 API 브라우저 시험은 새로고침·중단·새 테스트·모바일 폭·권한 없는 접속도 검증했다.
