# 페르소나와 리서치 작업 현황

기준일: 2026-11-14. 저장된 결과의 기준 커밋은 `7d2f1ce`다. 이 문서는 기존 연구와 후속 결정의 진입점이며, 새 모델 호출·학습·배포 결과가 아니다. 실행할 일은 [작업 목록](RESEARCH-TASKS.md)에 모았다.

현재 결정은 **운영 하네스는 Elda CLI native, 페르소나는 실험 후보 유지, 초소형 한국어 다듬기망은 학습 보류**다. 실험 수행 완료와 품질 기준 통과를 구분한다. 다른 팀의 배포 보고는 이 랩의 직접 재검증과 구분한다.

## 연구 갈래와 최종 상태

| 갈래 | 수행 내용 | 현재 판단과 근거 |
|---|---|---|
| CLOVA 연결·웹 실험 | API·도구 호출, Wrapper, MCP, LangGraph 웹 경로와 비교 기능 | 제한된 실제 호출·웹 검증 완료. Groq/OpenRouter/Z.ai의 연결·모의 검사는 실제 키/모델 검증과 별개. [작업 기록](WORKLOG-2026-11-10.md) |
| 공개 하네스 조사 | 실행 후보 23개, 서비스형 3개, 영속 실행 보완 1개 조사; Vercel/PydanticAI/Pi 프로토타입 | 후보 확장 단계는 종료. 최종 실행기 선택은 아래 H31 결론을 우선한다. [조사](HARNESS-OPTIONS-2026-11-10.md), [프로토타입](HARNESS-PROTOTYPE-RESULTS-2026-11-10.md) |
| H31 실행기 비교 | native/LangGraph/Pi 실제 과제·오류 복구·원시 인자 검증 | ② 운영 기본은 native. LangGraph는 동결 회귀 기준선, Pi는 페르소나 실험용. [최종 결론](runtime/clova/h31/CONCLUSION-2026-11-11.md) |
| 기억 저장·격리 | Pi+SQLite, Agno native memory, 재시작 회상·정정·잊기·승인·namespace | scripted 구조 검사 48/48. 자연어 기억 추출·의미 검색·장기 품질 보장은 아님. [구조 결과](MEMORY-PERSONA-RESULTS-2026-11-10.md) |
| 실제 페르소나 | HCX-005 첫 응답, 강화 지시, HCX-007 구조화 정책 v8~v11 | 일부 축 개선, 전체 기준 미달. 운영 기본 정책으로 승격하지 않음. [PRSN 인계](runtime/memory-lab/PERSONA-V8-HANDOFF-2026-11-11.md) |
| 운영 알림 해석 | host-watch 고정 사례와 v3 개선 | 사전 기준 전체는 미통과이나 내용 보호 개선으로 담당 팀이 v3 적용·갈래 종료. [v3 결과](runtime/clova/ops-task/candidate-v3/RESULT.md) |
| 받은편지함 요약 | 요청/완료 구분, 잘린 안내, 읽음 시점, 구조 목록 보존 | 읽음 회귀 11/11. 요약의 의미 실패는 별도이며 후속 개선 후 갈래 종료. [최종 결과](runtime/clova/ops-task/inbox-digest/RESULT-2026-11-11.md) |
| 한국어 문장 다듬기망 | 선생 데이터, 슬롯 검사, 소형 모델·ONNX CPU 실측 | 조사·인계 완료, 학생 학습 보류. 현재 HCX-005 선생 구성을 무검수 정답으로 채택하지 않음. [결론](runtime/realizer/README.md), [보류 결정](runtime/realizer/HANDOFF-2026-11-11.md) |
| 모델 계보 포렌식 | CLOVA LLM/Vision/Audio 보고서와 재현 스크립트 | 과거 분석 보존. 결론 강도·대상 revision·원시 결과 추적 보강 필요. [LLM](analysis/CLOVA-LLM-증류분석.md), [Vision](analysis/CLOVA-Vision-증류분석.md), [Audio](analysis/CLOVA-Audio-증류분석.md) |
| 멀티모달 | 이미지 RAG → 공간 지각 → VQA 단계 설계 | 설계 단계. 구현 완료로 보지 않음. [설계서](multimodal/00-시작-설계서.md) |

