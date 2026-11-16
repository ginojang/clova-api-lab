# M2 — 장기기억 평가 방법론 검토

확인일: 2026-11-16 · 담당: 클로버 · 상태: 외부 자료 조사 및 정적 코드 검토.

허용 작업: 원논문·공식 저장소 열람, 공개 데이터 구성 계수, 이 문서 작성. 모델 API·내부 관문·DB 접근, 실험·테스트·구현은 수행하지 않았다.
본문의 수치는 논문 보고 또는 공개 자료 계수이며 우리 시스템의 성능이 아니다. M3의 실행 설계·합격 기준은 별도 결정한다.
세계/NPC 검증은 현 N 범위 밖이다. 관련 언급은 이식 시 구분해야 할 개념이며 실행 범위 확대가 아니다.

## 1. 판단

추출·갱신 과정은 HaluMem, 시간·기권·여러 세션 QA는 LongMemEval, 대화 지속성은 LoCoMo, 상충 사실 처리는 MemoryAgentBench에서 근거를 얻는다.
단일 총점으로 이 기능들을 대체하지 않는다. 최신 값을 답하는 것, 옛값을 노출하지 않는 것, 저장 흔적을 삭제하는 것은 각각 다른 평가다.
확인한 네 벤치마크의 과제·채점 코드에는 사용자·세계 간 접근 격리, 벡터·캐시·백업까지의 삭제 완료를 보장하는 전용 검증이 없다.

## 2. 판과 관측 단위

| 자료 | 확인한 판·규모 | 관측 단위와 혼용 금지 |
|---|---|---|
| LongMemEval | ICLR 2025 논문: 500문항, S 약 115k 토큰/문항, M 500세션·약 1.5M 토큰 | 질문별 대화 이력과 근거; 검색과 답변 정확도는 별도 지표 |
| LoCoMo | 원논문 50대화·7,512문항; 현재 공식 공개 파일은 10대화·1,986문항 | 문항이 동일 대화·사건을 공유하므로 독립 대화 수와 구분 |
| HaluMem | 20 합성 사용자·14,948 기억·3,467 QA; Medium 약 160k, Long 약 1M 토큰/사용자 | 기억점·세션·QA·사용자 분모를 구분; 길이 두 조건은 같은 gold를 공유 |
| MemoryAgentBench | 논문 v4: 2,071문항; LME S*는 5문맥·300문항, FactConsolidation SH/MH는 각각 1문맥·100문항 | chunk 수·질문 수가 독립 기억 이력 수를 뜻하지 않음 |

