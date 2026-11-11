# 제한된 한국어 realizer의 제어·학습 계획

조사 기준: **2026-11-11 KST**. 아래는 1차 문헌, 공개 모델 설정, 로컬 공개 소스에 근거한 **설계·실험 제안**이다. 학습·증류·운영 변경·추가 teacher API 호출을 실행하지 않았다. 공개 모델 크기·라이선스는 [research-models.md](research-models.md), 기존 실험 계약은 [PLAN-2026-11-11.md](PLAN-2026-11-11.md)를 함께 본다.

## 적용 범위와 실제 교체 경계

작은 모델의 책임은 **확정된 사실을 주어진 말투로 한두 문장에 표현하는 일**로 한정한다. 검색, 근거 선택, 행동 결정, 권한 판정, 사실 보충, 장기 대화 기억을 이 모델에 맡기지 않는다. 의미계획이 틀렸다면 문장화 모델이 고쳐 주리라고 기대할 수 없다.

로컬 `/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI`의 HEAD `03a425921b677d4dfd14f464ba5ffaea01f0b6d5`에서 관련 코드를 확인했다. 운영 설정과 현재 실행 중인 모델은 확인하지 않았다.

| 소스에서 확인한 사실 | 코드 근거 | 교체 설계에 미치는 영향 |
|---|---|---|
| decode 기본값은 `gpt-4o-mini`, timeout 30,000ms, max_tokens 1024, temperature 0.3 | [decode.ts:104](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/core/decode.ts:104) | 이 값은 소스 기본값이다. unit/persona·호출 인자로 override되므로 운영 모델 확정값이 아니다. |
| `buildMessages` 입력은 question, `EnrichedItem[]`, history, digest, toolContext, excludePlaces, recall, serviceBlock | [decode.ts:265](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/core/decode.ts:265), [EnrichedItem:54](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/core/reasoning/callReasoning.ts:54) | 현재는 typed skeleton이 아니다. mini가 근거 해석과 내용 선택도 담당하므로 함수 전체를 작은 realizer로 바꾸면 범위를 초과한다. |
| 호출은 `callDecodeStream(messages,onToken,modelOverride,meta)` → `{full,model,ok,error?}` | [decode.ts:448](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/core/decode.ts:448), [chat.ts:1253](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1253) | 확정 fact plan을 만드는 어댑터와 지원 과제 라우터를 이 앞에 두는 것이 제안 경계다. |
| `onToken`은 곧바로 SSE 송출한다. 이후 K0·숫자·ungrounded 검사는 관찰용 | [송출:1253](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1253), [K0:1266](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1266), [숫자:1288](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1288), [ungrounded:1311](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1311) | 생성 후 검사로 출력 차단을 하려면 문장 단위로 내부 buffer에 완성한 뒤 검사·송출해야 한다. 이미 보낸 토큰은 되돌릴 수 없다. 이는 제안이며 현재 구현이 아니다. |
| timeout/unreachable 시 오류 표기 문장을 반환한다 | [decode.ts:482](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/core/decode.ts:482), [chat.ts:1316](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1316) | 통신 오류 표시는 사실 보존 template fallback과 다르다. 두 유형을 메트릭에서 분리한다. |
| 기존 deterministic persona 경로는 발화표가 없으면 빈 답으로 닫는다 | [chat.ts:1186](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/router/v1_0/chat.ts:1186) | 이 경로를 임의의 신경망 생성으로 바꾸는 것은 이번 좁은 교체 범위에 포함하지 않는다. |

현재 코드는 [callReasoning.ts:35](/home/gino/WorkArea/Elda-AI-Agent/reference/GanpanAI/elda-orchestrator/src/core/reasoning/callReasoning.ts:35)에 사용자 지시를 근거로 조사 stripping/굴절형 깎기를 금지한다고 명시한다. 아래 delexicalization은 **알려진 구조 슬롯의 정확한 span을 대체하는 생성측 처리**다. 검색 원문·사용자 입력의 어미를 추측해서 떼는 제안이 아니다. `.env`, key/자격증명 파일, `CLAUDE.md`는 읽지 않았다.

## 권장 입출력과 처리 순서

기존 fixture의 `source`, `actor`, `predicate`, `protectedSlots`, `style`를 출발점으로 삼는다. 실제 연결 시에는 predicate에 붙는 역할과 사실의 출처를 명시해야 한다. 아래는 **향후 어댑터 계약 예시**이며 현재 fixture schema를 변경한 것이 아니다.

