# 자체 하네스 3종 구현·실행 결과

실행일: **2026-11-10**. 환경: **Node.js 24.15.0 / Python 3.12.3 / Linux**.

## 1. 완료한 범위

Vercel AI SDK, PydanticAI, Pi agent-core를 각각 별도 에이전트가 병렬 구현했다. 루트는 공통 시험기를 작성하고 기존 LangGraph 기준군과 함께 실행했다. **실제 SDK의 모델↔도구 반복과 실제 stdio MCP 파일 작업을 사용**했다. 결정적인 응답을 주는 모델 fixture로 승인·중단·오류를 재현했다.

최종 공통 결과는 **51/51 통과**다. LangGraph 12개, 신규 3종은 각각 13개다. [원본 결과 JSON](runtime/harness-lab/results/mock.json)에 패키지 버전, 실행 소스 SHA-256, 시나리오별 결과, 시작 시간, 승인·도구 수와 원시 기록 경로를 저장했다. 최종 실행 뒤 각 소스의 SHA-256이 결과와 일치함도 확인했다.

**실제 모델 API 호출은 0회**다. 현재 실행 환경에 실호출용 키 설정이 없었으며, 기존 무료 크레딧의 잔액이나 계정 상태를 확인한 것은 아니다. Vercel·Pi의 CLOVA 연결은 로컬 모의 HTTP로 추가 검사했다. 따라서 이번 결과로 모델 품질·실제 요금·실제 CLOVA 성공률을 판단할 수 없다.

작업 파일·패키지·venv·캐시·임시 파일·결과는 이 프로젝트 안에만 두었다. reference와 자매 프로젝트를 변경하지 않았다. 기존 production 런타임, 루트 package.json/lock, 설치된 Elda-CLI, 배포 웹은 이번 구현에서 변경하지 않았다.

## 2. 구현과 실행 상태

| 대상 | 실제 사용 버전 | 이번 구현 | 공통 검사 | 모델 연결 상태 |
|---|---|---|---|---|
| LangGraph | 1.7.3 | 기존 자체 하네스를 기준군으로 사용 | **12/12** | 이번에는 scripted. 과거 실호출 이력은 별도 작업 기록 |
| Vercel AI SDK | 7.0.166 | ToolLoopAgent + LanguageModelV4 변환 + native 승인 policy | **13/13** | scripted + 기존 Brain의 모의 CLOVA HTTP 통과 |
| PydanticAI | 2.66.0 | Agent + FunctionModel + native deferred 승인 | **13/13** | scripted-only. CLOVA model adapter는 미구현 |
| Pi agent-core | 1.5.1 | Agent + custom streamFn + beforeToolCall 승인 | **13/13** | scripted + 기존 Brain의 모의 CLOVA HTTP 통과 |

실행 코드: [공통 시험기](runtime/harness-lab/run.mjs), [Vercel](runtime/harness-lab/vercel/worker.ts), [PydanticAI](runtime/harness-lab/pydantic/cli.py), [Pi](runtime/harness-lab/pi/cli.mjs).

모든 신규 후보는 실험용 JSONL worker다. **실제 Elda-CLI provider 등록·통합 및 웹 선택 기능을 붙인 상태는 아니다.** 기존 Elda 경로의 검증 이력과 이번 독립 worker 검증을 합쳐서 표시하지 않는다.

## 3. 무엇을 실제로 검사했는가

| 검사 묶음 | 확인한 효과 |
|---|---|
| create → edit → undo → read | 실제 UTF-8 파일 바이트, MCP 4회, 승인 4회, 모델 응답 7회 |
| 승인·거절 | 승인 전 파일 불변, 거절 시 MCP 호출 0회 |
| 잘못된 승인 | stale ID·중복 ID·문자열 true 거부, 이중 쓰기 없음 |
| 여러 tool call | 각 호출의 별도 승인, 두 파일의 정확한 결과 |
| 취소·EOF | 승인 대기 중 파일 생성 없음, worker·MCP 자식 종료 |
| 모델 대기 취소 | 신규 3종에서 지연 응답 취소 후 늦은 승인·쓰기 없음 |
| 오류·한도 | ../ 경로 쓰기 실패, 모델 요청 상한 1회에 실제 종료 |
| 입력·세션 | new/reset, malformed JSON 복구, busy 중 추가 prompt 거절 |
| 완료 판정 | 도구 없이 “저장했다”고 말하면 파일 검사기가 과제 실패로 판정 |

기존 LangGraph의 scripted Brain에는 delayMs가 없어 모델 대기 취소 항목은 이번 공통 실행에서 notRun이다. 기존 HTTP 취소 회귀 검사와는 별개다. **12+13+13+13=51**이며 누락 항목을 통과로 세지 않았다.

“거짓 완료 탐지”의 통과는 **공통 파일 검사기가 거짓 주장을 발견했다는 뜻**이다. 모든 하네스가 자체적으로 거짓 답변을 거절했다는 의미가 아니다.

