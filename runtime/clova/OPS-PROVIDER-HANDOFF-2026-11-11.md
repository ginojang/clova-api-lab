# CLOVA 제공자 계약 — K1 운영·구현 인계

작성일: 2026-11-11. 대상은 codingwhale 측 Elda 제공자 연결 검토다. 이 문서는 현재 `clova-api-lab` 소스와 NAVER 공식 문서를 읽어 작성한 로컬 인계 자료다. 문서 작성만을 위한 외부 전송·배포·다른 저장소 변경·추가 API 호출은 수행하지 않았다. 별도로 완료한 실제 모델 실험은 아래 검증 근거와 결과 보고서에 연결했다.

최초 인계 당시에는 `runtime/clova/`가 미추적 상태여서 구현 커밋 해시가 없었다. 이후 사용자 요청으로 **`5a363c34de0790d375f950f9e651dfc02beb57c2`**에 CLOVA Wrapper·하네스·통합 검사·웹 콘솔을 커밋하고 `origin/main`에 push했다. 빈 도구 설명 보정과 임시 CLI 사본의 Git 패치 격리 수정도 포함한다. 아래 개별 파일 SHA-256은 Git 커밋 ID와 별개다.

전달 상태 갱신: Comms `09f4371279`에서 **풀스택의 K1 대신 전달을 확인**했다. mars 읽기용 사본 제공은 해당 메시지의 보고이며, 이 세션은 사본의 바이트 일치나 C1/A3 실행 완료를 검증하지 않았다. 새 provider의 키 기본 경로·운영 비용 필드는 담당자에게 전달된 후속 요청으로, 이 랩의 구현 완료 사실과 구별한다. [전달 확인·범위 메모](COMMS-REPLY-DRAFT-2026-11-11.md).

후속 보고: 코딩고래는 Elda-CLI **be96b89**의 native Python C1/C2와 **e053ae1**의 runner H20 구현·모의 시험 통과를 알렸다. 인프라의 A3 권한 검사 차단 보고 뒤 사용자의 직접 키 배치 완료 보고가 도착했다(`d4ab9f1ea3`). 이어 **a6d2031**에서 빈 도구 설명을 보완한 뒤 mars `elda job _ai`의 HCX-005 도구 호출·결과·답변·runner 결과 파일을 실제로 확인했다고 보고했다(`8bb0c80e39`). 첫 400 실패와 모델의 근거 없는 계산도 함께 보고됐으며, mini-api 등록 Task부터 실제 보고까지의 전체 경로는 아직 모의 검증뿐이다. 이는 타 팀 구현·시험의 보고이며 본 세션의 실행 결과나 Pi 정책의 운영 배포로 간주하지 않는다. 상세 메시지와 완료/미완료 구분은 위 전달 기록을 따른다.

## 1. 구현 경계와 연결 지점

| 경로 | 역할 | 책임 경계 |
|---|---|---|
| [provider.ts](provider.ts) `Brain` | NAVER native v3 호출, 응답 정규화 | 모델 요청 1회. 에이전트 루프·도구 실행·자동 재시도 없음 |
| [clova-model-config.ts](clova-model-config.ts) | 모델별 generation 필드와 허용 조합 | 005/007 wire 차이, 실험실 토큰 상한, thinking/structured 조합 검사 |
| [common.ts](common.ts) | 키 파일, `Fault`, 메시지·사용량 타입, 마스킹 | 파일 전체를 키 문자열로 읽음 |
| [http.ts](http.ts), [anthropic.ts](anthropic.ts) | 로컬 OpenAI/Anthropic 형식 변환 | 지원하는 텍스트·함수 도구 부분집합만 제공. 클라이언트가 루프와 도구 실행을 소유 |
| [langgraph.ts](langgraph.ts) | 모드 ②/③ 자체 하네스 | 기억된 대화, MCP 도구 실행, 승인, 한도, 제한적 재시도 |
| [integration/elda_clova.py](integration/elda_clova.py) | Elda CLI → LangGraph JSONL 중계 | 별도 모델 루프 없음 |
| [../memory-lab/pi/cli.mjs](../memory-lab/pi/cli.mjs) | 독립 Pi 페르소나 실험 CLI | 현재 structured-v5/v6/v7 및 composed-v8 계약 적용 경로. 기존 Elda 어댑터에 자동 연결되지 않음 |

