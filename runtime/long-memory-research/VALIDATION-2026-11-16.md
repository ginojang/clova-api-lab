# M3 구현·로컬 검증 결과

2026-11-16 · Python 3.12.3 · **63개 테스트 통과**, 실패·오류 0. 실제 모델/API·관문·DB 호출은 0회다. 이 문서의 통과는 평가 도구의 로컬 검사이며 우리 시스템의 기억 성능이 아니다.

## 완성한 산출

- 사전등록: `66c7b4ed7924df7e866a8ad3bfc7dfcffa043925`의 plan.json/CONTRACT.md. 계획 SHA256 `4bd537d16a51abd43ed66b7456699b84f1c3046af08add353a14a25cd1d1380d`.
- 자료·코드: `2261def7bf9c72b46ce11e432c546d95458403d6`의 [eval-v0](eval-v0/README.md). 16기제×2용도, **32이야기·96세션·96탐침**, 구조 검사 **480개**. 양성 80은 기억 주입을 요구하는 탐침 수다. 계약 94·도전 2를 분리하고 전체 분모는 96으로 유지한다.
- 생성기, 입력/정답 분리, 눈가림 자료·빈 라벨·역매핑, 한 세션 입력 추출, 관측 ID 복원, 엄격한 JSONL 채점기, 등록 초안·SHA256 manifest를 구현했다.
- `manifest.json` SHA256: `238313a8ac69410ca213c1e7050096cb3cd7b73d13fe0ddc4d4b8abc40b0aa65`. 15개 파일의 바이트 해시를 확인했다. manifest는 자기 자신을 포함하지 않는다.
- `registration.json`은 **미등록 초안**이다. `use=eval`, note에 pretest·학습 금지, `authored_by=other_llm`, `n_items=96/n_pos=80`. ref_commit의 실제 gold 바이트와 content_md5 `412026558c03458773c3a1de5b7612fb`가 일치함을 확인했다.

## 검증

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s runtime/long-memory-research/eval-v0 -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/eval-v0/bundle.py verify
PYTHONDONTWRITEBYTECODE=1 python3 runtime/long-memory-research/eval-v0/bundle.py export-stage --scenario m01-signage --session 1
git diff --check
```

첫 명령: `Ran 63 tests … OK`(채점기 41, 묶음 13, 자료 연결 9). 나머지 명령도 종료 0. 한 세션 추출 결과에는 미래 세션·기대값이 없고 실제 해당 탐침 범위가 선택됐다.

검증 범위:

- 32×3 구성, 96 ID 일대일 대응, 시간순·제어 이벤트 참조, 16기제×2용도, 원본/눈가림 이력 일치, 빈 라벨96, 재생성 바이트 일치.
- 누락96개를 unknown으로 분모에 유지, 중복·모르는 ID·mixed run·중복 JSON key·NaN/Infinity·잘못된 타입 거부, 0분모 null 및 안전 검사0개 전체통과 금지.
- 답은 정상이어도 S4 타인 표식 주입은 실패, 철회 값 검색 실패, 기억 전부 끈 경우 양성 회상 실패, 실패와 unknown의 우선순위.
- 응답 SHA256 결합, 평가자·버전·근거 누락 unknown, Unicode U+0085/U+2028/U+2029 원문 보존, 입력/출력 덮어쓰기 방지.
- 눈가림 target 및 episode source event ID 복원, 답 원문·판정 해시 불변, 복원 출처 기록.
- gold에서 만든 **명시적인 모의 관측**으로 96개 대상의 구조 조건을 함께 만족시킬 수 있음을 확인. 실제 생성 응답이나 모델 품질 점수로 사용하지 않는다.

독립 검토에서 발견한 0관문 초록, 추출 전 검증 우회, 무한대 숫자, Unicode 줄 분리, 정정 대상 부재, 보류 C와 정상 C의 모호성, 불필요한 검색 경로 강제를 고쳤다. 실제 모델 결과를 보고 기준을 조정한 것이 아니다.

## 후속 실행과 한계

오케스트레이터가 제어 이벤트를 실제 T/C·원장·S4 관측과 연결하고 리소너가 연산별 target/근거 평가를 결합해야 한다. 지원하지 않는 관측은 unknown이다. 파일/캐시/프로세스/백업 물리 삭제는 미측정이다. source_ref/hash는 제출 출처이며 원격 내용·판정자 신원을 이 채점기가 인증하지 않는다.

의미 판정은 별도 소넷/오퍼스 또는 명시된 검수자의 결과를 집계한다. 한국어 답변의 의미를 exact 검사로 대신하지 않는다. 의미 판정의 target/run/rubric 결합은 별도 원장 감사 대상이다. 미열람 홀드아웃·사람 라벨 완료·모델 합격·배포 완료를 주장하지 않는다.

M4 다섯 감사 조건은 Elda-Spec v1.020 `93e9542`에 반영됐음을 확인했다. 실제 구현·운영 반영은 별개다. 늦은 작업 거부는 구세대 쓰기 커밋에 대한 조건이며 호출 성공이나 무변경 NOOP 자체를 실패로 세지 않는다.
