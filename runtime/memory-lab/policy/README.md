# 페르소나 정책을 비교하는 독립 Pi CLI

이 모듈은 실제 Pi agent-core 1.5.1 루프 → 기존 Elda Brain 어댑터 → NAVER CLOVA Studio API 경로에 연결한다. 기억 저장·승인·MCP 실행 경계는 기존 Pi worker를 사용한다. 모델 답변 앞에 이름을 붙이거나 고정 답변으로 교체하지 않는다.

## 정책 선택

`pi/cli.mjs --policy` 옵션:

| 값 | 동작 |
| --- | --- |
| `baseline` | 기존 JSON 페르소나 anchor. 기본값이며 기존 호출과 호환된다. |
| `compiled` | 한국어 역할 지시, 실제 기능 목록, 근거가 포함된 승인 기억을 한 system으로 구성한다. |
| `guarded` | compiled + 좁은 정체성·기능 검사, 필요하면 1회 교정한다. |
| `compiled-v2` | 역할 수행 방식과 명시된 말투 예시를 추가한다. |
| `guarded-v2` | compiled-v2 + 한국어 종결형 검사 + 짧은 자연어 교정 피드백. 실제 비교 기준 미달. |
| `voiced-v3` | 새 문맥에서 항상 한 번 재작성. 실제 비교 기준 미달. |
| `structured-v5` | HCX-007 native JSON 계약. 모델의 `reply`만 그대로 표시하며 의미 검사는 관찰용. 초기 비교는 말투 개선, 성격 저하로 기준 미달. |
| `structured-v6` | 동일 JSON 계약의 답변 지시를 현재 질문의 이름·기능 한계·작은 실습 요구와 연결. 동일 007 비교에서 전체 기준 미달. |
| `structured-v7` | v6 + 중립 가상 대화 2쌍을 provider 입력에 추가. 예제는 실제 기억·대화 이력에 저장하지 않음. 동일 007 비교에서 전체 기준 미달. |
| `composed-v8` | v5 기반 JSON에서 자기소개·공감·답변·다음 행동 네 문자열을 모델이 생성. 렌더러는 원문을 빈 줄로만 연결. 예제 없음. 새 상황에서 이름·말투·기억·공감·도움 개선 확인. 성격 향상의 평가자 간 일치가 부족해 전체 확인 기준은 미달. 실험 후보로 제공. |
| `enacted-v9` | v8의 네 표시 문자열을 유지하고, 대상·동작·끝표시·역할에 따른 선택·이유를 모델이 짧게 작성하는 숨겨진 `support_plan`을 추가한다. 동일 HCX-007 비교에서 성격·도움은 개선되지 않았고 말투가 2문항 퇴행했다. 비교 우위 미입증으로 채택하지 않으며 명시적으로 선택 가능한 실험 정책으로 보존한다. |
| `slim-v10` | 최상위 `reply` 하나 안에 네 표시 문자열만 생성한다. 숨은 자기보고·계획 metadata와 중복 설명을 줄이고 별도 compiler suffix로 말투를 명시한다. 운영자 정체성·실제 기능·승인 기억은 신뢰된 입력으로 유지한다. 명시적으로 선택하는 실험 정책이며 실제 확인 결과는 [두 번째 사이클 보고서](../../../PERSONA-CYCLE2-2026-11-11.md)를 따른다. |

`compiled` 계열은 일반 의미 평가기가 아니다. 기존 `outputRules.forbiddenPhrases`를 설정하면 그 literal 교정 기능은 유지된다. 비교용 fixture에는 해당 항목이 없다.

## 로컬 검증

프로젝트 루트에서:

```bash
node --test runtime/memory-lab/policy/*.test.mjs
node runtime/memory-lab/run.mjs --frameworks pi --output runtime/memory-lab/results/pi-policy-new-regression.json
```

이 검증은 scripted 응답으로 저장소, SDK 루프, 검사기, 교정 상한, 승인 경계, 이력 정리를 확인한다. 실제 모델의 성격 점수가 아니다.

