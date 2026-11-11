# 기억·페르소나 하네스 실험

Pi Agent + 자체 SQLite 계층, Agno Agent + native MemoryManager/UserMemory/SqliteDb를 같은 계약으로 검사한다. 공통 구조 검사는 모델만 scripted 응답이며 SDK·DB·MCP·파일 효과·프로세스 재시작은 실제다.

2026-11-11 후속 개선: [전체 연구·실제 API 비교 결과](../../PERSONA-POLICY-IMPROVEMENT-2026-11-11.md), [독립 Pi 정책 CLI 사용법](policy/README.md). HCX-005/007과 여러 정책을 비교하며, 기존 아래의 11월 10일 실행 기록을 덮어쓰지 않았다.

추가 후보 `enacted-v9`를 같은 HCX-007의 `composed-v8`과 비교한 16회 시험은 모두 전달됐지만, 두 독립 평가 모두 성격·도움 개선을 확인하지 못했고 말투는 두 문항 퇴행했다. **비교 우위 미입증으로 v9를 채택하지 않으며**, 명시적으로 선택 가능한 실험 정책으로 보존한다. 실제 시행과 판단은 [페르소나 후속 보고서](../../PERSONA-CONTINUATION-2026-11-11.md)에 기록한다. CLI 기본 정책은 `baseline`이며 수동 실행 예시의 v8도 추천 승격을 뜻하지 않는다. 새 정책은 독립 Pi CLI 경로에 적용하며 실제 Elda-CLI 등록·Agno 적용·운영 웹 배포의 완료를 뜻하지 않는다.

다음 실험 정책 `slim-v10`은 숨은 자기보고·행동 계획을 제거하고 `reply` 안의 네 표시 문자열만 생성한다. 연구·개발 r1/r2 진단과 새 두 주제의 확인 시험은 [두 번째 사이클 보고서](../../PERSONA-CYCLE2-2026-11-11.md)에 구분한다. `--policy slim-v10`으로 명시적으로 선택할 수 있으며 CLI 기본 정책과 운영 적용 범위는 바꾸지 않았다. 실제 품질·효율 판단은 해당 보고서의 동결된 결과를 따른다.

별도 `live.mjs`는 **실제 HCX-005**의 말투·정체성·기억 활용을 검사한다. 위 구조 검사와 달리 API 크레딧을 사용하며, 도구·자동 페르소나 교정을 제외한 첫 응답을 보존한다. [평가 설계](live-eval-design.md)와 아래 실행 방법을 참고한다.

실행 결과: [실제 모델 분석](../../LIVE-PERSONA-RESULTS-2026-11-10.md) · [32개 응답 원문](results/live-transcript.md) · [독립 AI 의미 평가](results/live-review.md). API 완료 32/32와 페르소나 유지 평가는 구분한다.

[통합 조사·실행 보고서](../../MEMORY-PERSONA-RESULTS-2026-11-10.md) · [자매 규격·외부 공식 조사](research.md) · [프로토타입 계약](CONTRACT.md)

## 실행

프로젝트 루트에서 실행한다. 검증 환경은 Node 24.15.0, Python 3.12.3이다.

```bash
# 새 환경에서만: 고정된 Pi 패키지와 Agno 로컬 venv 준비
bash runtime/memory-lab/setup.sh

# 전체 기억·페르소나 공통 검사. 실제 API 키 불필요.
node runtime/memory-lab/run.mjs

# 특정 구현 또는 시나리오
node runtime/memory-lab/run.mjs --frameworks pi
node runtime/memory-lab/run.mjs --frameworks agno \
  --scenario forget_clears_previously_injected_context \
  --output .local/memory-forget-result.json
```

기본 출력은 [results/comparison.json](results/comparison.json)이다. 개별 [Pi 결과](results/pi.json), [Agno 결과](results/agno.json)도 보존한다. 원시 이벤트·script·SQLite·작업 파일은 결과 JSON의 rawArtifacts가 가리키는 프로젝트 `.local/memory-probes/`에 있다. 합성값만 사용하며 실사용 개인정보를 입력하는 제품 화면이 아니다.

## 의미와 범위