## 페르소나 실험의 흐름

| 단계 | 결과 | 해석 |
|---|---|---|
| HCX-005 첫 응답 | Pi/Agno × 두 persona × 8개 상황 = 32개 실제 응답 | 전달 32/32는 페르소나 통과율이 아님. 이름·말투·사건 의미·기능 설명 실패 관측. [원문 보고](LIVE-PERSONA-RESULTS-2026-11-10.md) |
| 명시적 지시 강화 | 일부 말투·실용성 개선, 정체성·사건 의미 불안정 | 429와 중간 이력 초기화가 있는 조건을 연속 대화와 동일시하지 않음. [후속 결과](PERSONA-FOLLOWUP-RESULTS-2026-11-10.md) |
| composed-v8 | 코드 고정 확인에서 이름 6/8→8/8, 말투 4/8→7/8. 성격은 평가자별 7/8→8/8, 6/8→6/8 | 전체 기준 미달. 005→007과 정책·출력 계약이 함께 바뀐 비교여서 정책만의 효과로 해석할 수 없음. [정책 결과](PERSONA-POLICY-IMPROVEMENT-2026-11-11.md) |
| enacted-v9 | 같은 HCX-007, 16회 비교. 성격·도움 유지, 말투 8/8→6/8 | 미채택. [결과](PERSONA-CONTINUATION-2026-11-11.md) |
| slim-v10 | 새 확인 32회. 말투 14/16→16/16, 입력 32.95%·출력 40.85% 감소 | 이름 중요 실패·공감 퇴행이 남아 전체 보호 기준 미달. 개발 포함 48회. [결과](PERSONA-CYCLE2-2026-11-11.md) |
| anchored-v11 | 새 확인 32회. 이름 16/16→14/16, 성격 15/16→13/16, 도움 5/8→3/8 | 미채택. 개발 포함 64회. [결과](PERSONA-CYCLE3-2026-11-11.md) |

기본 정책은 `baseline`이며 v8~v11은 명시 선택 실험 옵션이다. Pi를 페르소나 실험에 쓰는 결정과 native를 운영 실행기로 쓰는 결정은 충돌하지 않는다. 두 AI의 평가 불일치는 원문 그대로 유지한다. 사람 검증이나 장기 대화 일반화를 완료한 것은 아니다.

정책·개발 probe 최신 원장 범위는 **344회, 입력 700,930·출력 65,113토큰**이다. v8 비교 32회는 이 안에 포함되므로 더하지 않는다. 앞선 Pi/Agno 초기 실험, H31, 다른 팀 운영 호출, realizer 선생 호출과 별도 원장이다. [정산·인계](runtime/memory-lab/PERSONA-V8-HANDOFF-2026-11-11.md)

## 남겨둘 연구 자료

| 주제 | 읽을 자료 | 다음 설계에서 활용할 내용 |
|---|---|---|
| 기억 프레임워크 | [최초 조사](runtime/memory-lab/research.md) | Hermes/Letta/Agno/LangGraph/Mem0/Graphiti의 소유권·회상·저장 차이. 조사만 한 후보를 구현한 것으로 표시하지 않기 |
| 정체성·행동·평가 | [persona](runtime/memory-lab/research-2026-11-11-persona.md), [memory](runtime/memory-lab/research-2026-11-11-memory.md), [eval](runtime/memory-lab/research-2026-11-11-eval.md) | 정체성 anchor와 학습 기억 분리, 제한된 교정, 축별 의미 평가 |
| 실패 기반 후속 가설 | [v9](runtime/memory-lab/research-continuation-2026-11-11.md), [v10](runtime/memory-lab/research-cycle2-2026-11-11.md), [v11](runtime/memory-lab/research-cycle3-2026-11-11.md) | 연구 가설과 실제 후보 실패를 함께 읽기. 논문 결과를 HCX 품질 보장으로 옮기지 않기 |
| 운영 계약 | [운영 프로필 지침](runtime/clova/ops-task/OPS-PROFILE-GUIDE-2026-11-11.md) | 사실·목록·상태는 프로그램이 보존하고 모델은 해석만 추가. harness v0.813 반영은 담당 팀 보고 |
| 작은 한국어 realizer | [모델](runtime/realizer/research-models.md), [런타임](runtime/realizer/research-runtime.md), [제어·학습](runtime/realizer/research-control-training.md) | 의미 계획 확정 후 표현만 생성, 슬롯·의미 검증·fallback, 목표 크기와 실제 배포량 구분 |