```text
plan_id: stable id
propositions: [{id, predicate, actor_id, object_id, owner_id,
               time_id, location_id, polarity, tense, status, modality}]
surface_slots: [{id, literal, allowed_forms, optional_spoken_form}]
style_id: friendly | blunt | historical
policy: single_sentence, no_new_proposition, no_new_entity,
        preserve_scope, preserve_role, preserve_uncertainty
```

`owner`, 부정 범위, 요청/완료 구분을 생략하면 모델이 자연스러움을 위해 빈칸을 추측하게 된다. `source`와 typed plan이 서로 충돌하는 입력은 학습·운영 전에 reject한다. 말투는 어휘·종결 형태의 조건이고 왕/신하 관계·감정·약속·확신도를 추가하는 권한이 아니다.

제안 파이프라인은 **plan 검증 → 알려진 보호 span 치환 → 작은 seq2seq → placeholder/의미 검사 → 원문 슬롯 복원·조사 결합 → 최종 검사 → 송출**이다. 유효한 plan에서 생성이 실패하면 동일 plan의 승인된 틀 문장으로 대체한다. plan 자체가 잘못됐거나 지원하지 않는 경우에는 기존 경로/기존 실패 정책으로 돌리고, 추측한 사실로 template을 채우지 않는다.

## 복사·제약·검사의 선택

| 방법 | 1차 연구에서 확인되는 역할 | 좁은 한국어 모델에 적용할 제안 | 보장하지 못하는 것 / 비용 |
|---|---|---|---|
| Pointer-generator | source attention의 복사 분포와 vocabulary 생성 분포를 혼합한다. coverage는 반복 억제에 사용 | raw 이름·코드·장소를 직접 출력해야 하는 별도 실험군에서 copy gate를 둔다. 학습 데이터에는 복사 위치의 명확한 alignment를 보관 | 값을 복사해도 actor/owner를 뒤집거나 부정을 바꿀 수 있다. custom head·extended vocab·ONNX export 구현 부담이 생김. |
| Delexicalization | 희귀 slot 값을 placeholder로 바꾼 뒤 생성 후 복원하는 고전 NLG 경로 | 첫 학생 모델은 `<ACTOR_0>`, `<OBJECT_0>`, `<COUNT_0>` 같은 **단일 special token**을 쓴다. raw literal은 모델 밖 map에 보존 | placeholder 포함만으로 역할·술어가 보존되지는 않는다. 반복값/동명이인도 slot ID로 구분해야 함. |
| Lexically constrained decoding | GBS는 지정 단어/구의 출현을 만족시키도록 beam 탐색을 확장. DBA는 제약 수에 대한 탐색 비용을 개선 | 필수 placeholder가 나오기 전 EOS 금지, 허용하지 않은 placeholder 생성 금지, 필요한 multiplicity 검사. 우선 greedy+검사와 beam 2/4 제약군을 비교 | 단어 존재는 의미역·논리 관계 보장이 아니다. 전체 탐색이 공짜가 되지 않으며 fixed vocabulary logits 뒤의 host loop 구현도 필요. 길이/시간 한도에서 미충족하면 fallback. |
| 의미 재구성 / reranker | TGen은 입력 MR을 추정하는 reranker로 부적절한 후보를 감점 | 제한된 도메인에서 출력→`predicate/role/polarity/tense/modality` 재구성기를 별도 검증한다. 입력 계획과 exact-field 비교 | 별도 신경망 검사기도 오판한다. 같은 teacher 편향 공유 가능. NLI 점수 하나로 사실 보존 승인하지 않음. |
| 승인된 template fallback | 결정론적 표면 생성과 신경망을 비교하는 연구가 존재 | 예측 실패·timeout·slot mismatch·검증 미충족 때 plan과 style에 맞는 유한 template 사용. raw 후보와 실패 이유는 별도로 보존 | fallback 통과를 neural 성공으로 세지 않는다. 지원하지 않는 복잡한 의미에 억지 template을 적용하지 않음. |