- **기본 session:** principal + persona + conversation 범위. 프로세스를 다시 켜도 같은 conversation은 디스크 기억을 회상한다. 다른 conversation에는 나타나지 않는다.
- **long_term:** 명시적인 합성 실험 옵션. 같은 principal/persona의 다른 conversation에서도 회상한다. 운영 장기 기억 활성화를 뜻하지 않는다.
- **observe:** 근거 턴 ID와 원문 digest/pointer를 등록한다. 자유문장의 사실을 자동 추출하지 않는다.
- **remember:** 구조화된 후보를 승인받은 뒤 저장한다. 값/부정 여부 정정, revision, idempotence를 검사한다.
- **forget:** 선택한 기억·revision을 지우고 이전 주입/응답이 모델 문맥에 남지 않도록 처리한다. 근거 ID 충돌 검사용 digest는 남는다. SQLite 페이지·실험 로그·백업의 물리 삭제는 범위 밖이다.
- **persona:** 운영자 JSON anchor와 해시를 사용한다. 모델 기억이 권한이나 원본 persona를 수정하지 못한다.
- **Stop 검사:** optional forbiddenPhrases의 대소문자를 구분하는 literal 검사. 한 번 교정 후 재위반을 차단한다. 의미적 성격·말투 판정은 아니다.
- **context-chars:** persona와 회상 주입의 Unicode 문자 예산. 전체 대화·도구 schema·모델 토큰의 상한은 아니다.

`new`는 이 실험에서 대화 이력만 비운다. principal/persona/conversation과 저장 기억은 바꾸지 않는다. 새 conversation 시험은 다른 `--conversation`으로 worker를 실행한다. 진행 중인 승인·agent 실행의 crash resume는 구현하지 않았다.

자체 구현 메모: [Pi](pi/notes.md), [Agno](agno/notes.md). 기존 Elda-CLI 등록·운영 DB·웹 배포는 변경하지 않았다.

## 같은 HCX-007의 v8·v9 후속 비교

v9는 모델이 작성하는 숨겨진 행동 계획 `support_plan`을 추가하고, 기존 자기소개·공감·답변·다음 행동 네 문자열을 그대로 연결한다. 계획의 대상·동작·끝표시·역할에 따른 선택·이유는 실제 표시 답변의 의미 평가를 대신하지 않는다. 코드가 이름·사실·행동 문장을 보충하지 않는다.

2026-11-11 완료 시험의 [별도 판정](results/policy-enacted-v9-acceptance-2026-11-11.json)은 `overallPass:false`, `gate_unmet`이다. 두 평가 모두 성격 8/8→8/8, 실습 도움 4/4→4/4로 각각 +1 기준에 미달했고, 말투는 8/8→6/8로 퇴행했다. 나머지 보호 축은 유지되고 중대 실패는 0→0이었다. 오류·재시도·교정 없이 16응답을 전달한 사실과 품질 기준 실패를 구분한다. 아래 명령은 새 실행을 위한 안내이며 기존 결과와 기준은 보존한다.

```bash
python3 runtime/memory-lab/live-from-deployment.py --live --policy-eval \
  --plan runtime/memory-lab/policy/eval-plan-enacted.json \
  --output runtime/memory-lab/results/policy-enacted-new-run.json
```

이 명령은 최대 16회의 과금 가능한 실제 API 요청을 실행한다. 대조군은 HCX-007+composed-v8, 후보는 HCX-007+enacted-v9이며 두 조건 모두 출력 상한 2048·temperature 0·thinking none·도구 없음·교정/자동 재시도 없음이다. 계획의 `baseline` 조건명과 CLI 기본 `baseline` 정책을 혼동하지 않는다. 새 출력 경로를 사용해야 하며, 배포 자격증명을 읽어 로컬 실행하는 명령이지 웹 배포 명령은 아니다.

두 전체 블라인드 검토를 각각 고정하고 `summarize.mjs`로 원문·패킷·매핑·인용을 검증한 뒤, 별도 판정기를 실행한다:

```bash
# acceptance-v9.mjs SOURCE SUMMARY1 SUMMARY2 OUTPUT
node runtime/memory-lab/policy/acceptance-v9.mjs \
  runtime/memory-lab/results/policy-enacted-new-run.json \
  runtime/memory-lab/results/policy-enacted-new-summary.json \
  runtime/memory-lab/results/policy-enacted-new-secondary-summary.json \
  runtime/memory-lab/results/policy-enacted-new-acceptance.json
```

두 평가 모두 성격·실습 도움의 충분 수가 각각 1개 이상 늘어야 한다. 이름·말투·사건 의미·현재성·기능 정직성·공감은 충분 수 감소와 질문 쌍별 점수 퇴행이 모두 없어야 하며, 중대 실패도 늘면 안 된다. 16응답 전체 전달·8개 유효 쌍·요청당 한 번 생성이 선행 조건이다. 기존 요약 도구의 `compiledGate`가 아닌 **이번 사전 기준의 `acceptance-v9.mjs` 판정**을 사용한다. 이전 실험의 기준과 실패 기록은 수정하지 않는다. 자세한 계약·단일 CLI 실행·판정 한계는 [정책 README](policy/README.md)를 따른다.

