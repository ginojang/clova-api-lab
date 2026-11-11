# Vercel AI SDK 하네스 실험

이 디렉터리는 Elda-CLI ② 비교를 위한 독립 프로토타입이다. 기존 Elda provider 등록·웹 연결·배포를 변경하지 않았다. 모델/도구 반복은 실제 `ai@7.0.166`의 `ToolLoopAgent.generate()`가 수행한다. 하네스를 직접 while-loop로 대체하지 않았다.

## 재현

Node 24.15.0에서 실행했다. 별도 package.json, package-lock.json과 node_modules를 사용한다. 설치·검증 명령은 저장소 루트 기준이다.

```bash
mkdir -p .local/harness-lab/npm-cache .local/harness-lab/tmp
NPM_CONFIG_CACHE="$PWD/.local/harness-lab/npm-cache" \
NPM_CONFIG_UPDATE_NOTIFIER=false TMPDIR="$PWD/.local/harness-lab/tmp" \
npm ci --prefix runtime/harness-lab/vercel --no-fund --no-audit

runtime/harness-lab/vercel/node_modules/.bin/tsc \
  -p runtime/harness-lab/vercel/tsconfig.json
node --test runtime/harness-lab/vercel/smoke.test.ts

node runtime/harness-lab/vercel/cli.mjs \
  --workspace "$PWD/.local/harness-lab/example-workspace" \
  --script "$PWD/runtime/harness-lab/vercel/example.json" \
  --max-turns 4 --timeout-ms 120000
```

포함된 `example.json`은 example.txt를 한 번 쓰는 scripted fixture다. stdin을 열어 두고 `{"op":"prompt","text":"write the example"}`를 보낸 뒤, 출력된 approvalId로 `{"op":"approve","approvalId":"출력된 값","allow":true}`를 보낸다. stdout은 공통 계약의 JSONL이며 `ready.mcpPid`로 자식 프로세스를 확인할 수 있다. 거절도 지원하며 추가 prompt 전에는 `new`로 fixture cursor를 초기화하거나 더 긴 Answer 배열을 지정한다.

실제 Brain 연결 경로는 `--script` 대신 `--model clova:HCX-005`다. `CLOVA_API_KEY_FILE`은 mode 600 파일을 가리켜야 한다. `CLOVA_BASE_URL`을 지정하지 않으면 실제 CLOVA endpoint를 호출하므로 실제 크레딧을 쓴다. 이 작업에서는 실키나 실제 CLOVA 서비스를 호출하지 않았다.

## 구현 선택

- 모델: `LanguageModelV4` provider adapter가 기존 Brain 메시지·toolCall·tool result·usage를 변환한다. scripted 모드에는 Brain의 순환 mock을 사용하지 않고 배열 소진을 명시적인 `script_exhausted`로 처리한다. `new`는 cursor와 대화 이력을 초기화한다.
- 프롬프트: `runtime/clova/fixtures/comparison.json.systemPrompt`를 그대로 사용한다. temperature 0, 출력 2048토큰, retry 0이다.
- 도구: 실제 `runtime/clova/mcp.ts` stdio 서버에서 조회한 네 artifact 도구만 등록한다. schema는 `z.fromJSONSchema`로 SDK 검증에 연결한다. MCP를 위한 별도 SDK 의존성 대신 기존 `Mcp` client를 재사용했다.
- 승인: 최신 SDK의 **native `toolApproval` policy callback**을 사용한다. callback 안에서 adapter가 JSONL 결정과 approval ID를 관리하고 기다린다. 명시적으로 허용/거절되면 `approved`/`denied`를 반환하며 SDK가 execute 호출 여부를 결정한다. durable 승인 suspension/resume을 구현한 것은 아니다.
- 여러 tool call: `toolCallConcurrency: 1`로 실제 도구 효과 순서를 고정했다. 승인 요청들은 실행 전에 여러 개가 표시될 수 있다.
- 도구 수: 허용 후 실제 MCP request만 센다. 거절은 호출 수 0이다. MCP `isError`는 실패 결과로 모델에 전달하며 해당 turn은 ok:false로 남긴다.
- 운송 실패: MCP 연결·응답 오류는 효과 여부가 불확실하므로 일반 tool error처럼 모델이 재시도하게 두지 않는다. run abort, MCP close, `requiresRestart:true`를 사용한다. MCP 요청 도중 취소/timeout도 같은 불확실성을 표시한다.
- 한도: SDK stopWhen과 model adapter의 호출 수 검사를 함께 사용한다. SDK가 요청한 실제 모델 호출 수를 세며, 마지막 허용 라운드가 도구 호출로 끝나면 `max_turns`로 종료한다.
- 자격 증명: 기존 MCP client의 최소 환경만 자식에게 전달한다. 모델 키 파일·CLOVA endpoint 설정을 MCP에 전달하지 않는다.

