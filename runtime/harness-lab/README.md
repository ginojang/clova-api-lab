# 자체 하네스 실행 비교 실험

현재 LangGraph 기준군과 **실제 Vercel AI SDK·PydanticAI·Pi agent-core**를 연결한 모드 ② 프로토타입이다. 각 SDK가 모델↔도구 반복을 실행한다. 모델 응답은 결정적인 fixture로 대체하고, 파일 작업은 기존 `runtime/clova/mcp.ts` subprocess가 실제로 수행한다.

구현·측정 결과는 [실행 결과 보고서](../../HARNESS-PROTOTYPE-RESULTS-2026-11-10.md), 조사 후보 전체는 [구축 방식 조사](../../HARNESS-OPTIONS-2026-11-10.md), worker 입출력은 [CONTRACT.md](CONTRACT.md)에 있다.

후속 기억·페르소나 실험은 별도 [memory-lab](../memory-lab/README.md)에 있다. Pi+SQLite와 Agno native memory를 구현해 재시작·격리·정정·잊기·persona 경계를 검사했으며, 기존 하네스 worker 자체를 변경한 것은 아니다.

## 실행

검증 환경: Node.js 24.15.0, Python 3.12.3. 프로젝트 루트에서 실행한다. 기존 루트 프로젝트 의존성은 이미 설치돼 있어야 한다. 실험용 의존성은 별도 폴더에 고정한다.

```bash
# 새 환경에서 실험용 패키지 설치. 다운로드·캐시·venv 모두 이 프로젝트 내부.
bash runtime/harness-lab/setup.sh

# 현재 설치된 환경에서 즉시 전체 비교. 실키·웹 서버·Elda-CLI 설치본 불필요.
node runtime/harness-lab/run.mjs

# 특정 하네스 또는 시나리오만 재현
node runtime/harness-lab/run.mjs --frameworks vercel,pydantic,pi
node runtime/harness-lab/run.mjs --frameworks pydantic --scenario two_calls_individual_approval \
  --output .local/pydantic-approval-result.json
```

전체 결과는 [results/mock.json](results/mock.json)에 저장된다. 원시 JSONL 이벤트·응답 fixture·작업 파일은 `.local/harness-probes/`에 실행별로 보존하며 결과 JSON에 해당 경로가 들어 있다. 기본 결과를 보존하려면 `--output`을 지정한다. 출력 경로도 이 프로젝트 내부로 제한한다.

모델 응답을 지연시키는 신규 어댑터 시험 1개는 기존 LangGraph의 scripted Brain이 delayMs를 지원하지 않아 `notRun`으로 표시한다. 실패 또는 통과로 위장하지 않는다. 중단으로 turn_end가 없는 경우 호출 수는 null이며, 실제로 모델을 호출하지 않았다는 뜻이 아니다.

## 별도 adapter 검사

```bash
# TypeScript 검사 및 Vercel 추가 lifecycle 검사
npm --prefix runtime/harness-lab/vercel run check
npm --prefix runtime/harness-lab/vercel test

# Pi 추가 lifecycle 검사
node runtime/harness-lab/pi/smoke.mjs

# Pydantic 추가 lifecycle 검사
runtime/harness-lab/pydantic/.venv.local/bin/python -B runtime/harness-lab/pydantic/smoke.py

# 실제 Brain → 로컬 모의 CLOVA HTTP 변환 검사. 외부 모델 호출 없음.
node runtime/harness-lab/pi/mock-live.mjs
```

Vercel의 Brain HTTP 검사는 해당 폴더의 [실행 메모](vercel/notes.md)를 따른다. 실제 CLOVA API 성공과 로컬 모의 HTTP 성공은 구분한다.

## 현재 범위

- SDK와 MCP·파일 효과는 실제 실행한다. 모델 응답과 usage는 합성값이다.
- 승인·거절·중단·호출 한도·동시 입력·실제 파일 결과를 검사한다.
- 여러 tool call의 승인 실행 방식과 실패 집계 정책을 결과에 별도 기록한다.
- Vercel/Pi에는 기존 Brain을 부르는 CLOVA 경로가 있다. Pydantic은 이번 범위에서 scripted-only다.
- 영속 재시작, 실제 Elda-CLI 등록·통합, 기존 웹페이지 배포는 이 프로토타입의 완료 범위가 아니다.
- 실험 폴더와 자체 README만 변경하며 기존 production 런타임·루트 package/lock은 변경하지 않는다.