각 worker 종료 코드 0, JSONL 파싱·seq 연속성, 성공한 도구 결과 앞의 승인 이벤트, MCP PID 종료도 검사했다. 단, 이것은 이번 로컬 MCP의 수명 검사이며 모든 외부 도구·손자 프로세스·원격 실행의 정리를 보장하는 인증은 아니다.

## 4. 실행 후 드러난 장단점

| 대상 | 구현하면서 확인한 장점 | 구현하면서 확인한 부담·제한 | 현재 판단 |
|---|---|---|---|
| LangGraph | 상태 전이와 정책 위치가 명시적. 기존 Brain·MCP·이벤트 코드를 유지하기 쉬움 | 승인·횟수·실패·재개 정책을 직접 관리. 현재 영속 checkpoint 미구성 | 기존 기준군으로 유지 |
| Vercel | 현재 TS 코드 재사용 용이. provider 변환과 native toolApproval을 연결할 수 있음 | JSONL·승인 ID·중단·저장은 직접 구현. v7 이력 속성 선택에서 실제 버그 발생 | TS 제품 연결 후보로 계속 평가 |
| PydanticAI | native deferred 승인 경계가 명확. FunctionModel로 실모델 요청을 막고 정밀 재현 가능 | Python worker·venv·메시지 변환 필요. 이번에는 CLOVA adapter 없음 | 승인·재개 설계를 비교하는 독립 후보 |
| Pi | Agent/streamFn/beforeToolCall에 기존 Brain·MCP를 연결하는 구성이 간결. 순차 실행 제어 가능 | 승인 UI·ID·한도·취소·영속 저장은 별도 정책. 전용 메시지/stream 형식 변환 필요 | 작은 Elda CLI 하네스의 다음 집중 후보 |

위 판단은 **이번 프로토타입의 구현 경험**이다. 패키지 전체의 품질 순위가 아니며, SDK를 동일한 수의 줄로 조립했다고 기능 범위가 같아지는 것도 아니다.

Pydantic의 MCP 연결은 자체 최소 JSON-RPC client를 사용했다. **PydanticAI의 native MCP 통합을 평가한 결과는 아니다.** 세 후보 모두 파일 도구를 새로 만들지 않고 같은 기존 MCP 서버의 schema·설명·효과를 사용했다.

## 5. 승인 처리 방식의 실제 차이

한 모델 응답에서 a.txt와 b.txt 두 쓰기를 요청하고, 첫 번째만 승인한 채 두 번째는 대기시켰다.

| 대상 | 두 번째 승인 대기 중 첫 파일 존재 | 실제로 관측한 흐름 |
|---|---|---|
| LangGraph | 있음 | 첫 승인 → 첫 실행 → 다음 승인 |
| Pi | 있음 | 순차 tool 실행의 beforeToolCall에서 각각 대기 |
| Vercel | 없음 | 이번 native policy 구성에서는 승인 결정을 모은 뒤 실행 |
| PydanticAI | 없음 | DeferredToolRequests의 결정을 모아 SDK 실행 재개 |

근거는 결과 JSON의 `two_calls_individual_approval.observation`과 원시 이벤트다. 이번 설정에서 관측한 결과이며 SDK의 모든 동시성 구성에 일반화하지 않는다.

CLI에서 한 단계씩 진행 상황을 보여 주려면 순차 승인 흐름이 직관적이다. 한 응답의 여러 변경을 함께 검토하려면 일괄 결정을 모으는 흐름이 맞을 수 있다. **일괄 승인 대기가 트랜잭션이나 자동 rollback을 의미하지는 않는다.** 승인 후 두 번째 도구가 실패해도 첫 도구의 효과는 남을 수 있다.

## 6. 완료·실패 의미도 통일해야 한다

| 관측 상황 | LangGraph | Vercel | PydanticAI | Pi |
|---|---|---|---|---|
| 쓰기를 거절한 뒤 모델이 정상 종료 | turn ok:true | ok:false / denied | ok:true | ok:true |
| MCP 경로 오류 뒤 모델이 정상 종료 | turn ok:true | ok:false / tool_error | ok:false / tool_error | ok:true |

이는 **현재 adapter의 집계 정책 차이**다. ok:true인 후보도 거절·도구 오류를 tool_result.ok:false로 기록하며 실제 차단은 통과했다. 따라서 turn 종료 성공을 사용자 과제 성공으로 해석하면 안 된다.

후속 공통 결과 계약은 `runCompleted`, `taskSucceeded`, `policyRejected`, `toolFailed`를 구분하는 편이 낫다. 이번에는 기존 production 이벤트를 바꾸지 않고 원시 turnOutcomes와 실제 파일 검사를 함께 기록했다.

중단으로 turn_end가 없는 경우 결과의 `modelRequestsReportedByTurnEnd`는 null이다. 이미 승인 요청이 발생했다면 모델 응답이 있었으므로 null을 0회로 해석하면 안 된다.

