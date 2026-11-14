# Core 표준 하네스 페르소나 실험

Core 하네스 v1.000의 템플릿 실행기를 그대로 실행하여 계약 동작과 CLOVA 페르소나 응답을 분리해서 확인하는 실험실이다. 운영 앱의 기본 정책·오케스트레이터·기억 DB를 변경하지 않는다.

- `vendor/`: GanpanAI `523571772cda91429769ed08e915044004b9778e`의 실행기 6개 파일. 수정 없이 복사했으며 실행 전 SHA-256을 검사한다.
- `audit-source/`: 같은 커밋의 훅 계약, before/after 라우터, 세션 연결 소스. 실행하지 않는 감사 근거다.
- `kit/`: Elda-Spec `7ca01ca6`의 원본 적합성 키트 0.817과 memo MCP·fixture. `harness.json`만 이 저장소의 실행기를 가리키도록 작성했다. 승인·알림·피드 검사는 이 설정에서 SKIP이다.
- `runner.mjs`: 원본 실행기를 자식 프로세스로 구동한다. loopback HTTP로 가짜 오케스트레이터와 모델 호환 연결을 제공한다. 별도 에이전트 루프를 만들지 않는다.
- `contract.test.mjs`: 입력 전 차단, 출력 후 검사, 허용 모델, 맥락 역할·이력, 전달 필드, 실험 중단·오류 보존을 검증한다. 현 동작 재현 테스트의 통과는 모든 계약 요구를 만족한다는 뜻이 아니다.
- `plan.json`: 두 persona × 두 조건 × 세 상황 × 두 턴 = 실제 호출 최대 24회. 개발 파일럿이며 확인용 평가셋이 아니다.
- `experiment.mjs`: `--dry-run`은 합성 모델, `--live`는 기존 native CLOVA provider를 쓴다. 재시도 없이 10초 이상 간격으로 실행하고 첫 오류부터 이후 프롬프트를 중단한다. HTTP 응답으로 공급자 오류를 가리는 대신 원래 오류를 원장에 보존한다.
- `summarize.mjs`: 호출·빈 답·출력 상한·실패·사용량·실행기 결과를 집계한다. 의미 통과율을 만들지 않는다.
- `make-review.mjs`: 실행 조건을 숨긴 전체 2턴 검토 자료와 별도 매핑을 만든다. AI 검토와 사람 검증을 구분한다.

Node 24에서 실행한다. 새 의존성 설치는 필요 없다.

```bash
node --test runtime/persona-core-lab/contract.test.mjs runtime/persona-core-lab/summarize.test.mjs
node runtime/persona-core-lab/experiment.mjs --dry-run
CLOVA_API_KEY_FILE=/path/to/mode600.key node runtime/persona-core-lab/experiment.mjs --live
node runtime/persona-core-lab/summarize.mjs <result.json>
node runtime/persona-core-lab/make-review.mjs <completed-live-result.json>
```

표준 키트 재현 시 `LAB_ROOT`는 이 실험 폴더의 절대 경로, `TMPDIR`는 저장소 안에 만든 임시 폴더로 지정한다. `node runtime/persona-core-lab/kit/check.ts runtime/persona-core-lab/kit/harness.json --json <새 결과 경로> --keep`으로 실행하며, 실제 API 호출은 없다.

`--live`만 실제 사용량이 발생한다. 키 내용은 출력하거나 자식 실행기로 전달하지 않는다. 호출 목적지는 NAVER 공식 HTTPS로 제한한다. 원장 파일을 덮어쓰지 않으며 `.local/persona-core-lab`은 실행별 임시 작업 폴더다. 운영 Core end-to-end, MCP 도구, 장기 기억, 재시작 복구는 이 파일럿 범위에 포함되지 않는다.

최초 11월 14일 파일럿의 실행 소스는 `results/executed-source-2026-11-14/`에 보존했다. 그 이후 실험 도구에 실패 직후 중단·fixture 예외 관측·키 초기화 실패 기록을 보강했다. 보강 후 합성 검사는 다시 수행했으며 실제 응답을 새 코드에서 생성한 것으로 표시하지 않는다.

결과와 후속 작업은 [검증 보고서](REPORT-2026-11-14.md), 조사 근거는 [기술 동향](RESEARCH-2026-11-14.md)에 있다.