## 실제 API 비교

이미 설정된 해당 프로젝트 배포 서버의 자격증명을 읽어서 로컬에서 실행하는 경로:

```bash
python3 runtime/memory-lab/live-from-deployment.py --live --policy-eval \
  --plan runtime/memory-lab/policy/eval-plan-enacted.json \
  --output runtime/memory-lab/results/policy-enacted-new-run.json
```

`--live`는 실제 과금 가능 요청을 실행한다. 출력 파일이 이미 있으면 덮어쓰지 않는다. 자격증명 helper는 기존 `hellcat`의 이 프로젝트 설정을 읽기만 하며, 로컬 mode 0600 임시 키 파일을 종료 시 삭제한다. 자격증명이나 원격 설정을 출력하지 않는다. 웹페이지에 배포하는 명령은 아니다.

로컬에서 별도로 설정한 키 파일을 사용하려면 `CLOVA_API_KEY_FILE`에 **mode 0600 파일 경로**를 지정하고 `node runtime/memory-lab/policy/live.mjs --live ...`를 실행한다. 키 값을 명령줄에 직접 넣지 않는다.

이 후속 계획은 **HCX-007+composed-v8 대 HCX-007+enacted-v9**를 16회로 비교한다. 두 조건은 같은 모델, temperature 0, 최대 출력 2048, thinking none, 도구 없음, 요청당 한 번 생성을 사용한다. 정책·스키마 지시가 달라지며 입력 길이·토큰 비용까지 같다는 뜻은 아니다. 완료된 2026-11-11 시험은 16회 모두 전달됐고 오류·재시도·교정은 없었지만, 두 독립 AI 평가와 [별도 합격 판정](../results/policy-enacted-v9-acceptance-2026-11-11.json) 모두 `overallPass:false`, `gate_unmet`이었다. 자세한 판단은 [후속 보고서](../../../PERSONA-CONTINUATION-2026-11-11.md)에 기록한다. 위 명령은 새 비교 실행용이며 실패한 원문을 덮어쓰지 않는다.

두 평가의 충분 판정 수는 동일했다. 성격 8/8→8/8, 실습 도움 4/4→4/4로 대조군이 이미 만점이어서 각각 +1 기준을 충족하지 못했고, 말투는 **8/8→6/8로 두 질문 쌍에서 퇴행**했다. 나머지 보호 축은 이름 8/8, 사건 의미·현재성 각각 2/2, 기능 정직성 8/8, 공감 6/6을 유지했으며 중대 실패는 양쪽 0개다. 따라서 v9를 개선 정책으로 채택하지 않는다. 두 [주 평가 집계](../results/policy-enacted-v9-primary-summary-2026-11-11.json)·[보조 평가 집계](../results/policy-enacted-v9-secondary-summary-2026-11-11.json)를 함께 보존하고 만점 문항이나 합격선을 사후 변경하지 않는다.

이전 `eval-plan-confirmation.json`은 HCX-005+baseline 대 HCX-007+composed-v8의 전체 설정 업그레이드 비교다. 모델과 하네스가 함께 바뀐 그 실험의 결론·실패 기록을 이번 같은 모델 비교로 대체하지 않는다.

계획 파일은 초기 `eval-plan.json`, `eval-plan-v2.json`, `eval-plan-v3.json`, `eval-plan-models.json`, `eval-plan-structured.json`, `eval-plan-task.json`, `eval-plan-demonstrated.json`, `eval-plan-upgrade.json`, `eval-plan-composed.json`, `eval-plan-confirmation.json`, 후속 `eval-plan-enacted.json`이다. v10은 별도 개발용 `eval-plan-slim-development.json`·`eval-plan-slim-development-r2.json`과 새 확인용 `eval-plan-slim.json`으로 구분한다. 각 조건의 실제 모델·정책은 `executionProfiles`를 확인한다. `baseline`이라는 조건 표시는 항상 CLI 기본 정책을 뜻하지 않는다. **v9와 v10 확인 계획의 baseline 조건은 composed-v8**이다. 각 계획의 API 호출 상한과 10초 간격을 지킨다. 자동 재시도로 실패 원문을 대체하지 않는다. 응답 오류는 즉시 저장하고 실행을 중단하며, 검사 위반 차단은 별도 상태로 남긴다.