## 같은 HCX-007의 v8·slim-v10 확인 시험

slim-v10의 출력은 최상위 `reply` 객체 하나와 그 안의 자기소개·공감·답변·다음 행동 네 모델 생성 문자열이다. 실제 운영자 정체성·연결 capabilities·승인 기억은 입력에서 유지하며, 모델이 이를 숨은 metadata로 다시 선언하지 않는다. decoder는 `metadata:{}`, `semanticVerified:false`를 반환하고 표시 원문만 연결한다. 구조 검사 통과가 사실·말투·성격의 의미 검증은 아니다.

```bash
python3 runtime/memory-lab/live-from-deployment.py --live --policy-eval \
  --plan runtime/memory-lab/policy/eval-plan-slim.json \
  --output runtime/memory-lab/results/policy-slim-new-run.json
```

새 [확인 계획](policy/eval-plan-slim.json)은 인물 2개·주제 2개·주제별 질문 4개를 조건 2개에 적용하는 **32회 실제 API 비교**다. 대조군은 HCX-007+composed-v8, 후보는 HCX-007+slim-v10이다. 기존 개발 r1·r2의 합계 16호출은 알려진 키보드 사례를 사용한 별도 진단이므로 이 확인 시험의 품질 증거에 섞지 않는다. 양 조건의 모델·온도·출력 상한·thinking·도구·기억 정정·재시작을 맞추고, 재시도·교정 없이 모든 첫 시도를 보존한다. 위 명령은 과금 가능하며 새 output 경로를 사용해야 한다. 웹 배포 명령은 아니다.

실행 원문에서 만든 같은 익명 패킷을 두 평가자가 전체 채점한 뒤 각 리뷰를 고정한다. 조건을 공개하기 전에 리뷰 두 개가 완성되어야 한다. 각각 `summarize.mjs SOURCE PACKET MAP REVIEW SUMMARY`로 원문·인용·분모·해시를 검증하고, 그 다음 별도 판정 도구를 실행한다.

```bash
# acceptance-v10-report.mjs SOURCE FROZEN_PLAN SUMMARY1 SUMMARY2 OUTPUT
node runtime/memory-lab/policy/acceptance-v10-report.mjs \
  runtime/memory-lab/results/policy-slim-new-run.json \
  runtime/memory-lab/policy/eval-plan-slim.json \
  runtime/memory-lab/results/policy-slim-new-primary-summary.json \
  runtime/memory-lab/results/policy-slim-new-secondary-summary.json \
  runtime/memory-lab/results/policy-slim-new-acceptance.json
```

현재 보고서에는 일반 민감정보 제거기가 키 이름의 `Token`에 반응해 사전 기준의 두 절감률 숫자 20을 `***`로 저장한 문제가 있다. 직접 `acceptance-v10.mjs` 호출은 이 때문에 profile 검증에 실패한다. [복구 wrapper](policy/acceptance-v10-report.mjs)는 원본 계획·당시 snapshot·판정 코드의 SHA와 나머지 전체 계획의 동일성을 확인하고, **정확히 그 두 비밀이 아닌 숫자만 메모리 안에서 복원해 동결된 `evaluateV10`을 그대로 호출**한다. 원문·리뷰·요약·기준은 바꾸지 않으며 source/summary의 원래 해시와 복구 출처를 결과에 남긴다. 해당 실행의 snapshot 파일이 필요하며, 세부 복구 조건은 [정책 README](policy/README.md)에 있다.

사전 기준은 두 독립 리뷰 모두에서 모든 8축의 충분 응답 수 감소·질문 쌍별 점수 퇴행·중요 실패 증가가 없어야 한다. 그 위에서 A는 말투·성격·실용 도움 중 최소 한 축의 충분 응답 +1 이상, B는 실제 총 입력·출력 토큰 각각 20% 이상 감소를 요구한다. B만 성립하면 성격 향상이 아니라 품질 보존에 따른 효율 개선으로 표시한다. `compiledGate`나 v9 판정 대신 **wrapper가 반환한 기존 판정기의 `qualityGain`, `efficiencyGain`, `overallPass`, `disposition`**을 확인한다.