`provider.ts`는 `openai-provider.ts`도 정적으로 import한다. 파일 하나만 떼어 옮기면 자체 의존성이 사라진다는 점을 고려해야 한다. 현 키트 그대로 사용하거나, 별도 제공자 모듈로 분리할 때 import와 오류·사용량 계약까지 함께 검토한다. 전체 실행 방식은 [런타임 README](README.md), 기존 CLI 연결은 [통합 README](integration/README.md)를 따른다.

## 2. 인증과 환경변수: raw key 파일과 env bundle은 다른 형식

| 설정 | 현재 동작 |
|---|---|
| `CLOVA_API_KEY_FILE` | 필수. 발급된 키 값만 저장한 파일의 경로. 일반 파일, mode `0600`, `.trim()` 후 비어 있지 않아야 함 |
| `CLOVA_BASE_URL` | 기본 `https://clovastudio.stream.ntruss.com`. `Brain`은 HTTPS 또는 loopback HTTP만 허용. 임의 HTTPS 호스트를 official origin으로 제한하지는 않으므로 운영 설정 소유자가 주소를 고정해야 함 |
| `CLOVA_MODEL` | LangGraph/기존 어댑터 기본 모델 선택에 사용. 기본 `clova:HCX-005`. `new Brain(model)` 직접 호출에서는 전달한 인자가 모델임 |
| `CLOVA_WRAPPER_TOKEN_FILE` | 로컬 HTTP Wrapper를 사용하는 경우 별도 접속 토큰 파일. 동일한 `0600` 규칙. NAVER 키와 같은 값이면 시작 거절 |

`secretFile()`은 dotenv 파서가 아니다. `KEY=value`, `export ...`, JSON, 주석을 해석하지 않고 **파일 내용 전체를 trim한 값을 `Authorization: Bearer <값>`에 넣는다**. 현재 코드가 여러 줄이나 `KEY=value` 형식을 사전에 모두 검출하는 것은 아니므로, 잘못 연결하면 인증 실패 또는 헤더 구성 실패가 된다. 파일을 찾을 수 없는 경우 등 OS 파일 오류도 모두 `Fault('configuration')`으로 변환되어 있지는 않다.

따라서 다른 팀이 제안한 `~/.config/elda/clova.env`가 여러 환경변수를 담은 env bundle이라면 `CLOVA_API_KEY_FILE`에 그 경로를 넣는 방식은 호환되지 않는다. launcher가 해당 bundle을 별도로 읽어 **raw key 파일 경로를 환경변수에 설정**하는 것은 가능하지만, 이 저장소에는 그 bundle을 자동으로 읽는 구현이 없다. `CLOVA_API_KEY`라는 환경변수의 값만 설정해도 이 native `Brain`에는 전달되지 않는다. 기존 웹 서버의 별도 키 전달 경로와 혼동하지 않는다.

키 내용 없이 설정하는 예시:

```bash
export CLOVA_API_KEY_FILE=/private/path/clova.key
export CLOVA_MODEL=clova:HCX-007
export ELDA_CLOVA_NODE=/absolute/path/to/node
export ELDA_CLOVA_ENTRY=/path/clova-api-lab/runtime/clova/langgraph.ts
```

`/private/path/clova.key`에는 발급된 키 한 개만 미리 안전하게 저장한다. 키 값을 CLI 인자·JSON 프로필·기록에 넣지 않는다. 이 인계 과정에서는 실제 키 파일을 읽거나 출력하지 않았다.

## 3. native endpoint와 모델별 요청