### v9의 두 평가와 별도 합격 판정

같은 원문에서 만든 블라인드 패킷을 두 평가자가 각각 전체 채점하고, 조건 공개와 상호 점수 열람 전에 두 검토를 고정한다. 각 검토는 `summarize.mjs`로 원문·패킷·매핑·인용을 검증한 별도 summary로 만든다. 그 뒤에만 다음 명령을 실행한다. 아래 SOURCE와 두 summary는 모두 같은 새 실행에서 만들어야 하며 출력은 새 경로여야 한다.

```bash
# 형식: acceptance-v9.mjs SOURCE SUMMARY1 SUMMARY2 OUTPUT
node runtime/memory-lab/policy/acceptance-v9.mjs \
  runtime/memory-lab/results/policy-enacted-new-run.json \
  runtime/memory-lab/results/policy-enacted-new-summary.json \
  runtime/memory-lab/results/policy-enacted-new-secondary-summary.json \
  runtime/memory-lab/results/policy-enacted-new-acceptance.json
```

v9는 사전에 별도로 등록한 기준을 사용한다. 16회 모두 전달·8개 유효 쌍·재시도/교정/오류 없음에 더해, **두 평가 모두 성격 충분 수 +1 이상, 실습 도움 충분 수 +1 이상**이어야 한다. 보호 축은 이름·말투·사건 의미·현재성·기능 정직성·공감이며, 각 축의 충분 수가 줄지 않고 **같은 질문 쌍에서 점수가 내려간 응답도 0개**여야 한다. 중대 실패 수 증가도 허용하지 않는다. 성격·도움 축의 개별 퇴행은 순증가가 있더라도 별도로 공개한다. 대조군이 이미 만점이면 개선 기준은 미달로 남기며 질문이나 합격선을 사후 교체하지 않는다.

`summarize.mjs`의 과거 `compiledGate`는 이번 합격 판정이 아니다. `acceptance-v9.mjs`의 `overallPass`와 두 개별 판정을 사용하며 과거 결과는 그대로 보존한다. 이 도구는 입력 summary의 원문 해시와 실행 조건을 확인하지만 원문 인용을 다시 심사하거나 평가자의 독립성을 증명하지는 않는다. 따라서 두 전체 검토와 선행 summary 검증을 생략할 수 없다. 통과하더라도 소규모 AI 평가 파일럿이며 사람 검증·운영 승격을 뜻하지 않는다.

### v10: 같은 모델의 두 주제 확인 시험

새 [확인 계획](eval-plan-slim.json)은 **HCX-007+composed-v8 대 HCX-007+slim-v10**을 인물 2개·주제 2개·주제별 질문 4개로 비교한다. 조건당 16회, 합계 32회이며 temperature 0·최대 출력 2048·thinking none·tools none·요청당 한 번 생성을 유지한다. 실제 신뢰된 입력 상태와 기억 정정·재시작은 같은 조건이고 출력 계약·compiler suffix가 달라진다.

```bash
python3 runtime/memory-lab/live-from-deployment.py --live --policy-eval \
  --plan runtime/memory-lab/policy/eval-plan-slim.json \
  --output runtime/memory-lab/results/policy-slim-new-run.json
```

이 명령은 최대 32회의 과금 가능한 실제 API 요청을 실행한다. 이미 존재하는 출력 파일을 덮어쓰지 않으므로 항상 새 경로를 사용한다. CLI 기본 `baseline`과 계획의 baseline 조건을 구분한다. **이 계획의 baseline 조건은 composed-v8**이다. 배포 서버의 기존 자격증명을 읽어 로컬에서 비교하는 명령이며 운영 웹에 새 정책을 배포하지 않는다.