## 7. 모의 HTTP 연결에서 발견해 수정한 문제

**Vercel v7에서 잘못된 응답 속성을 사용하면 이전 도구 이력이 유실됐다.** 처음 사용한 `result.response.messages`는 마지막 step만 담았다. 단순 scripted 파일 시험은 응답을 정해 놓았기 때문에 이 문제를 잡지 못했다.

실제 Brain → loopback CLOVA HTTP를 통과하면서 요청 메시지의 toolCallId·결과 이력을 검사하자 누락이 드러났다. 전체 누적인 `result.responseMessages`로 수정한 뒤 **3개 prompt·7개 모델 요청**의 이력과 파일 결과를 확인했다. [Vercel 검증 기록](runtime/harness-lab/vercel/notes.md)

Pi도 기존 Brain의 native CLOVA HTTP 변환을 검사했다. **3개 prompt·6개 모델 요청·MCP 4회**이며, undo/read를 한 응답에 묶은 fixture라 공통 시험의 7회와 다르다. 요청 system prompt, 도구 schema, maxTokens 2048, temperature 0, tool 결과 ID와 대화 이력, 키의 MCP 비전달, 파일 바이트를 검사했다. [Pi 검증 기록](runtime/harness-lab/pi/notes.md)

두 검사는 가짜 키와 loopback 서버를 사용했다. 외부 CLOVA 모델의 지시 이행·응답 품질·인증 성공을 검증한 것이 아니다. 그래도 실제 모델 어댑터의 요청/응답 변환을 실행했으므로 순수 scripted 시험보다 연결 증거가 한 단계 더 있다.

## 8. 시작 시간 관측

공통 실행에서 프로세스 생성부터 ready까지의 중앙값은 다음과 같다.

| 대상 | ready까지 중앙값 | 표본 |
|---|---|---|
| LangGraph | 1,103 ms | 12개 시나리오의 worker 시작 |
| Vercel | 554 ms | 13개 |
| PydanticAI | 1,345 ms | 13개 |
| Pi | 441 ms | 13개 |

같은 머신의 **한 번의 suite 실행**이며 SDK import·MCP 시작을 포함한다. 실행 순서·캐시·OS 부하를 통제한 성능 벤치마크가 아니다. 모델 응답 시간, 장기 세션 처리량, 메모리 사용량·설치 크기를 비교한 수치도 아니다. Python worker의 시작 부담과 작은 TS CLI 구성의 체감 차이를 후속 측정할 단서로만 사용한다.

## 9. 직접 재현

현재 환경에는 의존성 설치를 완료했다. 프로젝트 루트에서 다음 명령으로 다시 실행할 수 있다.

```bash
node runtime/harness-lab/run.mjs
```

특정 후보만 실행하거나 새 결과를 별도 보존할 수 있다.

```bash
node runtime/harness-lab/run.mjs --frameworks pi,vercel \
  --output .local/harness-probes/ts-comparison.json
```

설치 및 개별 검사는 [실험 README](runtime/harness-lab/README.md)에 있다. 기본 결과는 `runtime/harness-lab/results/mock.json`, 상세 이벤트·fixture·실제 파일은 해당 JSON에 기록된 `.local/harness-probes/…` 아래에 남는다. 패키지는 후보별 package-lock과 Python requirements.lock으로 고정했다.

## 10. 다음 판단과 남은 작업

이번 결과로 **기존 LangGraph를 기준군으로 유지하고 Pi와 Vercel을 Elda 연결의 우선 비교 후보로 좁히는 것**이 타당하다. Pi는 작은 CLI 실행기 구성, Vercel은 현재 TS 앱과의 연결 측면에서 다음 실험 가치가 있다. PydanticAI는 native deferred 승인 구조를 검증할 독립 비교군으로 유지한다.

다음 작업은 후보를 더 늘리는 것보다 아래 연결을 확인하는 편이 유용하다.

1. 결과 이벤트의 종료·과제 성공·거절 의미를 공통 계약으로 정리.
2. 동일 실제 CLOVA 모델로 Pi/Vercel/LangGraph를 비교하고 품질·usage·비용을 별도 기록.
3. PydanticAI에 기존 Brain 모델 adapter를 추가한 뒤 같은 실호출 과제 실행.
4. 실제 Elda-CLI의 이 프로젝트 내부 검토 사본에 연결하고 입력·승인·중단 통합 검사.
5. 선택한 후보의 영속 승인·장애 후 재개·MCP 불확실 효과 처리를 확대 검증.
6. 그 결과를 기존 배포 웹페이지의 하네스 선택·보고서에 연결.

현재 세 프로토타입은 단일 agent, 메모리 상태, 정해진 네 MCP 도구가 범위다. subagent, 장기 기억, restart recovery, 모든 Elda-Spec 항목의 적합성을 완료했다고 표시하지 않는다.
