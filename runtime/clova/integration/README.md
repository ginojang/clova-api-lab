# Elda CLI → CLOVA LangGraph 연결

전체 작업과 증거는 [2026-11-10 작업 기록](../../../WORKLOG-2026-11-10.md)을 참고한다. 아래 ②·③ 설명은 기존 CLOVA 연결 기준이며, 추가한 Groq/OpenRouter/Z.ai의 이번 비교 지원 범위는 **②만**이다.

이 어댑터는 Elda CLI의 화면·이벤트·승인 기능을 그대로 쓰면서 모델과 MCP 실행을 외부 LangGraph 하네스에 맡긴다.

```text
elda clova --events
  → adapters/clova.py (JSONL 전달)
    → langgraph.ts / langgraph.mjs
      → CLOVA Studio + Wrapper MCP
```

어댑터에는 모델 호출 루프가 없다. `ready`와 `idle`은 바깥 Elda CLI가 내고, 자식의 `turn_end`는 자식 `idle`까지 받은 뒤 전달한다. 합본 `text`만 전달하여 delta 중복 표시를 피한다. 승인 요청은 Elda CLI 콜백에서 받고 그 결정을 자식에 돌려준다.

이 연결은 **② LangGraph 직접 구동과 ③ 같은 그래프의 서빙 정책**용이다. ① Claude Code 하네스 비교는 [상위 README](../README.md)의 별도 경로다.

## 적용

검증 기준 Elda CLI는 `4f6d90e151bf5025a82f97c7ee73d672214546fa`다. 설치본에 직접 적용하지 않고 검토용 checkout에서 아래 두 변경을 함께 검토한다.

```bash
git clone git@github.com:ginojang/Elda-CLI.git /path/Elda-CLI-integration
cd /path/Elda-CLI-integration
git apply --check /path/clova-api-lab/runtime/clova/integration/elda-cli-register.patch
cp /path/clova-api-lab/runtime/clova/integration/elda_clova.py adapters/clova.py
git apply /path/clova-api-lab/runtime/clova/integration/elda-cli-register.patch
```

등록 patch는 `AGENTS`에 `clova`를 추가한다. 설치된 Elda CLI나 참조 저장소는 자동으로 변경하지 않는다. Elda CLI 담당자가 검토·배포한 뒤 정식 등록으로 사용할 수 있다.

## 실행 설정

Node.js 24 이상과 이 저장소의 npm 의존성이 필요하다. 번들로 배포할 때는 `langgraph.mjs`와 `mcp.mjs`를 같은 폴더에 둔다.

```bash
export ELDA_CLOVA_ENTRY=/path/clova-api-lab/runtime/clova/langgraph.ts
export ELDA_CLOVA_NODE=/absolute/path/to/node
export CLOVA_MODEL=clova:HCX-005
export CLOVA_API_KEY_FILE=/private/path/clova.key
chmod 600 "$CLOVA_API_KEY_FILE"

# ② 도구 실행 전 승인을 받는다.
./elda clova --events --approve ask --cwd /absolute/path/workspace

# ③ 승인을 묻지 않는 서빙 정책으로 같은 그래프를 쓴다.
./elda clova --events --approve auto --cwd /absolute/path/workspace
```

| Elda CLI 옵션 | LangGraph 자식 옵션 | 동작 |
|---|---|---|
| `--approve ask` | `--approve ask` | 승인 전 도구 부작용 없음. `approve{approvalId,allow,reason}`로 응답 |
| `--approve auto` | `--approve never` | 승인 이벤트 없이 정책·작업장·한도로 제어 |

Elda CLI 자체가 받는 값은 `ask/auto`다. Elda CLI 명령에 `--approve never`를 넣지 않는다.

추가 설정은 `ELDA_CLOVA_CONFIG`(기존 하네스 JSON 프로필), `ELDA_CLOVA_RECORDS`(기록 디렉터리), `CLOVA_MAX_TURNS`(왕복 상한), `CLOVA_BASE_URL`(공급자 주소)로 지정한다. API 키 **파일 경로만** 자식에 전달하며 API 키 값을 명령줄이나 프로필에 넣지 않는다. 기본 도구는 `artifact_list/read/write/undo` 네 개다.

서빙용 프로필 예:

```json
{
  "maxTurns": 4,
  "timeoutMs": 120000,
  "toolCallLimits": {"clova__artifact_undo": 1}
}
```

EOF는 진행 중 턴을 마친 후 자식과 MCP를 닫는다. 승인 대기 중 EOF는 승인을 거절한다. `interrupt`는 진행 중인 그래프를 취소한다. 도구 실행 후 상태가 불확실해진 세션은 이어 실행하지 않고 새 작업장으로 프로세스를 다시 시작한다.

## 재현 시험

저장소 루트에서 무료 시험:

```bash
node --test runtime/clova/test/elda-adapter.test.ts
```

시험은 `ELDA_CLI_DIR` 또는 기본 `~/apps/elda-cli`를 임시 디렉터리로 복사하고 어댑터와 patch를 그 사본에 적용한다. 실제 `elda clova --events`를 실행하며 원본 소스 해시가 바뀌지 않았는지도 확인한다.

실제 API 시험은 명시적인 `--live`가 필요하다. `ELDA_CLI_DIR`는 patch 적용 전 원본 CLI 경로다. 실행기가 다시 격리 사본을 만들므로 설치본을 바꾸지 않는다.

```bash
CLOVA_API_KEY_FILE=/private/path/clova.key \
ELDA_CLI_DIR=/path/original-Elda-CLI \
node runtime/clova/elda-graph-live.ts --live \
  --output runtime/clova/comparison-elda-live.local
```

공통 `fixtures/comparison.json`의 생성·수정·undo+read를 모드마다 한 세션에서 한 번 실행한다. 턴당 최대 4왕복·120초이고 실패한 과제는 반복하지 않는다. 결과는 모드별 `report.json`, `events.jsonl`, `create.txt`, `edit.txt`, `undo.txt`와 통합 `report.json`에 남긴다. API 사용량·승인 수·파일의 정확한 내용·세션 유지·프로세스 정리를 기록한다.

2026-11-10 실 API 확인: HCX-005, 공통 과제 v2, 모드 2와 3 모두 성공. 각 6왕복·도구 4회·도구 오류 0, 입력 2,335·출력 157토큰이었다. 모드 2는 승인 4회, 모드 3은 0회였으며 설치 CLI 변경과 잔존 프로세스는 없었다. 이 결과는 한 과제의 연결 확인이며 일반적인 품질 순위는 아니다.