이전에 수행한 개발 r1·r2 합계 16호출은 과거 키보드 실패 사례를 사용한 별도 진단이다. 새 두 주제의 32호출 확인 결과와 합쳐 품질 합격을 주장하지 않는다. 개발 중 수정·실패와 최종 확인의 상태·판정은 [두 번째 사이클 보고서](../../../PERSONA-CYCLE2-2026-11-11.md)에 기록한다.

새 실행에서 블라인드 패킷과 매핑을 생성하고, 두 평가자에게 **패킷만** 제공한다. 두 전체 리뷰를 조건 공개·상호 점수 열람 전에 동결한 뒤 각각 검증·집계한다. 아래 명령의 `primary-review`와 `secondary-review`는 이 과정을 통해 먼저 작성되어야 한다.

```bash
node runtime/memory-lab/policy/blind-packet.mjs \
  runtime/memory-lab/results/policy-slim-new-run.json \
  runtime/memory-lab/results/policy-slim-new-blind.json \
  runtime/memory-lab/results/policy-slim-new-map.json

node runtime/memory-lab/policy/summarize.mjs \
  runtime/memory-lab/results/policy-slim-new-run.json \
  runtime/memory-lab/results/policy-slim-new-blind.json \
  runtime/memory-lab/results/policy-slim-new-map.json \
  runtime/memory-lab/results/policy-slim-new-primary-review.json \
  runtime/memory-lab/results/policy-slim-new-primary-summary.json

node runtime/memory-lab/policy/summarize.mjs \
  runtime/memory-lab/results/policy-slim-new-run.json \
  runtime/memory-lab/results/policy-slim-new-blind.json \
  runtime/memory-lab/results/policy-slim-new-map.json \
  runtime/memory-lab/results/policy-slim-new-secondary-review.json \
  runtime/memory-lab/results/policy-slim-new-secondary-summary.json

# 형식: acceptance-v10-report.mjs SOURCE FROZEN_PLAN SUMMARY1 SUMMARY2 OUTPUT
node runtime/memory-lab/policy/acceptance-v10-report.mjs \
  runtime/memory-lab/results/policy-slim-new-run.json \
  runtime/memory-lab/policy/eval-plan-slim.json \
  runtime/memory-lab/results/policy-slim-new-primary-summary.json \
  runtime/memory-lab/results/policy-slim-new-secondary-summary.json \
  runtime/memory-lab/results/policy-slim-new-acceptance.json
```

v10 판정은 32응답 전수 전달·16개 대응 쌍·오류/교정/재시도 없음과 함께 **두 리뷰 모두 모든 8축의 충분 응답 수 감소0·대응 문항 점수 퇴행0·중요 실패 증가0**을 요구한다. 그 위에서 말투·성격·실용 도움 중 최소 한 축의 충분 응답이 +1이면 `qualityGain`, 실제 총 입력·출력 토큰이 각각 20% 이상 줄면 `efficiencyGain`으로 구분한다. 효율 경로는 사용량이 완전하고 요청별 합계가 대조된 경우에만 판정한다. 두 리뷰 모두 해당 보호 조건을 충족해야 하며, 품질 향상은 두 리뷰 각각에서 확인되어야 한다.

현재 실행 보고서의 일반 민감정보 제거기가 키 이름의 `Token`을 보고, 비밀이 아닌 `minimumInputTokenReductionPercent`와 `minimumOutputTokenReductionPercent`의 숫자 20까지 `***`로 저장했다. 이 때문에 동결된 `acceptance-v10.mjs`를 보고서에 직접 실행하면 profile 검증에서 실패한다. [보고서 복구 wrapper](acceptance-v10-report.mjs)는 정확히 이 두 마커만 원래 계획의 20으로 메모리 안에서 복원한다. 원본 계획의 SHA가 `source.planSha256` 및 당시 snapshot과 같고, 두 값 이외의 전체 계획이 원본과 완전히 같으며, 당시 판정 코드 snapshot도 현재의 동결된 판정 코드와 같아야 한다. 다른 값·다른 차이·잘못된 snapshot은 거부한다.