이 목록은 기존 리서치의 색인이다. 이후 사용자 지시로 수행한 최신 공식 자료 조사는 [Core 하네스와 persona 기술 동향](runtime/persona-core-lab/RESEARCH-2026-11-14.md)에 별도로 정리했다.

## Realizer에서 확인한 한계

- HCX-005 선생 생성 16회, 계획 120행 중 최초 응답 108행을 평가. 두 AI가 의미·말투·자연스러움을 모두 통과시키고 불확실성이 없는 교집합은 29/108. 사람 검수된 학습 정답은 아니다.
- 어휘 검사 통과 55행 중 21행은 두 AI 모두 의미 실패로 판정. 슬롯 존재만으로 의미역·부정·요청과 완료를 보장하지 못한다.
- pluto CPU의 BART-ko small FP32 16토큰 생성 p50은 193.76ms. 이번 INT8 구성은 더 느렸다. 다른 장비·GPU·브라우저의 성능으로 일반화하지 않는다.
- 약 23M·16k tied 어휘·이름 자리표 복원은 학생 설계안이다. 학습·목표 크기 달성·모바일 실측은 수행하지 않았다.

근거: [선생 평가](runtime/realizer/TEACHER-RESULT.md), [CPU 실측](runtime/realizer/BENCHMARK-CPU.md). 학습 재개는 GPU 자리와 시점에 대한 사용자 결정 후에만 진행한다.

## 종료 결정과 운영 상태를 혼동하지 않기

- H31의 초기 “LangGraph 기준선 유지”는 최종 native 채택으로 갱신됐다. H57/H61과 native 오류 경계는 소유자 수정 보고가 있어 중복 수정 요청을 보내지 않는다.
- host-watch/inbox-digest는 기존 실패를 보존한 채 종료됐다. 운영 채택을 모델의 전체 기준 통과로 바꾸지 않는다.
- Comms 인계는 이미 발송된 기록이 있다. [인계 원장](runtime/clova/COMMS-HANDOFF-SENT-2026-11-11.md), [realizer 인계](runtime/realizer/HANDOFF-2026-11-11.md)를 확인하고 중복 발송하지 않는다. 과거 “승인 대기”보다 [AGENTS.md](AGENTS.md)의 지속 승인이 우선한다.
- 11월 14일 읽기 전용 점검에서는 공개 웹·앱·터널·인증된 하네스 info가 정상이다. Bench는 시작 시 DB 네트워크 실패 후 503에 머물렀고, DB TCP는 복구되어 있었다. TEI 기본 구주소는 시간 초과, 배포 스크립트도 구주소였다. 이 운영 장애가 과거 연구 결과를 무효화하지는 않지만 재실행 전 정리가 필요하다.

## 11월 14일 후속 Core 하네스 실험

사용자 지시에 따라 Core 표준 v1.000·훅 v1.0과 최신 연구를 확인하고 [별도 실험실](runtime/persona-core-lab/README.md)을 구현했다. 규격 본선은 Elda CLI + 오케스트레이터 훅이며, 이번 실제 호출은 원본 Core 전용 템플릿 + 로컬 fixture + CLOVA 공급자 경로다.

표준 키트 실패 0·경고 0, 신규 테스트 12/12, HCX-007 실제 응답 24/24를 확인했다. 입력 6,877·출력 1,842토큰은 기존 344회 정책 원장과 별도로 관리한다. 정체성 귀속·이름 누락·말투 실패가 남아 운영 승격은 하지 않는다. [결과와 한계](runtime/persona-core-lab/REPORT-2026-11-14.md), [추가 작업](RESEARCH-TASKS.md)

기존 원문·평가·실패 기록과 수정 중인 `CLAUDE.md`는 변경하지 않았다.