단일 세션의 `--policy slim-v10` 실행 명령과 전체 검토 절차는 [정책 README](policy/README.md)에 있다. 기본 정책은 계속 `baseline`이고 일반 수동 예시도 v8로 유지한다. slim은 명시 선택하는 독립 Pi CLI 실험이며 실제 Elda-CLI 레지스트리·Agno·운영 웹에는 별도 연결이 필요하다. 최종 실행·평가·한계는 [두 번째 사이클 보고서](../../PERSONA-CYCLE2-2026-11-11.md)를 따른다.

## 실제 모델 평가

동일 HCX-005에 서연(차분한 존댓말)·루리(친근한 반말)를 적용한다. 두 하네스 × 두 페르소나 × 여덟 시나리오로 구성한다. 이름·말투 변경 요구, 기억 정정, 같은 session의 프로세스 재시작, 긴 참고 자료를 포함한다. persona JSON은 [서연](fixtures/live-calm.json), [루리](fixtures/live-playful.json)에 있다.

```bash
# 이미 설정된 배포 프로젝트의 키를 SSH로 읽고, 이 프로젝트에서 실행한다.
# 원격 프로젝트는 읽기만 한다. 로컬 private 키 사본은 정상 종료/예외 처리 후 삭제한다.
python3 runtime/memory-lab/live-from-deployment.py --live \
  --output .local/my-persona-evaluation.json

# 또는 기존 mode 600 키 파일의 경로를 CLOVA_API_KEY_FILE로 설정한 환경에서:
node runtime/memory-lab/live.mjs --live \
  --output .local/my-persona-evaluation-direct.json
```

기본 최대 40회, 실제 턴당 최대 1회이며 재시도하지 않는다. 정상 완료는 32회다. 기존 결과 경로는 덮어쓰지 않으므로 다시 실행할 때 새 `--output`을 지정한다. `--frameworks pi` 또는 `--frameworks agno`로 하나만 실행할 수 있다. 임의 외부 endpoint나 모의 응답은 이 live runner에서 허용하지 않는다.

`operationalSuccess`는 실제 API 응답·전달·종료 확인이며 성격 유지 점수가 아니다. 정규식 관측과 별도로 원문을 읽는 **독립 AI 의미 평가**를 수행한다. 모임 기억은 승인된 구조화 입력으로 넣으므로 자유 대화의 자동 기억 추출 품질은 측정하지 않는다. Pi는 기억 변경 때 history를 비우므로 여덟 시나리오 전체가 끊김 없는 장기 대화인 것은 아니다.

## 원본과 명시적 지시의 후속 비교

[후속 실행 결과](../../PERSONA-FOLLOWUP-RESULTS-2026-11-10.md): 80회 요청 시도, 실제 답변 78개, HTTP 429 두 건을 별도 보존했다. [전체 원문](results/followup-transcript.md)과 [검증·집계 JSON](results/followup-summary.json)을 함께 제공한다.

`--experiment followup --variants baseline,explicit`는 기존 8개 질문과 새 질문 2개를 두 페르소나·두 하네스·두 설정에서 비교한다. 계획은 [followup-plan.json](followup-plan.json), 강화 지시의 범위는 [설계 문서](fixtures/persona-explicit-design.md)에 고정했다. worker·모델·기억 값은 유지하고 persona 지시만 바꾸며, 설정마다 별도 DB를 사용한다.

```bash
python3 runtime/memory-lab/live-from-deployment.py --live \
  --experiment followup --variants baseline,explicit --max-calls 80 \
  --min-interval-ms 10000 --output .local/my-persona-followup.json
```

이 명령은 최대 80회의 실제 API 요청을 계획한다. `--min-interval-ms`는 요청 시작 사이의 최소 간격이며 한도 초과나 공급자 과부하가 다시 발생하지 않는다는 보장은 아니다. HTTP 실패는 모델의 성격 실패로 채점하지 않는다. 실패 토큰 사용량을 공급자가 주지 않은 경우 합계를 완전한 사용량으로 취급하지 않는다.

`--resume-from`은 종료·기록된 HTTP 429 실행의 **남은 질문만** 진행한다. 실패 질문을 재호출하지 않고 이전 요청 수도 호출 상한에 포함한다. 부분 그룹 재개는 오류 뒤 history를 비우는 Pi에만 허용하며, 닫힌 SQLite를 새 작업장으로 복사한다. 다른 하네스는 해당 그룹의 마지막 질문까지 이미 시도한 경우에만 다음 새 그룹으로 진행한다. 기존 결과·DB는 보존하고 새 `--output` 경로가 필요하다. 이 재개는 진행 중인 Agent 상태를 일반적으로 복원하는 기능이 아니다.