wrapper는 기준을 바꾸지 않고 **기존 `evaluateV10`을 그대로 호출**하며, 원문 source·summary의 원래 바이트 해시를 사용한다. 결과의 `reportRecovery`에 두 필드 복원·계획/판정 코드/snapshot 해시 검증을 기록한다. 실행 원문·계획·리뷰·요약·동결 판정 코드는 수정하지 않는다. 이 명령에는 해당 실행의 `sourceSnapshots` 경로에 있는 코드·계획 사본이 필요하다. 별도 환경에서 재검증하려면 보존된 소스 묶음에서 해당 사본을 먼저 복원해야 한다. 기존 출력 파일은 덮어쓰지 않는다.

Git clone 후 이번에 저장한 확인 결과를 재검증할 때는 프로젝트 루트에서 아래 명령으로 필요한 snapshot 두 개만 복원할 수 있다. 새 실제 API 실행은 자신의 snapshot을 직접 만든다. 아래 복원은 모델을 호출하지 않으며 기존 파일이 다르면 덮어쓰지 않고 실패한다.

```bash
python3 - <<'PY'
import hashlib, json, tarfile
from pathlib import Path
root = Path.cwd().resolve()
results = root / 'runtime/memory-lab/results'
report = json.loads((results / 'policy-slim-v10-confirmation-live-2026-11-11.json').read_text())
archive = results / 'policy-slim-v10-source-snapshots-2026-11-11.tar.gz'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '476a908f56ba63a1a4edc6aab2105c48245a9c80fb64d0f69b1d5b2ee9bddcc3'
with tarfile.open(archive, 'r:gz') as source:
    for name in ['policy/eval-plan-slim.json', 'policy/acceptance-v10.mjs']:
        snapshot = report['sourceSnapshots'][name]
        assert snapshot['path'] == report['rawArtifacts'] + '/source/' + name
        target = (root / snapshot['path']).resolve()
        assert target.is_relative_to(root / '.local/policy-live')
        member = source.getmember(report['runId'] + '/source/' + name)
        assert member.isfile()
        data = source.extractfile(member).read()
        assert hashlib.sha256(data).hexdigest() == snapshot['sha256']
        if target.exists():
            assert target.read_bytes() == data
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(data)
print('Verified the two frozen snapshot files; no model calls.')
PY
```

그 뒤 실제 저장된 `policy-slim-v10-confirmation-live-2026-11-11.json`, `eval-plan-slim.json`, `policy-slim-v10-primary-summary-2026-11-11.json`, `policy-slim-v10-secondary-summary-2026-11-11.json`을 wrapper에 주고 **새 출력 파일명**을 지정한다. 원래 평가 원문과 출력 파일은 보존한다.

최종적으로 wrapper가 반환한 동결 판정기의 `overallPass`, `disposition`, `qualityGain`, `efficiencyGain`을 확인한다. `summarize.mjs`의 역사적 `compiledGate`나 `acceptance-v9.mjs`로 v10을 판정하지 않는다. 효율만 좋아졌다면 성격이 향상됐다고 표현하지 않는다. 인용 검증은 선행 `summarize.mjs`의 책임이고 판정기는 평가자 독립성이나 인간 검증을 증명하지 않는다. 실제 확인 결론과 판정 실패/복구 기록은 [두 번째 사이클 보고서](../../../PERSONA-CYCLE2-2026-11-11.md)를 따른다.

## 단일 CLI 세션

프로젝트 안의 실제 persona 경로와 저장소 경로를 지정한다:

```bash
node runtime/memory-lab/pi/cli.mjs \
  --model clova:HCX-007 --tools none --policy composed-v8 \
  --max-tokens 2048 --max-turns 1 --min-call-interval-ms 10000 \
  --context-chars 16000 \
  --store "$PWD/.local/persona-manual/memory.sqlite" \
  --principal local-user --conversation local-session \
  --persona "$PWD/runtime/memory-lab/fixtures/live-calm.json"
```

