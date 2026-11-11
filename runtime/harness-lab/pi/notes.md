# Pi agent-core 모드 ② 소규모 구현·실행 기록

조사·실행일: 2026-11-10. 이 폴더만 수정했다. 프로덕션/Elda-CLI provider 등록·배포는 하지 않았다.

## 실제 의존성과 실행

- 실제 npm registry의 `@earendil-works/pi-agent-core` latest는 **1.5.1**이었다. 문서의 새 패키지명이 registry에서도 존재함을 확인했다.
- `@earendil-works/pi-agent-core@1.5.1`, `@earendil-works/pi-ai@1.5.1`을 정확한 버전으로 고정하고 이 폴더에 별도 `package-lock.json`, `node_modules`를 만들었다.
- 실행 Node.js: **v24.15.0**. 기존 `runtime/clova/*.ts`를 Node의 type stripping으로 직접 import하므로 이 프로토타입은 Node 24 실행을 기준으로 검증했다.
- npm cache/log는 프로젝트 `.local/npm-cache`, `.local/npm-logs`를 지정했다. smoke fixture·작업장·이벤트 기록은 `pi/.local/` 안에 둔다.
- 실제 SDK의 `new Agent(...)`가 tool loop, argument validation, history, tool result, 다음 모델 호출을 관리한다. 이 어댑터가 수동으로 agent loop를 흉내 내지 않는다.

```bash
node runtime/harness-lab/pi/cli.mjs --workspace /ABS/PROJECT/.local/pi-workspace \
  --script /ABS/PROJECT/runtime/harness-lab/fixtures/example.json \
  --max-turns 4 --timeout-ms 120000

cd runtime/harness-lab/pi
node smoke.mjs
```

첫 명령은 CLI 형식 예시이며 fixture 경로는 실제 파일로 바꿔야 한다. JSONL 계약은 상위 `CONTRACT.md`를 따른다.

## 자체 검증 결과

`node smoke.mjs`: **8/8 통과**, 외부 모델 API 호출 **0회**. scripted model 응답만 대체하고 도구는 실제 기존 MCP subprocess로 실행했다.

1. 실제 파일 생성 → 다음 prompt에서 수정·undo·read, 한 모델 응답의 3개 도구 순차 실행, prompt 간 history 증가, 합성 usage 누적.
2. 사용자 거절, 잘못된 bool 타입, stale/중복 approval ID: MCP 실행 0회, 파일 생성 없음.
3. 승인 대기 중 interrupt: 파일 생성 없음, idle 이후 다음 prompt 정상 처리.
4. 승인 대기 중 EOF: 자동 거절/중단, MCP 자식 프로세스 종료 확인.
5. `../escaped.txt` 경로: 실제 MCP 오류가 `tool_result.ok=false`로 보존됨; 모델이 결과를 받고 종료.
6. 계속 도구를 요청하는 fixture: 실제 모델 호출 4회·MCP 호출 4회에서 `max_turns` 종료, 5회째 실행 없음.
7. scripted 응답 소진은 `script_exhausted`; `new`는 fixture index·history·session ID 초기화.
8. malformed JSON 거부 및 지연 모델의 deadline 취소: 늦은 text/도구 실행 없음.

각 worker의 `ready.mcpPid`로 `/proc/PID/environ`을 확인해 테스트용 모델 key 환경변수가 MCP 자식에게 전달되지 않음을 검증했다. 모든 worker 종료 후 MCP PID가 사라지고 stdout 이벤트 seq가 연속 증가함도 검사했다.

## 실제 구현에서 확인한 장점

- **최소 TS/JS 하네스 구성이 가능하다.** `Agent`에 모델 stream과 JSON Schema 도구만 주입해 실제 agent loop를 재사용했다. 기존 `Brain`·`Mcp` 클래스를 그대로 연결했다.
- **승인 주입점이 명확하다.** SDK `beforeToolCall`에서 JSONL 승인을 기다리면 실제 `execute`가 호출되기 전에 중지된다. 거절은 SDK가 오류 tool result로 보존해 모델에 전달한다.
- **독립적인 모델 시험이 쉽다.** `streamFn`에 scripted 응답을 주입하면서 실제 도구·history·cancel·limit 흐름을 실행했다. scripted 모드는 응답을 순환하지 않고 소진 시 명시적으로 실패한다.
- **기본 오류 플래그가 보존된다.** MCP `isError`를 `AgentToolResult.isError`로 매핑해 SDK `tool_execution_end.isError`와 외부 `tool_result.ok=false`에 반영했다.
- **상태·이벤트 재사용이 가능하다.** prompt 간 transcript 유지와 `agent.reset()`을 실제로 사용했다. 로그의 `turn_end.messages`로 history 증가를 관측할 수 있다.