규모 출처: [LongMemEval 논문](https://arxiv.org/html/2410.10813v2), [LoCoMo 논문](https://arxiv.org/html/2402.17753v1), [HaluMem 논문 v3](https://arxiv.org/html/2511.03506v3), [MemoryAgentBench 논문 v4](https://arxiv.org/html/2507.05257v4).

### LongMemEval 판 구분

- [공식 저장소](https://github.com/xiaowu0162/LongMemEval)는 2025-09 정제판을 안내한다. 원판·정제판·S·M·oracle을 결과명에 구분한다.
- 검색 평가는 근거 위치가 없는 기권 30문항을 제외한다. QA 500과 검색 분모를 동일하게 쓰지 않는다. [공식 실행 설명](https://github.com/xiaowu0162/LongMemEval#memory-retrieval)
- [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2)는 2026-05 소개된 웹 에이전트 경험 기억 과제다. 기존 500문항 대화판과 별개이며 본문에서 V2 성능·채점기까지 감사한 것은 아니다.

### LoCoMo 공개판 직접 계수

[공식 locomo10.json](https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json)을 메모리에서 읽어 JSON 구성만 계수했다. 파일 저장·모델 실행은 없었다.

- 대화 10 · 세션 272 · QA 1,986.
- category 1: 282 · 2: 321 · 3: 96 · 4: 841 · 5: 446.
- 공개 파일 SHA-256: 79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4.
- 공식 저장소도 최초 50대화에서 품질·길이·평가 비용을 고려해 10대화로 추렸다고 설명한다. [공개판 설명](https://github.com/snap-research/locomo#data)

## 3. 실제 지원하는 평가축

| 축 | [LongMemEval](https://arxiv.org/html/2410.10813v2) | [LoCoMo](https://arxiv.org/html/2402.17753v1) | [HaluMem](https://arxiv.org/html/2511.03506v3) | [MemoryAgentBench](https://arxiv.org/html/2507.05257v4) |
|---|---|---|---|---|
| 추출 | 최종 QA·검색의 간접 지표 | QA·사건 요약 | 추출 기억 자체와 gold 비교 | 주로 검색·QA |
| 갱신 | 최신 정보에 따른 QA | 독립 갱신 작업 평가 없음 | 갱신 gold와 검색 기억 비교 | FactConsolidation 상충 사실 처리 |
| 기권 | 거짓 전제 30문항 | adversarial QA | Memory Boundary·Conflict | 독립 핵심축 아님; S*의 기권 보존 범위 미확인 |
| 시간 | 시점·기간·순서 | temporal QA | 시간 추론·동적 상태 | EventQA 순서·최신 사실 우선 |
| 여러 세션 | 시간순 사용자–assistant 기록 | 두 인물의 장기간 대화 | 사용자별 시간순 세션 | 자료를 chunk로 나눈 모의 대화 |
| 망각 | 갱신 답변의 간접 지표 | 오래된 정보 회상 | 갱신·삭제 의미를 결과로 평가 | 최신 사실에 따른 답변이라는 대리 지표 |
| 누수·삭제 보장 | 별도 검증 필요 | 별도 검증 필요 | 별도 검증 필요 | 별도 검증 필요 |

위 분류는 각 논문의 과제 정의와 아래 공식 scorer를 함께 읽은 해석이다. “지원”은 해당 능력의 측정 근거가 있다는 뜻이며 운영 보장을 뜻하지 않는다.

## 4. 데이터와 판정 근거

### LongMemEval

질문·근거는 사람이 작성·수정하고, 근거 대화는 LLM 합성 후 사람이 검수한다. IE라는 이름은 저장된 추출 원장을 직접 채점한다는 뜻이 아니다.
QA judge는 gpt-4o-2024-08-06이다. 논문은 유형당 30문항·두 생성 모델을 대상으로 약 97~98%의 사람 판정 일치를 보고한다. 한국어·새 오류 유형에 그대로 적용할 수 없다. [논문 §3·A.4](https://arxiv.org/html/2410.10813v2)

### LoCoMo

페르소나·시간 사건 그래프에 따라 LLM이 만든 대화를 사람이 수정했다. 실제 사람 간 자연 대화 수집본으로 표시하지 않는다.
QA 외에 사건 요약·멀티모달 대화 생성도 평가한다. QA는 주로 token F1, 사건 요약은 atomic fact 기반 평가를 사용하므로 모두 같은 “정확도”가 아니다. [논문 §3–5](https://arxiv.org/html/2402.17753v1)

### HaluMem

Medium의 700세션을 사람 8명이 확인한 95.70%는 데이터 품질 수치다. 자동 judge의 메타 정확도가 아니다.
세션 처리 직후 추출·갱신·QA를 평가한다. GPT-4o를 판정에 사용하고, 갱신은 관련 기억 top-10, QA는 top-20을 사용한다. Long은 같은 기억·QA에 방해 대화를 추가한 조건이다. [논문 §4–6](https://arxiv.org/html/2511.03506v3)
FMR은 assistant가 말했지만 사용자가 확인하지 않은 내용을 기억으로 채택하지 않는 능력이다. “제안”과 “승인”을 나누는 근거로 유용하다. [공식 개요](https://github.com/MemTensor/HaluMem)

### MemoryAgentBench

기존 자료 재구성과 자동 생성 EventQA, MQUAKE 기반 반사실 갱신 자료를 결합한다. 최신 v4는 네 번째 축을 Selective Forgetting이라 부르지만 저장소에는 Conflict Resolution 명칭도 남아 있다.
FactConsolidation은 뒤에 온 사실을 우선하도록 지시한 뒤 최종 답을 채점한다. 저장 흔적 제거를 직접 관찰한 평가로 확대하지 않는다. [논문 §3](https://arxiv.org/html/2507.05257v4), [공식 저장소](https://github.com/HUST-AI-HYZ/MemoryAgentBench)

## 5. 현재 공식 코드의 감사 지점

이 절은 2026-11-16 열람한 main 파일의 정적 관측이다. 소스를 실행하지 않았으며 실제 오류 발생률은 측정하지 않았다. 운영 적용 시 commit·파일 hash를 별도로 고정해야 한다.

### LongMemEval — 분모와 관대한 판정

[evaluate_qa.py](https://raw.githubusercontent.com/xiaowu0162/LongMemEval/main/src/evaluation/evaluate_qa.py)

- 제출 hypothesis만 순회한다. 참조 전체의 누락·중복 ID 검사를 이 파일만으로 보장하지 않는다.
- judge 출력에 yes가 포함되면 통과시킨다. 출력 원문·엄격한 enum 파싱·파싱 실패를 별도 보존해야 한다.
- 시간 문제는 일부 ±1 오차, 갱신 문제는 최신 답과 과거 정보의 동반을 허용한다. 납기·치수·취소 상태의 엄격한 기준으로 직접 쓰지 않는다.

### LoCoMo — 영어 중심 점수와 검색 기본값

[evaluation.py](https://raw.githubusercontent.com/snap-research/locomo/main/task_eval/evaluation.py)

- 기본 QA는 영어 Porter stemming·공백 token F1이다. multi-hop은 쉼표로 나눈 정답 조각별 최고 F1의 평균이다.
- adversarial은 특정 영어 기권 문구의 포함 여부로 처리한다. 한국어 기권을 그대로 평가할 수 없다.
- context 또는 근거가 없는 경로에서 recall에 1을 넣는다. 검색 근거가 없다는 상태를 검색 성공으로 보고하지 않도록 분모를 구분한다.
- 문자열 지표·LLM judge·adversarial 제외 결과는 서로 다른 지표이므로 점수명과 포함 유형을 함께 기록한다.

### HaluMem — 갱신 라우팅과 서로 다른 precision

[evaluation.py](https://raw.githubusercontent.com/MemTensor/HaluMem/main/eval/evaluation.py)

- is_update=True여도 memories_from_system이 비면 갱신 대신 추출 평가 경로로 간다. gold 갱신 전체 수와 실제 갱신 채점 수의 차이를 확인해야 한다.
- 전체 분모와 유효 판정 분모를 모두 제공한다. valid 점수만 인용하지 않고 judge 실패를 별도 보고한다.
- 추출 F1은 전체 생성 기억 정확도가 아닌 target memory precision을 사용한다. gold에 대응하지 않는 허위 기억은 전체 기억 정확도·FMR과 함께 본다.
- 완전성 prompt는 충돌 기억이 있어도 최고 coverage를 줄 수 있다. coverage와 무모순성을 별도 축으로 유지한다. [eval_tools.py](https://raw.githubusercontent.com/MemTensor/HaluMem/main/eval/eval_tools.py)
- 세션 전체 기억을 얻지 못하는 시스템·비동기 처리 시간 미계측 등 어댑터 차이가 공식 문서에 명시돼 있다. 지원하지 않는 칸을 0이나 성공으로 간주하지 않는다. [평가 안내](https://raw.githubusercontent.com/MemTensor/HaluMem/main/eval/README.md)

### MemoryAgentBench — metric 이름과 실제 함수

[공식 metric mapping](https://github.com/HUST-AI-HYZ/MemoryAgentBench#-clarification-on-evaluation-metrics), [eval_other_utils.py](https://raw.githubusercontent.com/HUST-AI-HYZ/MemoryAgentBench/main/utils/eval_other_utils.py)

- FactConsolidation·EventQA 등의 accuracy는 substring match, 분류·DetectiveQA는 exact match, 추천은 Recall@5다. LME·요약은 LLM judge를 사용한다.
- substring 함수상 최신 정답과 옛값을 함께 출력해도 최신 문자열이 있으면 통과할 수 있다. 최신값 선택과 옛값 비노출·삭제는 다른 지표다.
- LME judge는 모델 별칭 gpt-4o와 yes 포함 파싱을 사용한다. 날짜 고정 모델·prompt·파서 판을 기록한다. [longmem_qa_evaluate.py](https://raw.githubusercontent.com/HUST-AI-HYZ/MemoryAgentBench/main/llm_based_eval/longmem_qa_evaluate.py)
- 데이터 로더가 revision=main을 사용하므로 코드만 고정해서는 데이터 판이 고정되지 않는다. [eval_data_utils.py](https://raw.githubusercontent.com/HUST-AI-HYZ/MemoryAgentBench/main/utils/eval_data_utils.py)

## 6. 한국어 적용을 위한 연구 제안

아래는 위 근거에서 도출한 제안이다. 표본 수·합격 기준·실행 순서는 M3에서 정한다.

- 간판: 고객·지점·프로젝트별 상호, 문구, 치수·단위, 납기를 구분하고 제안→승인→변경→취소 상태를 gold에 남긴다. assistant의 제안을 고객의 승인 사실로 바꾸는 사례를 별도 오저장으로 센다.
- 시간: 발언 시각, 사건의 유효 시각, 질문 기준 시각을 구분한다. 늦게 전달된 과거 정보·정정 발언은 단순한 마지막 메시지 우선 규칙과 구별한다.
- 한국어: 조사·띄어쓰기·높임말의 의미 동치는 허용하되 숫자·단위·부정·승인 주체는 엄격히 평가한다. 영어 기권 문자열을 한국어 성공 조건으로 번역 치환하는 데 그치지 않는다.
- 세계/NPC: 현 N 범위 밖이다. 향후 적용하더라도 세계 정본, NPC가 실제로 알 수 있는 사실, 손님의 주장·소문, 세계 밖 지시를 하위 출처·권한으로 분리한다. 손님 주장을 곧바로 세계 정본으로 승격하지 않는다.
- 누수: 다른 고객·프로젝트·세계의 사실 사용, 미래 세션 참조, 공개 benchmark 정답 노출을 서로 다른 위험으로 구분한다. 기권 성공은 이 격리 검증을 대체하지 못한다.
- 삭제: 현재 답의 최신성, 오래된 값의 비사용, 검색 비노출, 저장 흔적 삭제를 따로 정의한다. 검색되지 않음만으로 삭제 완료라 하지 않는다.

## 7. Judge·통계 계약에 남길 사항

- AI 검수 위임을 유지하되 데이터 작성자·검수자·judge 모델과 판을 기록한다. 데이터 품질 검수와 judge 정확도 검증은 다른 절차다.
- 생성·검색·판정 모델, prompt·출력 계약·scorer·dataset 판, 메모리 기준 상태를 고정한다. 같은 모델명이 같은 실행 조건을 뜻하지 않는다.
- 원응답, 근거 ID, raw 판정, 파싱 결과, 기권·거절·운영 실패, 재시도와 누락·중복 ID를 보존한다. unknown을 성공이나 분모 밖으로 조용히 이동하지 않는다.
- 원장 추출·갱신, 검색 근거, 최종 답변을 연결해 저장 오류·검색 실패·읽기 실패를 분리한다. judge에 주는 gold와 시스템에 주는 입력을 분리한다.
- 같은 답의 재판정은 judge 안정성·회귀 검토이며 새 표본이 아니다. 판정 수정 뒤 새 holdout 성능과 기존 답의 재판정을 구별한다.
- 문항과 반복 수 외에 독립 고객·이력·사건 family 수를 보고한다. 동일 이력을 공유하는 질문은 cluster로 다루며, bootstrap도 같은 family 묶음을 재표집한다.
- 길이 조건·갱신 전후는 같은 이력의 짝을 유지한다. 한 조건의 기권·실패로 짝이 깨지면 전체·유효·공통 표본 분모를 함께 남긴다.
- 0건 오류의 구간은 관측 설계와 표본 가정에 따른 불확실성이다. 0폭 bootstrap이나 다수의 상관 문항으로 운영 오류 확률 0을 주장하지 않는다.

## 8. 미확인 범위

네 벤치마크의 모든 adapter·issue·커밋 이력을 전수 감사하지 않았다. 현재 model alias의 실제 제공 모델, 리더보드 제출의 입력 완전성, 한국어 judge 일치율도 미확인이다.
한국어 간판·세계/NPC의 직접 성능, 사용자 간 격리, 삭제 완료는 이번 외부 조사로 입증되지 않았다. MINJA 보안 연구는 별도 담당 자료와 결합한다.