이 수동 예시는 기존 v8 실험 정책을 선택하며 추천 승격이나 품질 보증을 뜻하지 않는다. CLI 기본 정책은 baseline으로 유지했고 모델은 명시해야 한다. 미채택 v9를 직접 비교하려면 `--policy enacted-v9`를 명시할 수 있다. `CLOVA_API_KEY_FILE`에는 키 값만 들어 있는 mode 0600 파일의 경로를 사전에 설정한다. dotenv 변수 묶음 파일을 그대로 연결하지 않는다. 표준입력은 JSONL이다. 예: `{"op":"prompt","text":"네 이름과 내가 할 첫 행동을 알려 줘."}`. 기억은 기존 `observe` → `remember` → `approval`에 대한 명시적 승인으로 저장한다. 결과 이벤트에서 `policy_check`, `model_response`, `text`, `turn_end`를 확인한다. `text`는 실제 모델이 생성한 네 부분을 빈 줄로 연결한 전체 답변이고, `turn_end.ok=false` 및 `endReason=persona_violation`이면 최종 답변이 차단된 것이다. 실패한 초안은 모델 로그에 남는다.

slim 후보를 직접 선택하려면 별도 저장소·conversation에서 다음 명령을 사용한다. 기본 정책 변경이나 운영 권장 설정이 아니다. 키 파일과 JSONL 입력 조건은 위와 같다.

```bash
node runtime/memory-lab/pi/cli.mjs \
  --model clova:HCX-007 --tools none --policy slim-v10 \
  --max-tokens 2048 --max-turns 1 --min-call-interval-ms 10000 \
  --context-chars 16000 \
  --store "$PWD/.local/persona-slim-manual/memory.sqlite" \
  --principal local-user --conversation local-slim-session \
  --persona "$PWD/runtime/memory-lab/fixtures/live-calm.json"
```

`max-turns`는 도구 루프와 교정을 합친 전체 요청 상한이다. 한 번의 교정 공간이 필요하면 충분한 상한을 둔다. `correctionAttempts`는 교정 시도, `correctionModelCalls`는 실제 교정 모델 호출 수이므로 다를 수 있다.

## HCX-007 및 JSON 계약

Brain은 007에서 `maxCompletionTokens`와 `thinking.effort=none`을 사용한다. Structured Outputs는 네이티브 `type: json`이고 도구·thinking과 함께 사용하지 않는다. 스키마가 맞아도 실제 답변의 이름·성격·사실이 맞는지는 별도 평가한다. `structured_reply`에는 정확한 답변·메타데이터·`semanticVerified:false`가 기록된다. JSON 오류는 `structured_invalid`, 잘림은 `truncated`로 실패한다. 의미 guard의 `repairNeeded`는 구조화 정책에서 자동 차단/교정이 아니라 진단이다. 명시적 금지 문자열은 여전히 차단한다. 다음 대화에는 답변만 남기고 모델 생성 메타데이터를 승인 기억으로 저장하지 않는다.

일반 HTTP Wrapper의 007 허용은 `node runtime/clova/http.ts --models HCX-005,HCX-007 --port 8787`로 명시할 수 있다. 이 CLI 페르소나 정책은 HTTP Wrapper 경로에 자동 주입되지 않는다.

v7은 명시적 한국어 해요체/반말 및 외부 기능 없는 설정만 지원한다. 다른 말투를 조용히 바꾸지 않는다. `providerMessages`에는 예제를 포함해 실제 Brain에 넘긴 메시지를, `demonstrationChars`에는 별도 예제 크기를 기록한다. system+기억의 문자 예산에 예제 비용이 포함됐다고 간주하지 않는다.

v8의 `reply`는 네 문자열 객체다. `structured_reply.rendering.parts`와 `separator`로 표시된 전체 문장을 재구성할 수 있다. 프로그램이 이름·사실·답변 라벨을 넣지 않는다. 한 개의 raw reply 문자열을 그대로 표시하는 v5/v6/v7과는 다른 투영 방식이다. 평가에는 모든 표시 문장을 포함하며 숨겨진 metadata를 점수에 포함하지 않는다.