근거: [Pointer-generator, See et al. 2017](https://aclanthology.org/P17-1099/), [TGen, Dušek & Jurčíček 2016](https://aclanthology.org/P16-2008/), [GBS, Hokamp & Liu 2017](https://aclanthology.org/P17-1141/), [DBA, Post & Vilar 2018](https://aclanthology.org/N18-1119/), [E2E neural/template 비교, Puzikov & Gurevych 2018](https://aclanthology.org/W18-6557.pdf).

**초기 선택은 placeholder + tied-vocabulary seq2seq + 검사 + template fallback이다.** Pointer head를 먼저 추가할 필요는 없다. raw 슬롯 복원으로 이름·ID의 생성 부담을 줄인 뒤, 문장이 지나치게 정형화되거나 긴 열린 어휘 슬롯에서 부족할 때 pointer 모델을 비교한다. 이는 구현 복잡도와 검증 비용에 근거한 제안이며 품질 실측 결론은 아니다.

고정 prefix나 강제 단어 목록에 `안` 한 글자를 넣는 방식은 부정을 보장하지 않는다. 예컨대 행동 자체를 긍정으로 바꾸고 뒤에 별개의 부정 감정을 붙일 수 있다. 부정·시제·요청/완료를 보장하려면 허용된 절 구조와 술어 realization을 제한하거나, 검증 가능한 지원 범위로 한정해야 한다.

## 한국어 조사와 보호 값 복원

생성측 조사 선택은 두 문제로 나눈다. **어떤 조사인가**는 의미역/문장 구조의 문제이고, **이형태가 무엇인가**는 뒤따르는 발음 환경의 문제다. 받침 함수만으로 주어/목적어/소유자를 판정할 수 없다.

제안 출력은 `<ACTOR_0><JOSA_TOPIC>` 같은 명시적 marker 또는 검증된 clause template이다. 알려진 슬롯의 literal을 복원한 뒤 `TOPIC→은/는`, `SUBJECT→이/가`, `OBJECT→을/를`, `DIRECTION→으로/로`를 선택한다. 주어를 화제로 바꾸는 것은 담화 효과가 있으므로 지원 grammar/평가 기준에서 허용 여부를 정한다.

NFC로 해석한 마지막 문자가 현대 한글 완성형 U+AC00–U+D7A3일 때 `TIndex=(codepoint−0xAC00)%28`로 종성 유무를 계산할 수 있다. `TIndex=0`은 종성 없음, 8은 ㄹ이다. `으로/로`는 받침 없음 또는 ㄹ 받침일 때 `로`, 그 외 받침은 `으로`가 기본이다. Unicode 식은 문자 분해 규칙이고 문법 선택기는 아니다. [Unicode Hangul 분해 규정](https://www.unicode.org/versions/Unicode16.0.0/UnicodeStandard-16.0.pdf), [국립국어원 으로/로 문법 정보](https://www.korean.go.kr/front/onlineQna/onlineQnaView.do?mn_id=216&qna_seq=314593), [국립국어원 은/는 교수 자료](https://www.korean.go.kr/common/download.do?c_file_name=659df6e4-5eff-4d52-bad9-44e413adbfcf_0.pdf&file_path=reportData&o_file_name=%ED%95%9C%EA%B5%AD%EC%96%B4%EA%B5%90%EC%9C%A1+%EB%AC%B8%EB%B2%95%C2%B7%ED%91%9C%ED%98%84+%EB%82%B4%EC%9A%A9+%EA%B0%9C%EB%B0%9C+%EC%97%B0%EA%B5%AC%282%EB%8B%A8%EA%B3%84%29.pdf)

Latin 코드·약어·숫자·emoji·괄호가 마지막인 이름은 코드포인트만으로 실제 읽기를 결정할 수 없다. 숫자의 단위에 따라 읽기도 달라진다. 이 경우 상위 데이터가 승인한 `spoken_form`/조사형을 주거나, 조사가 모호하지 않은 승인 template으로 fallback한다. 끝의 punctuation을 임의로 제거하거나 숫자를 다른 표기로 바꿔 보호 값의 identity를 훼손하지 않는다. Unicode 정규화는 비교용 사본에 적용하고 raw literal 원문을 보존한다. [Unicode 정규화 규정](https://unicode.org/reports/tr15/)

## 환각·누락·의미 검증

검사는 다음 층위를 별도 결과로 남긴다.

1. **구조**: JSON/ID/입출력 매칭, placeholder의 집합·횟수, 길이, 지원 style.
2. **어휘**: raw 이름·숫자·단위·시간·코드의 허용 표기, 새로운 보호 값·수량, 복원 전후 일치.
3. **명제**: actor/object/owner, 술어, 시제·상태, 부정 범위, 요청/금지/진술, 추측·전언·확신도, 새 사실/인과/감정/관계.
4. **표현**: style 적합성, 문법·조사, 자연스러움, 중복, 같은 뜻의 실제 표현 다양성.

현재 `slot-check.py`는 제한된 어휘·형식 검사이고 완전한 의미 검사기가 아니다. `lexicalPass`를 의미 승인으로 승격하지 않는다. 별도 의미 검증기가 준비되지 않은 상태를 production semantic gate 완료로 쓰지 않는다. [현재 검사 계약](SLOT-CHECK.md)

학습 표적의 누락·추가 정보도 정리해야 한다. E2E 연구는 데이터 정제가 slot-error rate를 크게 낮추며 누락이 흔한 오류임을 보였다. 따라서 “큰 teacher가 만들었으니 정답”이라고 수용하지 않고 **source-plan-target 일치**를 먼저 심사한다. [Semantic Noise Matters, Dušek et al. 2019](https://aclanthology.org/W19-8652/)

문장 임베딩 유사도나 BLEU/ROUGE가 높아도 수치·부정 하나의 반전을 놓칠 수 있다. 요약 faithfulness 연구의 NLI 상관 결과는 참고가 되지만 한국어 좁은 도메인의 확정 판정기로 검증된 것은 아니다. 사람의 blind 검토와 적대적 최소쌍을 기준으로 보조 검사기의 false accept/reject를 먼저 잰다. [Maynez et al. 2020](https://aclanthology.org/2020.acl-main.173/)

## 10–50M 학생 구조 제안

아래는 **새로 학습할 경우의 계산 설계**이며 공개 pretrained checkpoint의 품질을 가진 모델이 아니다. T5형 encoder-decoder, ReLU FFN, encoder/decoder 각각 4층, `d_kv=64`, relative buckets 32, 입력과 LM head tied를 가정했다. V에는 special/placeholder token도 포함한다. 정확한 산식은 [모델 조사 계산식](research-models.md)을 따른다.

| 구조 | d / FF / heads / V | 계산된 고유 파라미터 | 공유 embedding 비중 | int8 가중치만 하한적 추정 |
|---|---|---:|---:|---:|
| 작은 기준 | 256 / 1024 / 4 / 16,000 | **11,441,920** | 4,096,000 / 35.80% | 11.442 MB |
| 우선 학생 | 384 / 1536 / 6 / 16,000 | **22,667,904** | 6,144,000 / 27.10% | 22.668 MB |
| 용량 비교 | 512 / 2048 / 8 / 16,000 | **37,563,904** | 8,192,000 / 21.81% | 37.564 MB |
| 큰 어휘 비교 | 512 / 2048 / 8 / 32,000 | **45,755,904** | 16,384,000 / 35.81% | 45.756 MB |

16k를 8k로 줄이면 d=384에서 3,072,000 파라미터를 아끼지만 한국어가 더 긴 token 열로 쪼개져 decoder step 수가 늘 수 있다. 64k×512 embedding 하나는 32,768,000개이고, 출력층을 untie하면 어휘 행렬 비용이 한 번 더 생긴다. **작은 P와 짧은 실제 지연은 같은 목적함수가 아니다.** 각 tokenizer의 한국어 1문장 token 수 p50/p95, unknown/roundtrip, 조사 경계, ID 보존을 함께 비교한다.

한국어 학습 split에만 SentencePiece Unigram/BPE 8k·16k·32k를 만들고, 보호 슬롯은 special token으로 치환한다. byte fallback은 미등록 문자 처리를 돕지만 token 길이 증가를 측정해야 한다. 순수 byte 모델은 embedding 비용을 줄일 수 있으나 긴 byte sequence 비용이 있으며 공개 ByT5의 품질·속도가 이 크기 학생에 그대로 이전되지 않는다. [SentencePiece 원논문](https://aclanthology.org/D18-2012/), [ByT5 원논문](https://aclanthology.org/2022.tacl-1.17/)

pretrained 모델의 vocabulary만 잘라 크기를 줄이면 기존 token ID/embedding/출력 분포가 바뀐다. remap과 후속 학습·평가가 필요한 별도 변형이다. int8는 저장 dtype을 바꾸는 방법이고 파라미터 개수를 줄이지 않는다. KE-T5는 비교 교사/큰 기준점으로 사용할 수 있지만, 40.55M Cosmoquester는 배포 라이선스 미확정 상태를 해결하지 않고 상업 학생의 출발점으로 확정하지 않는다.

## 데이터와 학습 단계: 실행하지 않은 계획

**120행은 20개 의미 골격 × 3말투 × 2변형의 파일럿이다.** 서로 다른 120개 의미 사례가 아니며, 학습에 충분하다는 근거가 없다. 이미 프롬프트·검사 설계에 이용한 자료이므로 이후의 독립 test로 취급하지 않는다. 이번 teacher 요청은 종료됐으며 아래 확장안은 추가 호출 승인이 아니다.

| 단계 | 제안 규모와 목적 | 데이터 조건 |
|---|---|---|
| 현재 파일럿 | 계획된 120행: 계약·실패 유형·말투 기준 점검 | 실제 생성/누락/실패를 그대로 집계. raw, 사람이 작성한 기준, fallback을 구분. |
| 데이터/학습 파이프라인 점검 | **1k–5k** 검수 쌍 | 다양한 술어와 역할, 최소쌍, 조사/코드 경계 확인. 성능 보장 규모가 아님. |
| 좁은 도메인 첫 learning curve | **20k → 100k** 검수 쌍 | 단순 재서술 반복이 아니라 새로운 의미 조합·문장 구조를 늘림. 11M/23M/38M 학생 비교. |
| 확장 조건부 단계 | 오류 유형이 데이터 부족을 가리킬 때 **최대 500k** 후보 쌍 검토 | 검수·오류 수렴 없이 양만 늘리지 않음. 이 숫자는 경험적 결과가 아닌 예산 탐색안. |

표적은 수동 검수 문장, 통제된 template 다양화, 허가된 도메인 문장, 검수한 teacher paraphrase를 섞는다. 각 행에 `source_group`, `skeleton_family`, slot ID, style, teacher/version, 생성 설정, 검수 상태·수정 이유를 기록한다. 틀린 원문을 조용히 재생성해 삭제하지 않는다. 잘못된 출력은 verifier의 negative/minimal-pair 자료로 분리하고 생성기의 정답 표적으로 넣지 않는다.

분할은 예시 문자열 random split보다 먼저 **의미 골격 family 단위**로 한다. 같은 골격의 말투 3개·표현 2개·이름 치환·teacher paraphrase는 같은 split에 둔다. train/dev/test 기본 비율 80/10/10은 계획값이고, 별도의 entity-held-out, predicate-composition-held-out, template-family-held-out 시험을 둔다. tokenizer 학습은 train만 사용한다. delexicalized fingerprint와 n-gram/정규화 중복 검사를 함께 해 숫자·이름만 바꾼 누수를 막는다.

학습은 다음 순서를 제안한다.

1. 승인 template와 공개 pretrained 기준 모델의 task SFT를 비교해 필요한 변화의 범위를 확인한다. pretrained 기준은 라이선스가 확인된 것만 선택한다.
2. 23M 학생은 teacher의 **검수한 텍스트 출력**에 token cross-entropy SFT한다. 사람이 승인한 표적·identity-preserving 예시를 섞는다. 같은 source의 반말/존댓말/사극 출력을 style token으로 구분한다.
3. teacher logits를 얻지 못하는 현재 자료는 **sequence-level distillation 성격의 supervised learning**이다. soft-label/logit KL distillation을 했다고 부르지 않는다. 서로 다른 tokenizer면 token별 logits도 직접 정렬되지 않는다. sequence-level KD가 greedy decoding에 도움을 준 NMT 연구는 있지만 한국어 말투에 대한 동일 효과는 미측정이다. [Kim & Rush 2016](https://aclanthology.org/D16-1139/)
4. 역할·부정·시제의 최소쌍을 넣고, raw text 학생과 placeholder 학생을 분리 비교한다. train에서 구조 토큰 순서를 무작위화할지는 실제 입력의 정규 직렬화 정책과 맞춘다.
5. validation 의미 오류/slot 오류/말투를 함께 보고 early stop한다. seed 3개 비교는 예산이 허용할 때 수행하며 결과가 좋은 seed만 숨겨 선택하지 않는다. 마지막에 int8 export 후 FP32 대비 의미·말투 회귀를 다시 검사한다.

Learning rate, batch, epoch 수는 미측정 탐색값으로 남긴다. 처음에는 짧은 입력/출력 상한과 length bucketing, gradient accumulation을 사용해 지원 GPU에 맞추고, dev 결과로 작은 탐색을 한다. 처음부터 전체 한국어 언어모델을 재사전학습하는 비용과 좁은 도메인 SFT 비용을 혼동하지 않는다.

## 평가와 통과 판단 계획

검수자가 모델명·크기·teacher 여부를 보지 않는 평가를 하고, 의미와 style을 별도 판단한다. 서로 다른 두 AI 검토는 오류 탐색용 보조 자료이며 사람 검토의 대체나 독립적인 확률 표본으로 계산하지 않는다.

| 축 | 기록할 값 |
|---|---|
| 의미 보존 | 문장 단위 exact-plan 유지율; missing/added/wrong slot; role·숫자·부정·시제·양태별 오류; 새 명제와 확신도 변화 |
| 표현 | style별 적합률, 한국어 자연스러움 점수, 조사 오류, 중복률, 사실을 바꾸지 않은 변형률 |
| 검사기 | 고정 adversarial set의 false accept/false reject; 어휘 통과인데 의미 실패한 비율 |
| 운영 | raw neural 의미 성공, lexical pass, fallback 비율, timeout, 최종 출력을 각각 분리; 지원하지 않은 입력의 기존 경로 비율 |
| 비용 | 동일 CPU/스레드·출력 길이의 p50/p95, 전체 bundle bytes, peak RSS, tokenizer/검사/fallback 지연 |

BLEU/chrF와 teacher 문장 일치율은 보조값이다. 서로 다른 자연스러운 표현을 하나의 teacher 문자열로만 채점하지 않는다. 숫자/ID/소유자/부정/요청→완료 오류는 별도 치명 오류로 집계한다. 최종 deployment 기준은 대표 test와 adversarial test에서 먼저 수치로 합의할 계획이며, 여기서 달성했다고 선언할 수 없다.

작은 파일럿의 0건 실패도 매우 낮은 오류율의 증명이 아니다. 완전히 독립인 n개 예에서 0건 실패하더라도 단측 95% binomial 상한은 `1−0.05^(1/n)`이다. n=120이면 약 2.47%이고, 실제 파일럿은 20개 골격에 묶여 있어 120개 독립 시행 가정부터 성립하지 않는다. 그룹별 평가·오류 신뢰구간을 함께 기록한다.

## GPU 시간·비용: 미측정 가정과 계산식

**어떤 GPU에서도 학습 시간을 측정하지 않았다.** 현재 CPU inference 벤치마크를 GPU 학습 처리량으로 환산하지 않는다. 초기 장비 후보는 단일 16–24GB GPU이나, 실제 수용 batch/sequence와 optimizer memory를 확인해야 한다. 모델 파라미터 상태만 대략 12–18 bytes/P로 잡아도 38M에서 약 0.46–0.68GB이며 activation, logits, padding, optimizer 구현, checkpointing, 라이브러리 workspace는 별도다. 이 계산은 학습 메모리 전체 또는 적합성 보장이 아니다.

```text
N = train pairs; E = epochs; B = effective global batch
steps ≈ E * ceil(N/B)
processed_tokens = E * Σ(batch 내 실제 padded encoder/decoder tokens)
train_hours = processed_tokens / measured_tokens_per_second / 3600
total_hours = train_hours + validation + checkpoint + export + fixed overhead
GPU_cost = Σ(run별 billed_gpu_hours * 당시 확인한 시간당 요금)
total_cost = GPU_cost + storage + teacher_generation + human_review
```

예시 계산은 N=100,000, E=5, encoder 128·decoder 64 **고정 padding**, B=128을 가정한다. 약 3,910 optimizer steps와 96M 처리 tokens다. 처리량을 **가정상** 1k/5k/10k tokens/s로 넣으면 순수 학습 26.67/5.33/2.67시간, 검증·저장 여유 20%를 임의로 더하면 32.0/6.4/3.2시간이다. **실제 장비 예측값이 아니다.** GPU 종류·정밀도·padding·attention 구현·data loader가 정해진 뒤 짧은 training benchmark를 별도 승인 범위에서 측정해야 한다.

시간당 가격은 조회하거나 확정하지 않았으므로 금액 견적을 쓰지 않는다. 가령 `h=6.4`, `rate=r`이면 한 run의 비용은 `6.4r`이고, 구조 3개×seed 3개라면 같은 처리량 가정에서 `57.6r`이다. 데이터 규모별 재실험·실패 run·teacher 검수 비용은 추가다. 현 조사에서 학습이나 추가 데이터 생산을 실행한 것은 없다.