## 실제 구현에서 확인한 단점·추가 구현 범위

- **완성된 권한/보안 시스템은 아니다.** 승인 UI/ID 유효성/EOF 취소/재시작 판단은 Elda 어댑터에서 구현해야 한다. filesystem 경계와 undo는 기존 MCP 서버가 담당한다. Pi 자체 OS sandbox를 구현하거나 검증한 것은 아니다.
- **모델·이벤트 형식 변환이 필요하다.** Brain Answer와 Pi AssistantMessage/ToolCall/ToolResult는 서로 다르다. native CLOVA adapter는 직접 매핑해야 한다.
- **1.5.1의 transcript 계약을 따라야 한다.** `streamFn`의 system prompt·tool 선언은 `context.systemPrompt/context.tools`가 아니라 leading system message에 들어온다. `brainMessages(context.messages)`가 system role도 전달한다. 초기 system prompt는 기존 `comparison.json.systemPrompt`를 사용한다.
- **기본 병렬 실행은 비교 조건에 영향을 준다.** 이 프로토타입은 `toolExecution: 'sequential'`로 명시해 edit/undo/read 순서를 보장한다.
- **횟수·시간·비용 통제는 추가 정책이다.** SDK `finishTurn`과 어댑터에서 prompt별 4회 상한 및 timeout을 구현했다. 합성 usage와 실제 provider usage를 전달하지만 가격 계산·세션 비용 제한은 범위 밖이다.
- **streamFn은 실패를 throw하면 안 된다.** SDK 계약에 따라 `AssistantMessageEventStream`의 error event로 변환해야 한다. 이 처리를 생략하면 lifecycle 정리가 불완전해질 수 있다.
- **프로세스 재시작 복원은 검증하지 않았다.** state는 메모리에만 있다. `pi-durable`, coding-agent의 저장·MCP 확장은 사용하지 않았다.
- **MCP 전송 중 중단은 결과가 불확실할 수 있다.** 이 경우 subprocess를 정리하고 `requiresRestart=true`로 표시한다. 승인 대기 중 취소는 실행 전이라 재시작 없이 다음 prompt를 허용한다.

## CLOVA 연결 상태

`--model clova:HCX-005` 경로를 구현했다. 기존 `Brain.call()`을 호출하고 모델 응답을 Pi stream으로 변환한다. CLI는 `--script`와 `--model` 동시 사용을 거부한다. 실제 CLOVA 키/API 호출은 사용하지 않았다.

추가로 **`node mock-live.mjs` 통과**: loopback HTTP 서버가 native CLOVA 형식 `{status:{code:'20000'}, result:{message, finishReason, usage:{promptTokens,completionTokens}}}`으로 응답한다. 키는 `pi/.smoke.local/` 안에 mode 600 가짜 파일로 만들었다. `--script` 없이 실제 `Brain.call()` HTTP 경로를 실행했다.

- loopback HTTP 모델 요청 6회, 실제 MCP 호출 4회, 실제 CLOVA 호출 0회.
- `comparison.json`의 3개 prompt로 생성·수정·undo+read 검증. 마지막 파일은 원래 내용으로 복원되었다.
- 모든 요청의 system prompt가 comparison fixture와 정확히 일치함을 검사했다.
- 도구 JSON Schema 4개, `maxTokens=2048`, `temperature=0`, native 요청 path 및 인증 header를 검사했다.
- 마지막 요청까지 3개의 user prompt와 `create-id/edit-id/undo-id/read-id`의 assistant/tool result 연결이 모두 보존되었다.
- prompt당 usage 22 input/10 output 누적, tool 결과 오류 플래그, MCP 자식에 key file/base URL 미전달, 종료 후 PID 정리를 검사했다.
- 실행 기록: `.smoke.local/brain-http-ICRxie/{result.json,requests.json,events.jsonl}`. 후속 실행은 새 폴더를 만든다.

이는 **로컬 mock HTTP를 통한 native Brain 변환 검증**이며 실제 CLOVA 모델의 도구 선택 품질·응답 호환성·과금·지연을 검증한 결과가 아니다.

## 근거

- [Pi agent-core 소스·공식 API 설명](https://github.com/earendil-works/pi/tree/main/packages/agent)
- [Pi MIT LICENSE](https://github.com/earendil-works/pi/blob/main/LICENSE)
- 설치본 `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts`, `types.d.ts`, `agent-loop.js`에서 실제 1.5.1의 hook·stream·event 계약을 확인했다.