v9도 같은 네 문자열과 렌더링 순서를 유지한다. 추가 `support_plan`은 `target`, `operation`, `completion_cue`, `persona_choice`, `reason`의 정확히 다섯 문자열이며 metadata에 보존된다. 계획만 맞고 표시 답변이 추상적이면 의미상 성공이 아니다. 계획이나 `next_action`을 답변에 자동 복사하지 않으며, 필요한 행동이 없는 질문은 관련 계획 필드와 다음 행동을 빈 문자열로 둘 수 있다. decoder의 형식 검사는 계속 `semanticVerified:false`를 반환한다.

v10의 최상위 객체에는 `reply`만 있고 그 안에 정확히 네 모델 생성 문자열이 있다. 숨은 이름·기능·사실·계획 metadata는 생성하지 않으며 decoder는 `metadata:{}`를 반환한다. 정체성·capabilities·승인 기억은 여전히 실제 입력 상태로 전달한다. 표시 내용은 원문 네 부분을 연결하며, 이름·사실·행동 보충이나 어미 치환은 없다. 추가 필드·잘못된 타입·빈 표시 답변은 `structured_invalid`다. 파싱·구조 검사만 수행하므로 `semanticVerified:false`이며 의미 품질은 별도 평가한다.

## 증거와 평가

- 실행 시 코드·계획·페르소나 해시와 소스 snapshot을 보존한다.
- 승인 기억의 전체 레코드가 예산 안에 들어갈 때만 선택한다. 일부 필드나 출처를 중간에서 잘라내지 않는다.
- `model_context`에 실제 전달된 system, 대화, 선택/누락 개수, 요청 시각을 남긴다.
- 초안, 교정, 차단, 원문 그대로의 최종 답변, 요청별 사용량과 지연을 분리한다.
- 교정 성공 후에는 거절한 초안과 내부 교정 지시를 다음 대화 이력에서 제거한다. 승인 기억 정정·실패·재시작의 이력 초기화도 기록한다.
- `blind-packet.mjs`는 조건 이름과 초안/교정 구분을 숨긴 검토 패킷을 만든다. `summarize.mjs`는 독립 AI 검토의 원문 인용·분모·해시를 확인해 요약한다.

검사 결과 `ok`는 구현된 좁은 규칙의 위반을 찾지 못했다는 의미다. 이름의 복잡한 주체, 한국어 우회 표현, 자유문장 사건의 의미, 실제 공감과 성격을 완전히 판정하지 않는다. 지원 범위 밖의 문장은 별도 의미 평가가 필요하다. 상세 성능과 차단·퇴행 사례는 프로젝트 루트의 해당 날짜 실행 보고서를 따른다.

이 정책은 독립 Pi CLI 실험에 통합되어 있다. Agno adapter, 실제 Elda-CLI 레지스트리와 운영 웹 배포에는 별도 연결 작업이 필요하다.

이전 10회차 증거: [전체 분석](../../../PERSONA-POLICY-IMPROVEMENT-2026-11-11.md), [확인 시험 원문](../results/policy-confirmation-live-2026-11-11.json), [주 집계](../results/policy-confirmation-summary-2026-11-11.json), [두 번째 집계](../results/policy-confirmation-secondary-summary-2026-11-11.json), [호출·해시 원장](../results/policy-evidence-ledger-2026-11-11.json). 그 확인 시험의 16호출은 오류 없이 전달됐지만, 성격 +1을 두 평가자 모두 확인해야 하는 기준은 통과하지 못했다. v9의 진행·결론은 [별도 후속 보고서](../../../PERSONA-CONTINUATION-2026-11-11.md)에 기록한다. 구현 검사 통과·API 전달 성공·수치 기준·전체 품질 합격은 별개다.

v10의 연구·개발 진단·새 확인 결과는 [두 번째 사이클 보고서](../../../PERSONA-CYCLE2-2026-11-11.md)에 이어 기록한다. v8·v9의 원문과 판정을 새 결과로 대체하지 않는다.