기본 endpoint는 `POST https://clovastudio.stream.ntruss.com/v3/chat-completions/{modelName}`다. 경로 모델은 `HCX-005` 또는 `HCX-007`; `Brain` 인자는 `clova:HCX-005` 또는 `clova:HCX-007`이다. native body에 OpenAI식 `model`을 추가하지 않는다. 실제 요청 헤더는 `Content-Type: application/json`, `Authorization: Bearer <raw key>`이며 `X-NCP-CLOVASTUDIO-REQUEST-ID`는 현재 생성하지 않는다. 제공자 호출은 완성 JSON 응답을 받으며 native SSE를 요청하지 않는다. [NAVER 공통 요청 헤더](https://api.ncloud-docs.com/docs/ai-naver-clovastudio-summary), [Function calling](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-fc).

호출 계약:

```ts
await new Brain('clova:HCX-007').call(
  messages, tools, abortSignal,
  { maxTokens: 2048, thinkingEffort: 'none', responseFormat: optionalFormat },
);
```

`AbortSignal`은 필수다. public generation 옵션 이름 `maxTokens`는 007에서도 동일하지만, helper가 native `maxCompletionTokens`로 변환한다.

| 항목 | HCX-005 | HCX-007 |
|---|---|---|
| native 최대 출력 필드 | `maxTokens` | `maxCompletionTokens` |
| 이 랩의 기본/허용 값 | 기본 2048, 정수 1..2048 | 기본 2048, 정수 1..2048 |
| 함수 도구가 있으면 | 최소 1024 | 최소 1024 |
| `temperature` | 0 고정 | 0 고정 |
| `thinking` | 전송하지 않음. 명시적 `thinkingEffort`는 `none`도 거절 | 기본 `{effort:'none'}`. 명시적 `none/low/medium/high` 지원 |
| 추론과 도구 | 해당 없음 | `low/medium/high`와 도구 동시 사용 거절 |
| native structured | 지원하지 않음 | `responseFormat:{type:'json',schema:{...}}`, thinking none·도구 0개 조건 |

2048은 **이 프로젝트의 제한**이다. NAVER 007 문서는 최대 32768과 effort별 기본값을 설명하며, low/medium/high의 기본값을 최소 토큰 요구량으로 해석하면 안 된다. 추론 토큰도 completion 예산을 사용하므로 현재 상한에서는 최종 답변 전에 예산이 소진될 수 있다. [공식 007 추론 규격](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking).

생성 helper는 native 식별자 문법을 검사하지만 알려지지 않은 `HCX-*` 이름까지 실제 모델 allowlist로 보증하지 않는다. 007 외 문법상 유효한 이름은 기존 `maxTokens` 형태로 처리한다. 운영 모델은 명시적으로 005/007 등 검토된 목록으로 제한해야 한다.

007 structured 최소 body 예시:

```json
{
  "messages": [{"role":"user","content":"짧게 답해 줘."}],
  "maxCompletionTokens": 2048,
  "temperature": 0,
  "thinking": {"effort":"none"},
  "responseFormat": {
    "type":"json",
    "schema": {
      "type":"object",
      "properties":{"reply":{"type":"string"}},
      "required":["reply"]
    }
  }
}
```

현재 NAVER native structured는 007 전용이며 추론·Function calling과 함께 요청할 수 없다. native 타입은 `json`; OpenAI 호환 API의 `json_schema`와 다르다. `pattern`은 공식 미지원이다. helper는 schema를 복제하지만 JSON Schema 전체의 유효성이나 공급자 키워드 지원을 검증하지 않는다. `additionalProperties` 등 통과시킨 키워드의 공급자 지원을 보증하지 않는다. [공식 Structured Outputs](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-so).

## 4. 메시지·도구·복수 호출

내부 `Message`는 `role:'system'|'user'|'assistant'|'tool'`, `content:string`, 선택적 `toolCalls`, `toolCallId`를 사용한다. 현재 연결 범위는 텍스트다. 공식 API의 이미지 지원을 이 키트의 멀티모달 지원으로 해석하지 않는다. 시스템 메시지를 여러 개 합치는 처리는 호출자 책임이며 공식 규격은 요청당 system 메시지 1개다.

**도구 설명 보정:** NAVER native의 `function.description`은 필수다. 설명을 생략할 수 있는 MCP/호환 클라이언트를 위해, 현재 Brain은 설명이 누락·빈 문자열·공백·런타임 null이면 도구 이름을 전송한다. 비어 있지 않은 설명의 원문과 입력 도구 객체·schema는 그대로 보존한다. 코딩고래의 빈 description 400/40001 보고 뒤 적용했으며, 이번 랩 수정은 모의 wire 테스트로 검증했다. [원인·수정·검증 기록](TOOL-DESCRIPTION-FIX-2026-11-11.md), [NAVER 필수 필드 규격](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-fc).

```ts
// 도구 정의: inputSchema → native function.parameters
{ name: 'read_note', description: 'Read a workspace note', inputSchema: {type:'object'} }

// native assistant 도구 호출: camelCase, 인자는 객체
{ role:'assistant', content:'', toolCalls:[
  {id:'call_1', type:'function', function:{name:'read_note', arguments:{}}}
] }

// 결과는 같은 ID로 연결
{ role:'tool', toolCallId:'call_1', content:'{"text":"example"}' }
```

`normalizeToolCalls()`는 배열 전체를 순서대로 보존한다. 응답당 ID는 비어 있지 않은 문자열이며 중복이면 전체 응답을 거절한다. `type`은 `function`, 함수명은 문자열이어야 한다. 함수 인자는 객체면 유지, JSON 문자열이면 파싱, `null`/누락이면 `{}`로 바꾼다. 파싱 실패·배열·스칼라는 거절한다. `{}`로 정규화했다고 도구의 필수 인자 검증을 통과한 것은 아니며 실제 MCP 도구가 검사한다.

`Brain`이 모든 함수 이름·스키마를 자체 검증하는 것은 아니다. 도구 allowlist/실행 권한은 하네스가 소유한다. HTTP 입력 parser는 이름 형식·중복·허용 필드를 추가 검사한다. 복수 `toolCalls`는 지원하지만 **실제 LangGraph 실행은 순차적**이다. 각 호출에 결과 메시지를 붙이고 전체 묶음 처리가 끝난 뒤 모델로 돌아간다. 하나의 도구 결과에 다른 호출 ID를 재사용하거나 여러 호출을 한 호출로 합치지 않는다. [NAVER 함수 호출의 `toolCalls`/`toolCallId` 규격](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-fc).

## 5. 응답·종료 사유·사용량

`Brain`은 `status.code`가 존재하면 `20000`인지 확인한다. 이어서 `result.message.role==='assistant'`, 문자열 content, 지원 종료 사유, 유효 사용량을 검사한다. 반환 형태는 다음과 같다.

```ts
{
  message: {role:'assistant', content:string, toolCalls?:ToolCall[]},
  finishReason: 'stop' | 'length' | 'tool_calls',
  usage: {input:number, output:number, cacheRead:0, cacheWrite:0}
}
```

| native | 내부/변환 동작 |
|---|---|
| `stop` | 정상 생성 종료. 내용의 사실성·완전성 보증은 아님 |
| `length` | Brain은 종료 사유를 보존. LangGraph/Pi는 잘린 최종 답변을 성공으로 전달하지 않음 |
| `tool_calls` | 비어 있지 않은 도구 호출 배열 필요. 다른 종료 문자열은 거절 |
| `usage.promptTokens` | `usage.input` |
| `usage.completionTokens` | `usage.output` |
| cache 지표 | 현재 변환에서 `cacheRead=0`, `cacheWrite=0`. 실제 계정 캐시/비용 측정값을 조회한 결과가 아님 |

토큰 값은 유한한 0 이상 숫자여야 하며 사용량 누락은 성공으로 정규화하지 않는다. 007 `completionTokensDetails.thinkingTokens`를 completion에 다시 더하지 않는다. provider의 `thinkingContent`는 반환 `message`에서 제거하여 다음 턴에 재전송하지 않는다. 공식 안내도 최종 content만 다음 대화에 포함하도록 한다. [007 응답·멀티턴 규격](https://api.ncloud-docs.com/docs/clovastudio-chatcompletionsv3-thinking).

OpenAI Wrapper 응답은 `finish_reason`을 그대로 쓰고 `function.arguments`를 JSON 문자열로 변환한다. Anthropic Wrapper는 `stop→end_turn`, `length→max_tokens`, `tool_calls→tool_use`로 변환한다. structured 응답도 native content 자체는 JSON **문자열**이다. 독립 Pi v5/v6/v7 경로는 계약을 검증한 뒤 모델이 생성한 `reply` 문자열만 그대로 내보낸다. v8은 `reply` 객체의 네 모델 생성 문자열을 순서대로 빈 줄로 연결하며 단일 원문 문자열과 같은 방식은 아니다. 두 방식 모두 metadata의 이름·사실을 사용자 답변에 합성하지 않는다. 의미 검증 성공과 JSON/enum 검증 성공은 별개다.

## 6. 오류·시간·재시도 책임

| 상황/계층 | 현재 동작 |
|---|---|
| Brain 요청 | 호출당 fetch 1회. 자동 재시도 0회. 호출자 signal과 60초 timeout을 결합 |
| upstream HTTP 실패 | 본문을 사용자에게 복사하지 않고 `Fault('api_error', ..., HTTP status)` |
| 연결 실패 | `api_error`, status 502 |
| 중단/시간 초과 | `interrupted` 또는 `timeout`(504) |
| JSON/응답 구조·finish/usage 오류 | `api_error`; 일부는 status가 없으며 HTTP 경계에서 502로 정규화 |
| 도구 인자 정규화 실패 | 응답 usage가 이미 검증되었다면 `Fault.usage`에 보존 |
| HTTP Wrapper | 자체 재시도 없음. 클라이언트 연결 종료는 upstream 취소. upstream 상태를 보존하되 오류 메시지에 키·URL·본문을 싣지 않음 |
| LangGraph 및 이전 `harness.ts` | 턴당 transport 재시도 최대 1회. 도구가 아직 실행되지 않았고 status가 429/500/502/503/529일 때만 즉시 재시도. backoff/Retry-After 구현 없음 |
| Stop hook 교정 | 정책 거절에 따른 최대 1회 별도 생성. transport 재시도와 다른 동작이며 모델 턴 상한 안에서 진행 |

LangGraph 기본값은 최대 모델 턴 12회, 턴 시간 300000ms다. `CLOVA_MAX_TURNS`가 config `maxTurns`보다 우선하고 정수 1..100만 허용한다. 기존 비교 프로필의 4회·120초는 명시적 실험 설정으로 기본값과 다르다. usage 없는 실패 요청은 `turns`에 잡히지 않을 수 있어 실제 HTTP 시도 수와 `turns`가 동일하다고 가정하면 안 된다. 알려진 usage가 없는 오류를 비용 0으로 확정하지 않는다. 도구를 실행한 뒤 실패하여 상태가 불확실하면 세션이 재시작 필요 상태가 된다.

독립 Pi structured 비교는 교정·자동 재시도를 하지 않는 별도 실험 설정이다. 이 정책을 모든 기존 하네스의 공통 동작으로 확대하지 않는다. 비용 상한을 쓰려면 명시적 토큰 단가가 필요하며 무료 크레딧 잔액은 조회하지 않았다.

## 7. 미지원 설정을 거절하는 범위

HTTP OpenAI 경로 `/v1/chat/completions`는 최상위 `model/messages/tools/stream`만 받는다. `stream`은 생략 또는 false만 허용한다. `temperature`, `max_tokens`, `response_format`, native `responseFormat`, reasoning 옵션을 이 경로에 넣으면 400이다. **007 native structured 지원을 추가했어도 HTTP Wrapper의 structured 요청 인터페이스가 추가된 것은 아니다.**

Anthropic `/v1/messages`는 다음 의미를 명시적으로 제한한다: `temperature=0`, `max_tokens=1..2048`(도구 사용 시 1024 이상), thinking disabled, 자동 tool choice, 비어 있는 custom stop 목록. 활성 prompt caching, thinking, `output_config`, context/container/server MCP 옵션, 이미지·문서 블록 등은 거절한다. 허용된 `metadata.user_id`는 attribution으로만 확인하고 native 요청에 전달하지 않는다. SSE를 요청할 수 있지만 native 완성 응답 뒤 이벤트를 내는 **buffered-native**이며 실시간 토큰 스트림이 아니다.

Wrapper는 loopback 전용이고 기본 허용 모델은 `HCX-005`다. 007을 사용하려면 `--models HCX-005,HCX-007`처럼 허용 목록을 명시한다. Wrapper 인증은 NAVER 키가 아닌 별도 토큰을 사용한다. 경로와 body 형식의 상호 대체를 허용하지 않는다.

generation helper는 잘못된 maxTokens·effort 값, 005의 thinking/structured, 007 thinking+tools, structured+thinking/tools, 잘못된 format envelope를 `invalid_argument`로 거절한다. 그러나 임의 JavaScript 객체의 **모든 알 수 없는 키**를 whitelist로 거절하는 함수는 아니다. 예를 들어 타입 밖 `temperature`를 런타임 객체로 억지 전달하면 현재 helper는 사용하지 않고 0을 보낸다. 호출자가 HTTP/외부 config를 받는다면 별도 허용 키 검사를 적용해야 하며, 현 키트가 모든 설정 오류를 검출한다고 기술하면 안 된다.

## 8. Elda CLI adapter 인계 파일과 실행

인계 대상은 [elda_clova.py](integration/elda_clova.py) → 대상 checkout의 `adapters/clova.py`, [elda-cli-register.patch](integration/elda-cli-register.patch) → 대상 `elda`의 `AGENTS['clova']` 등록이다. 적용 위치는 Elda CLI 담당자가 소유한 검토 checkout이다. 현재 설치본/레퍼런스 폴더에 이 문서 작성자가 적용하지 않았다.

```bash
# 대상 담당자가 검토 checkout에서 수행할 명령 예시이며, 이번 인계에서 실행하지 않았다.
git apply --check /path/clova-api-lab/runtime/clova/integration/elda-cli-register.patch
cp /path/clova-api-lab/runtime/clova/integration/elda_clova.py adapters/clova.py
git apply /path/clova-api-lab/runtime/clova/integration/elda-cli-register.patch

./elda clova --events --approve ask --cwd /absolute/path/workspace
./elda clova --events --approve auto --cwd /absolute/path/workspace
```

`ask`는 자식 `--approve ask`로, `auto`는 자식 `--approve never`로 변환한다. Elda CLI 명령에 `--approve never`를 넣는 방식이 아니다. Node 24+ 및 npm 의존성 또는 빌드된 `langgraph.mjs`/`mcp.mjs`가 필요하다. 선택 환경변수는 `ELDA_CLOVA_CONFIG`, `ELDA_CLOVA_RECORDS`; 모델값은 인자 또는 `CLOVA_MODEL`이다. 자식에게는 선택 제공자의 키 **파일 경로**와 제한된 환경변수만 전달한다.

어댑터는 JSONL 중계만 한다. outer Elda의 ready/idle과 중복하지 않도록 child turn_end를 child idle 뒤에 전달하며, text_delta를 제외하고 합본 text만 보낸다. 승인은 outer 콜백을 통해 child에 돌려준다. EOF·interrupt·세션 재사용 동작과 기존 통합 시험 방법은 [integration/README.md](integration/README.md)에 있다. 해당 기존 시험은 CLI 사본을 만들므로 이 문서 작성 과정에서는 실행하지 않았다. 새 Pi persona policy를 이 adapter 또는 운영 웹에 이미 배포했다고 주장하지 않는다.

## 9. 검증 근거와 인계 상태

아래 보존 로그는 실제 모델 품질 점수가 아닌 구현 회귀 결과다. 초기 인계는 기존 로그를 읽어 작성했고, 이후 빈 도구 설명 보정의 전용·관련 회귀와 TypeScript 검사를 추가 실행했다. 후속 패치에서 실제 API를 추가 호출하지는 않았다.

| 근거 | 확인된 결과/범위 |
|---|---|
| [기존 provider 로그](../memory-lab/results/policy-demonstrated-final-provider-tests-2026-11-11.txt) | 보정 전 40/40. native 모델 wire/helper, OpenAI/Anthropic 변환, Basic 마스킹 회귀 포함 |
| [빈 도구 설명 보정 전용 검사](../memory-lab/results/tool-description-unit-2026-11-11.txt), [관련 기존 회귀](../memory-lab/results/tool-description-provider-regression-2026-11-11.txt) | 후속 provider 보정 뒤 3/3 + 34/34. 설명 생략의 HTTP 경로, 005/007 native 요청, 입력 보존 검증. 실제 API 추가 호출 0회 |
| [정책/SDK/증거 무결성 로그](../memory-lab/results/guard-identity-policy-tests-2026-11-11.txt) | 후속 이름 강조 오탐 수정 포함 77/77. provider 자체의 일반 모델 품질 보증은 아님 |
| [Pi 기억·승인·격리 회귀](../memory-lab/results/pi-policy-composed-final-regression-2026-11-11.json) | v8 실행 전 24/24. 후속 진단 수정 뒤 [Pi smoke](../memory-lab/results/guard-identity-pi-regression-2026-11-11.txt) 9/9도 통과 |
| [redaction.test.ts](test/redaction.test.ts), [runtime.test.ts](test/runtime.test.ts)의 redaction 항목 | 본 인계 직전 수정 검증: 새 6/6 + 기존 1/1. 자연어 basic cord-knot 보존, 실제 Basic/Bearer·헤더·등록 비밀값 마스킹 유지 |
| [`npm run check:clova-runtime`](../memory-lab/results/tool-description-typecheck-2026-11-11.txt) | 후속 도구 설명 보정과 신규 테스트 포함 통과. `noEmit:true` |
| [Elda adapter 시험](test/elda-adapter.test.ts), [LangGraph 시험](test/langgraph.test.ts) | 기존 연결·승인·복수 도구·재시도 검증 소스. 인계 문서 작성 중 재실행하지 않음 |

native API 또는 로컬 모의 서버 시험을 재현할 때는 [native-models.test.ts](test/native-models.test.ts), [clova-model-config.test.ts](test/clova-model-config.test.ts), [http.test.ts](test/http.test.ts), [anthropic.test.ts](test/anthropic.test.ts)를 참고한다. 실제 persona 실험 원문·성공/실패 한계는 [별도 결과 보고서](../../PERSONA-POLICY-IMPROVEMENT-2026-11-11.md)를 따른다.

문서 작성 시 읽은 파일 SHA-256이며 Git commit ID가 아니다:

| 파일 | SHA-256 |
|---|---|
| `provider.ts` (빈 도구 설명 보정 후) | `e32d06471d11d30f43192d23e136300f50db01eae115d646534e2d262b500649` |
| `clova-model-config.ts` | `8b6950a7bae2eafd6eac25fcd900ce40804c321f86d9526c1887ed8dd33b7440` |
| `common.ts` | `214642e57dd634c4fb51aba0f0f5245af1d9ea784a2efbdd1b283593bd8c7a1e` |
| `integration/elda_clova.py` | `c7e7347ad95b96c6381c3dc874f26ec938ca88eca6ef95659ac1cbe00f7dd1b7` |
| `integration/elda-cli-register.patch` | `59802b1d7cbe39084f6bf7e1c27989d98cd7f0d0cd07e88f732e6f5f73004884` |

현재 전달 가능한 것은 위 로컬 구현·패치·검증 근거다. 다른 팀의 env bundle reader, 제공자 registry 반영, 정책 선택 UI, 배포 및 실제 운영 검증은 이 문서가 완료 사실로 보증하는 범위에 포함되지 않는다.