## 실행 검증

`npm run check`의 TypeScript strict 검사가 통과했다. 자체 `smoke.test.ts`의 5개 검사가 통과했으며 실제 worker와 MCP 자식 프로세스를 띄워 검사했다.

1. 한 모델 응답의 create/edit/undo/read 네 호출을 승인하고 실제 파일 최종 바이트, 호출 수, synthetic usage, 중복 승인 거부, MCP 종료 확인.
2. 잘못된 승인 값 거부, 정상 거절 시 파일 무변경·MCP 호출 0, 다음 prompt와 new reset, 승인 대기 중 EOF 확인.
3. 승인 대기 interrupt와 MCP 종료 확인, 실제 모델 요청 1회 상한 확인.
4. workspace 밖 경로의 MCP tool error, model script 소진을 실패로 기록하는지 확인.
5. **Loopback CLOVA HTTP mock**으로 `--model clova:HCX-005` → 기존 Brain → 네이티브 CLOVA 요청/응답 변환 → SDK loop → 실제 MCP의 create/edit/undo/read 경로 검사. system prompt, 네 도구 schema, assistant toolCall ID와 tool 결과 이력, maxTokens 2048, temperature 0, MCP 키 격리, 실제 파일 바이트를 검사한다. fake key와 결과는 이 폴더의 `.smoke.local/`에 남는다. 이는 프로토콜 연결 시험이며 **실제 CLOVA 모델의 과제 성공 결과가 아니다**.

이 HTTP 시험이 v7의 이력 API 차이를 실제로 발견했다. `result.response.messages`에는 마지막 step만 있으므로 이전 prompt의 중간 tool call/result가 유실됐다. 누적 결과인 `result.responseMessages`로 수정한 후 3개 prompt·7개 모델 요청의 도구 이력과 실제 파일 효과를 다시 검사해 통과했다.

root의 공통 runner가 실행한 결과는 상위 통합 보고서를 기준으로 한다. 이 파일에서 아직 실행하지 않은 외부 시나리오를 통과했다고 주장하지 않는다.

## 확인한 장단점과 한계

장점은 기존 TS Brain과 MCP를 직접 재사용할 수 있고, provider adapter와 native 승인 callback을 통해 SDK loop를 비교할 수 있다는 점이다. 고정 모델 응답을 넣으면서도 실제 도구 선택·SDK 승인·MCP 효과를 함께 검사할 수 있다.

별도 구현이 필요한 것은 JSONL 이벤트, 사용자 승인 대기/ID 관리, 전역 모델 호출 계수, 세션 저장과 중단 시 정책이다. 기본 ToolLoopAgent가 이것을 Elda 계약으로 자동 제공하지 않는다. 모든 상태는 프로세스 메모리에만 있으며 승인 대기 중 프로세스 재시작 복구는 없다. 스트리밍은 구현하지 않았다. 모델 답변은 generate가 끝난 후 text로 전달된다.

현재 공식 문서가 명시한 subagent 도구 승인 제한 때문에 단일 agent만 비교한다. WorkflowAgent/durable 실행은 설치하지 않았다. MCP 요청이 이미 효과를 냈다면 취소로 되돌릴 수 없으므로 중단을 rollback으로 표현하지 않는다. `new`는 대화·script cursor를 초기화하며 실제 파일과 MCP undo 이력은 유지한다. 실패/중단된 미완료 SDK 응답은 대화 이력에 붙이지 않으며 성공한 이전 turn은 남긴다.

사용한 공개 인터페이스 근거: [ToolLoopAgent](https://ai-sdk.dev/docs/agents/building-agents), [toolApproval](https://ai-sdk.dev/docs/agents/policy-tool-approvals), [subagent 제한](https://ai-sdk.dev/docs/agents/subagents). 실제 구현에서는 설치된 7.0.166의 타입 선언과 SDK 소스를 확인했다.
