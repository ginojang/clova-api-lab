# 한국어 tiny surface realizer: 공개 모델·선행연구 근거

조사일: **2026-11-11 KST**. 공개 HTTP 메타데이터 확인 기준 시각: **2026-11-11 14:18 UTC / 23:18 KST**. 이후 같은 조사 세션에서 추가 후보와 라이선스를 확인했다. 이 문서는 모델을 학습하거나 가중치를 내려받아 실행한 결과가 아니다. 모델 카드·설정·토크나이저 JSON·파일 메타데이터와 논문을 조사했다. 로컬 CPU/ONNX 실측은 별도 벤치마크 결과를 우선한다.

## 판단

**10–50M 신경망으로 제한된 구조 입력을 문장화하는 접근은 선행근거가 있다. 그러나 이번 조사에서 상업 배포 조건까지 명확한 10–50M 공개 한국어 skeleton→말투 realizer 완제품은 확인하지 못했다.** 영어 WebNLG의 10.6M LSTM 연구, 한국어 사전학습 `cosmoquester/bart-ko-small`의 설정상 40.55M 규모는 각각 다른 부분을 뒷받침한다. 두 결과를 합쳐 한국어 말투 제어 품질이 검증됐다고 해석하면 안 된다.

공개 자료 조사 단계에서 제안한 표준 T5 비교 후보는 다음 두 개였다. 둘 다 목표 50M을 넘지만 100M 이하의 비교군이다. **최종 실제 CPU/ONNX 실측 대상으로는 KE-T5와 Cosmoquester BART small을 선택했다.** KE-T5는 공개 라이선스·표준 구조 기준점, Cosmoquester는 40.55M 목표 규모의 대조군이며 가중치 라이선스는 미확정이다. 아래 pko-T5의 우선순위는 초기 자료 조사 제안이며 실제 실행 모델 목록이 아니다. 실제 실행 결과는 [runtime 조사](research-runtime.md)와 해당 벤치마크 산출물을 확인한다.

1. **`KETI-AIR/ke-t5-small` → 현재 canonical ID `KETI-NLP/ke-t5-small`**: 76,895,616 파라미터. 공개 safetensors, 표준 T5 구조, 한국어·영어 사전학습, Apache-2.0 표시가 있어 첫 실행 기준점으로 적합하다. 구조·한국어 토크나이징·실행 비용을 검증한다.
2. **`paust/pko-t5-small`**: 설정으로 계산하면 95,628,672 파라미터. 한국어 BBPE의 어휘 처리와 untied 출력층 비용을 비교할 수 있다. 카드의 77M 표기는 그대로 인용하지 않는다. HF의 CC-BY-4.0 표시와 저자 저장소의 MIT 표기가 충돌하므로 배포 조건은 별도 미확정 항목으로 남긴다.

두 후보 모두 **사전학습 체크포인트이며 realizer로 미세조정된 모델이 아니다.** 미세조정 없이 skeleton을 그대로 넣은 출력은 실행 확인 자료다. 입력 사실 보존·한국어 조사·말투 준수 성능을 대표하지 않는다. [KE-T5 카드](https://huggingface.co/KETI-NLP/ke-t5-small), [pko-T5 카드](https://huggingface.co/paust/pko-t5-small)

## 공개 한국어 후보의 크기

`M`은 1,000,000개, `MB`는 1,000,000 bytes다. 아래 int8 열은 **모든 고유 파라미터를 정확히 1 byte로 저장한다는 가중치만의 계산값**이다. quantization scale·zero point·FP32 잔류 텐서·ONNX 그래프·중복된 embedding·토크나이저·런타임·KV cache는 제외한다. 실제 배포 파일 크기로 읽으면 안 된다.

| 정확한 공개 ID | 파라미터 수와 근거 | 주요 구조 / 어휘 행 수 | 고유 공유 입력 embedding / 전체 비율 | int8 가중치만 추정 | 공개 원본 가중치 bytes |
|---|---:|---|---:|---:|---:|
| `KETI-NLP/ke-t5-small` (`KETI-AIR/ke-t5-small` alias) | **76,895,616**: HF safetensors 메타데이터와 설정 계산 일치 | T5, encoder/decoder 8/8, d=512, FF=1024 gated-GELU, attention inner=6×64; V=64,128 | 32,833,536 / **42.70%**; encoder·decoder·LM head tied | 76.896 MB (73.333 MiB) | `model.safetensors` **307,604,810** |
| `KETI-NLP/ke-t5-small-ko` (`KETI-AIR/ke-t5-small-ko` alias) | **76,895,616**: HF safetensors 메타데이터 | 동일 구조, 한국어 사전학습 변형; V=64,128 | 32,833,536 / **42.70%** | 76.896 MB | `model.safetensors` **307,604,810** |
| `paust/pko-t5-small` | **95,628,672**: 설정 계산. 카드의 **77M 주장과 불일치**, 로컬 가중치 로드로 재확인할 항목 | T5, 8/8, d=512, FF=1024 gated-GELU, inner=6×64; V=50,358; `tie_word_embeddings=false` | 입력 25,783,296 / **26.96%**; 별도 LM head도 같은 수. 합계 어휘 가중치 **53.92%** | 95.629 MB (91.199 MiB) | `pytorch_model.bin` **382,575,813** |
| `gogamza/kobart-base-v2` | **123,859,968**: HF safetensors 메타데이터. 저자 표기는 124M | BART, 6/6, d=768, FF=3072; V=30,000; checkpoint architecture는 `BartModel` | 23,040,000 / **18.60%**; encoder·decoder 공유. LM head를 붙일 때 tied 설정 확인 | 123.860 MB (118.122 MiB) | `model.safetensors` **495,468,126** |
| `cosmoquester/bart-ko-small` | **40,554,496**: 설정 계산, 가중치 미실행 | BART, 3/3, d=512, FF=2048, V=32,000; learned position 2048+2, `use_cache=false` | 16,384,000 / **40.40%**, 표준 tied BART 가정 | 40.554 MB (38.676 MiB) | `pytorch_model.bin` **162,393,589** |
| `wisenut-nlp-team/KoT5-small` | **60,506,624**: 설정 계산. 저자 표기는 60M | T5, 6/6, d=512, FF=2048 ReLU, inner=8×64; V=32,128 | 16,449,536 / **27.19%**, tied | 60.507 MB (57.704 MiB) | `pytorch_model.bin` **242,069,785** |

직접 확인한 1차 근거:

- KE-T5: [고정 revision 설정](https://huggingface.co/KETI-NLP/ke-t5-small/blob/c99e8447b82d036fbfb75dcec33fb60fdf94e189/config.json), [HF 파일·파라미터 API](https://huggingface.co/api/models/KETI-NLP/ke-t5-small?blobs=true), [한국어 전용 API](https://huggingface.co/api/models/KETI-NLP/ke-t5-small-ko?blobs=true).
- pko-T5: [고정 revision 설정](https://huggingface.co/paust/pko-t5-small/blob/91c8f3b9a762807daeb344129012593934a63f52/config.json), [HF 파일 API](https://huggingface.co/api/models/paust/pko-t5-small?blobs=true).
- KoBART: [고정 revision 설정](https://huggingface.co/gogamza/kobart-base-v2/blob/f5899cc556216353e23ee36b66fad52b902066c5/config.json), [HF 파일·파라미터 API](https://huggingface.co/api/models/gogamza/kobart-base-v2?blobs=true), [원저자 모델 설명](https://github.com/SKT-AI/KoBART).
- Cosmoquester: [고정 revision 설정](https://huggingface.co/cosmoquester/bart-ko-small/blob/32c6ec5844197a774d6460e7fc83812af9dc24e3/config.json), [HF 파일 API](https://huggingface.co/api/models/cosmoquester/bart-ko-small?blobs=true).
- Wisenut: [고정 revision 설정](https://huggingface.co/wisenut-nlp-team/KoT5-small/blob/a432b8071b4298598c1aca14f3c990db45867bbb/config.json), [HF 파일 API](https://huggingface.co/api/models/wisenut-nlp-team/KoT5-small?blobs=true).

API의 `safetensors.total`은 서버가 공개한 저장 텐서 메타데이터다. 연구자가 메모리에 모델을 올려 `sum(p.numel())`로 실측한 값과 구분한다. `.bin` byte 수를 단순히 4로 나눠 파라미터 수를 만들지 않았다. 메타데이터가 없는 후보의 수치는 아래 구조 계산값이다.

## 토크나이저와 vocabulary 비용

| 모델 | 확인된 토크나이저 | 입력/출력 embedding 공유의 해석 | 한국어 검증 범위 |
|---|---|---|---|
| KE-T5 / KE-T5-ko | 저자는 SentencePiece 기본 subword 64,000개라고 설명한다. tokenizer 설정 `extra_ids=100`; 모델 행 수는 64,128이다. | 큰 어휘 하나가 32.83M. 층만 줄여도 이 비용은 남는다. encoder/decoder 입력과 출력이 tied이면 한 번 센다. | 한국어 사전학습 및 저자 downstream 연구 존재. 현재 체크포인트의 skeleton/style 성능은 미검증. |
| pko-T5 | 저자 설명은 byte-level BPE. `tokenizer.json` BPE vocab **50,258**, added-token 항목 102개, 최대 ID 50,357 → 모델 V=50,358. 중복 ID인 기존 special token은 다시 세지 않는다. | encoder/decoder 입력만 공유하고 출력은 독립이므로 어휘 관련 두 행렬이 총 51.57M. 작은 vocabulary인데도 KE-T5보다 전체 모델이 커진 이유다. | 카드의 KLUE 결과는 **미세조정한** 모델의 NLU 평가. zero-shot realizer 근거가 아니다. |
| KoBART v2 | Character BPE 30,000. JSON의 added token 229개는 ID 0–228에 이미 포함되어 있다. | 공유 token embedding 23.04M. 위치 embedding은 별도다. | 원저자 한국어 NLU/요약 예시 존재. 이 base-v2의 말투 realizer 품질은 미검증. |
| Cosmoquester BART small | 공개 `tokenizer.json` model type **Unigram**, vocab 32,000. | embedding 16.38M으로 전체의 40.40%. | 저자 downstream 표는 NSMC accuracy 0.8721 등 분류/유사도. skeleton 문장화 평가 없음. |
| Wisenut KoT5 small | HF 설정은 `T5Tokenizer`, extra IDs 100, 모델 V=32,128. | embedding 16.45M. | 원저자 한국어 요약 ROUGE-F1 50.79 / 34.25 / 42.40를 보고하지만 task-specific 평가이며 상업 조건도 제약됨. |

근거: [KE-T5 vocabulary 설명](https://github.com/AIRC-KETI/ke-t5), [KE-T5 tokenizer 설정](https://huggingface.co/KETI-NLP/ke-t5-small/blob/c99e8447b82d036fbfb75dcec33fb60fdf94e189/tokenizer_config.json), [pko tokenizer JSON](https://huggingface.co/paust/pko-t5-small/blob/91c8f3b9a762807daeb344129012593934a63f52/tokenizer.json), [KoBART tokenizer JSON](https://huggingface.co/gogamza/kobart-base-v2/blob/f5899cc556216353e23ee36b66fad52b902066c5/tokenizer.json), [Cosmoquester tokenizer JSON](https://huggingface.co/cosmoquester/bart-ko-small/blob/32c6ec5844197a774d6460e7fc83812af9dc24e3/tokenizer.json), [Cosmoquester 카드](https://huggingface.co/cosmoquester/bart-ko-small), [Wisenut 공식 평가](https://github.com/wisenut-research/KoT5).

### 재현 가능한 계산식

T5에서 `D=d_model`, `F=d_ff`, `A=num_heads*d_kv`, encoder/decoder 층 수를 `Le,Ld`, relative attention buckets/head 수를 `B,H`라 한다. bias 없는 표준 T5, encoder와 decoder 각각 첫 self-attention의 relative bias, 최종 RMSNorm을 센다. `G=3`은 gated-GELU, `G=2`는 ReLU FFN이다.

```text
encoder = Le * (4*D*A + G*D*F + 2*D)
decoder = Ld * (8*D*A + G*D*F + 3*D)
core    = encoder + decoder + 2*D + 2*B*H
total   = core + V*D                  # tied LM head
total   = core + 2*V*D                # untied LM head, shared input embedding
```

KE-T5와 pko-T5의 `core=44,062,080`. 각각 `core + 64,128*512 = 76,895,616`, `core + 2*50,358*512 = 95,628,672`다. 실제 config의 `d_kv`를 사용해야 하며 모델 카드의 아키텍처 표만으로 계산하면 안 된다. 구현 기준: [Transformers T5 구현](https://github.com/huggingface/transformers/blob/v4.18.0/src/transformers/models/t5/modeling_t5.py), [PretrainedConfig의 tied 기본값](https://github.com/huggingface/transformers/blob/v4.18.0/src/transformers/configuration_utils.py).

Cosmoquester BART는 각 attention의 Q/K/V/O weight·bias, encoder 2개/decoder 3개 LayerNorm, FFN weight·bias, 두 position embedding, 두 embedding LayerNorm을 더했다. `V*D + 2*(2048+2)*D + 4*D + 3*(4*(D²+D)+2*D*F+F+D+4*D) + 3*(8*(D²+D)+2*D*F+F+D+6*D) = 40,554,496`. `final_logits_bias`는 buffer이므로 학습 파라미터 합계에서 제외했다. [Transformers BART 구현](https://github.com/huggingface/transformers/blob/v4.18.0/src/transformers/models/bart/modeling_bart.py)

## 라이선스: 모델·토크나이저·데이터를 구분

아래는 공개 원문이 명시한 조건과 빠진 정보를 기록한 것이다. 훈련 데이터의 조건이 파생 모델에 어떻게 적용되는지를 단정하는 법률 판단은 아니다. 모델 저장소의 라이선스 하나를 데이터 재배포 허가로 확대 해석하지 않는다.

| 후보 | 모델 가중치 공개 표시 | 토크나이저 / 코드 | 데이터 공개 설명과 상업 검토에 남는 점 |
|---|---|---|---|
| KE-T5 / KE-T5-ko | HF 카드 Apache-2.0 | 같은 모델 저장소의 tokenizer도 Apache 표시 아래 배포되지만 개별 tokenizer LICENSE는 없음. 원저자 GitHub LICENSE는 Apache-2.0. | 한국어 확보 corpus + NIKL, 영어 RealNews. 저자는 NIKL 데이터는 라이선스 문제로 사용자가 직접 받아야 한다고 명시. 데이터별 재배포/상업 허가를 모델 라이선스로 대체하지 않음. |
| pko-T5 | **HF YAML CC-BY-4.0, 같은 카드 본문 및 원저자 저장소는 MIT** | tokenizer도 동일 저장소에 있고 별도 라이선스 선언 없음. 코드 MIT 원문은 확인됨. | NamuWiki·Wikipedia·모두의말뭉치 등을 사용했다고만 설명. 데이터별 버전/허가 목록은 확인 못함. HF와 원저자 표시 충돌을 삭제하지 말고 배포 판정 전 해소해야 함. |
| KoBART | HF plain MIT 태그; **원저자 본문과 LICENSE는 Modified MIT** | 원문은 모델과 코드에 적용한다고 명시. tokenizer 별도 grant는 확인 못함. | Korean Wiki·뉴스·책·NIKL v1.0 등. 원문의 수정은 생성한 콘텐츠에 저작권/허가 고지를 넣을 필요가 없다는 내용이며 상업 이용을 금지하는 조항은 아니다. 데이터 권리 목록은 별도 확인 필요. |
| Cosmoquester BART small | **HF 카드와 파일 목록에서 가중치 라이선스 미발견** | 사전학습 코드 저장소는 MIT. 이 코드 라이선스가 별도 배포 가중치·tokenizer에 명시적으로 적용된다는 문구는 확인 못함. | NIKL·AIHub·세종 corpus 열거. 공개 다운로드 가능하다는 사실만으로 상업 배포 승인을 추정하지 않음. |
| Wisenut KoT5 small | **README는 CC-BY-NC-SA 4.0, 실제 LICENSE 파일은 CC-BY-NC-ND 4.0**로 충돌. HF에 README/license metadata 없음 | 원저자는 라이선스가 모델 사용에 적용된다고 명시. 별도 tokenizer 허가는 확인 못함. | 한국어 42GB, Wikipedia·뉴스 등 23개 출처. 두 표시 모두 NC이므로 **상업 후보에서 제외**. 수정본 배포 조건은 SA/ND 충돌까지 해소해야 함. |

라이선스 1차 근거: [KE-T5 LICENSE](https://github.com/AIRC-KETI/ke-t5/blob/main/LICENSE), [NIKL 수동 다운로드 고지](https://github.com/AIRC-KETI/ke-t5/blob/main/datasets/README.md), [pko HF 원문 YAML/본문](https://huggingface.co/paust/pko-t5-small/raw/91c8f3b9a762807daeb344129012593934a63f52/README.md), [PAUST MIT 원문](https://github.com/paust-team/pko-t5/blob/main/LICENSE), [KoBART Modified MIT 원문](https://github.com/SKT-AI/KoBART/blob/main/LICENSE), [Cosmoquester 코드 LICENSE](https://github.com/cosmoquester/transformers-bart-pretrain/blob/master/LICENSE), [Cosmoquester 가중치 파일 목록](https://huggingface.co/cosmoquester/bart-ko-small/tree/32c6ec5844197a774d6460e7fc83812af9dc24e3), [Wisenut README 라이선스 고지](https://github.com/wisenut-research/KoT5#license), [Wisenut 실제 LICENSE 원문](https://raw.githubusercontent.com/wisenut-research/KoT5/master/LICENSE).

참고로 CC-BY-4.0는 상업적 공유·수정을 허용하되 attribution, 라이선스 링크, 변경표시 등의 조건이 있다. NC와 혼동하면 안 된다. CC-BY-NC-SA-4.0에는 NonCommercial과 ShareAlike, CC-BY-NC-ND-4.0에는 NonCommercial과 NoDerivatives 조건이 있다. [CC-BY-4.0 공식 안내](https://creativecommons.org/licenses/by/4.0/), [CC-BY-NC-SA-4.0 공식 안내](https://creativecommons.org/licenses/by-nc-sa/4.0/), [CC-BY-NC-ND-4.0 공식 안내](https://creativecommons.org/licenses/by-nc-nd/4.0/)

## 실제 공개 int8 artifact와 추정치의 차이

위 한국어 **base 체크포인트 저장소들에서는** 조사 당시 ONNX/int8 파일이 발견되지 않았다. 이는 전 세계에 변환본이 없다는 뜻이 아니다. 각 파일 목록을 확인한 결과이며 base 모델 int8 크기는 상단의 추정치와 로컬 변환 실측을 구분한다.

공개된 실제 예는 **`dohyeoplim/kobart-summary-v3-onnx`**다. 카드가 밝힌 원본은 `EbanLee/kobart-summary-v3`이며 **한국어 요약 미세조정 모델의 제3자 변환본**이다. `gogamza/kobart-base-v2` 자체를 변환한 파일로 취급하지 않는다. 체크포인트 revision은 `40ecd8ef79d57e3ea9b39fca29bc49c2129e48ad`다.

| 공개 파일 | 정확한 bytes | 용도 |
|---|---:|---|
| `onnx/encoder_model_int8.onnx` | 66,910,480 | encoder |
| `onnx/decoder_model_merged_int8.onnx` | 105,159,268 | merged decoder |
| **위 두 파일 합** | **172,069,748 = 172.070 MB = 164.098 MiB** | 두 그래프 기준 최소 모델 묶음, tokenizer 등 제외 |
| `onnx/decoder_model_int8.onnx` | 104,647,303 | 분리 decoder 대안 |
| `onnx/decoder_with_past_model_int8.onnx` | 97,407,278 | 분리 cached decoder 대안 |
| encoder + 분리 decoder + cached decoder | **268,965,061** | merged 방식과 함께 전부 더하는 것이 아니라 별도 배포 구성 |

`*_quantized.onnx`는 각각 `*_int8.onnx`와 같은 SHA-256인 alias이므로 둘 다 내려받아 더하면 중복이다. 공개 quantization 설정은 `per_channel=true`, `reduce_range=true` 등을 포함한다. 이 조사에서는 파일 **크기 메타데이터**를 읽었고 그래프 로드·정확도·CPU latency는 검증하지 않았다. [변환자 카드](https://huggingface.co/dohyeoplim/kobart-summary-v3-onnx), [파일 크기 API](https://huggingface.co/api/models/dohyeoplim/kobart-summary-v3-onnx?blobs=true), [고정 revision 파일 목록](https://huggingface.co/dohyeoplim/kobart-summary-v3-onnx/tree/40ecd8ef79d57e3ea9b39fca29bc49c2129e48ad/onnx), [quantize_config](https://huggingface.co/dohyeoplim/kobart-summary-v3-onnx/blob/40ecd8ef79d57e3ea9b39fca29bc49c2129e48ad/quantize_config.json)

따라서 **40M 모델을 int8로 변환하면 실행 가능한 묶음이 반드시 40MB가 된다**는 전제는 성립하지 않는다. 특히 encoder/decoder별 export가 공유 embedding을 파일마다 저장하거나 embedding/Gather가 FP32로 남으면 차이가 커진다. 변환 후 모든 실행 필요 파일의 bytes를 합산하고 그래프 initializer dtype을 확인해야 한다. ORT도 quantization이 정확도 손실 없는 변환은 아니며 dynamic quantization은 실행 중 scale 계산 비용이 추가된다고 설명한다. [ONNX Runtime quantization 공식 문서](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)

## 선행연구: 파라미터 수가 명시된 사례

평가셋·언어·입력·BLEU 구현이 다르므로 아래 숫자들을 동일 척도의 모델 순위로 합치지 않는다. 논문의 반올림된 M 표기는 정확한 정수 파라미터 실측이 아니다.

| 연구 / 실제 과제 | 명시된 크기 | 품질 근거 | 이번 과제에 주는 근거와 한계 |
|---|---|---|---|
| Schmitt et al., EMNLP 2020, *An Unsupervised Joint System for Text Generation from Knowledge Graphs and Semantic Parsing* | WebNLG 모델 **10.6M**; embedding 300, LSTM hidden 250, vocab **8,171**. Visual Genome 모델 60.7M, vocab 70,800 | WebNLG v2.1 graph→text test: sampled-noise unsupervised **BLEU 37.7**, METEOR 35.5, chrF++ 62.1. 같은 구조 supervised BLEU 34.4. | 10–50M 신경망 구조→문장화의 직접 사례. 작은 어휘가 모델 크기에 크게 기여. 영어·graph/text 공동학습이며 한국어 style, 억양, 사용자 persona 근거는 아님. GPU inference 약 21ms 언급은 **CPU 수치가 아님**. |
| Kale & Roy, INLG 2020, *Machine Translation Pre-training for Data-to-Text Generation — A Case Study in Czech* | NMT/MASS Transformer **93M**, 6 layers, 8 heads, hidden 512 | Czech restaurant data-to-text: NMT-pretrained BLEU **26.35**, SER **1.90%**; MASS-pretrained 17.72 / 24.82%; scratch 11.66 / 63.18%. Human accuracy 97.5, fluency 4.83 | 비영어·굴절 언어에서 사전학습 선택이 사실 보존에 영향을 준다는 근거. scratch는 1-layer이므로 93M과 같은 크기 비교가 아님. 한국어 결과 없음. |

원문 위치: [Schmitt et al. 논문 Table 3, Appendix A/B](https://aclanthology.org/2020.emnlp-main.577.pdf), [저자 코드](https://github.com/mnschmit/unsupervised-graph-text-conversion), [Kale & Roy 논문 §6.2, Tables 2–3](https://aclanthology.org/2020.inlg-1.13.pdf).

### 파라미터 총수가 빠진 관련 사례

| 과제 / 모델 | 공개된 작은 구조 정보 | 결과 | 정확히 모르는 것 |
|---|---|---|---|
| E2E NLG / TGen | attention seq2seq LSTM + 의미 slot classifier reranker. 공식 설정의 embedding/cell width **50**, beam 10 | E2E challenge test BLEU **0.6593**, NIST 8.6094, METEOR 0.4483 | 조사한 논문/설정에는 전체 고유 파라미터 수 없음. generator+reranker+vocab을 모두 세기 전 `몇 M`로 단정하지 않음. |
| E2E / UKP-TUDA Model-D | 고정 MR 값에 MLP encoder + attention GRU decoder. greedy decoding, reranker 없음 | development set 20 runs: BLEU **0.7128 ± 0.013**, TGen 0.6925. 이는 test 결과와 직접 비교할 수 없음. | 총 파라미터 수 미보고. 구조가 단순하다는 설명을 정확한 크기와 바꾸어 쓰지 않음. |
| SRST’18 / OSU Realizer | 형태 생성은 BiGRU seq2seq, encoder/decoder hidden **300**; 이후 locality feature 기반 선형화 | 영어 shallow test BLEU **66.3**, Czech 53.2, Spanish 65.3 | **전체 시스템** 파라미터 수 없음. 최종 BLEU는 GRU 하나의 성능이 아니라 inflection+linearization 결과. |

근거: [E2E challenge 결과 Table 3](https://aclanthology.org/W18-6539.pdf), [TGen 공식 baseline 설정을 재기록한 supplement](https://aclanthology.org/attachments/2020.inlg-1.10.Supplementary_Attachment.pdf), [Model-D 논문 Table 2](https://aclanthology.org/W18-6557.pdf), [저자 공개 코드/20-run 결과](https://github.com/UKPLab/e2e-nlg-challenge-2017), [OSU 논문 §3 및 결과 표](https://aclanthology.org/W18-3605.pdf).

SR’18 shallow 입력은 **어순을 제거하고 lemma로 바꾼 UD tree**이고 deep 입력은 기능어·형태 정보까지 줄인다. 공식 10개 언어 목록에 한국어는 없다. 따라서 SR 결과는 입력 표현과 평가 설계의 참고이며 한국어 검증 자료가 아니다. [SR’18 overview §2](https://aclanthology.org/W18-3601.pdf)

조사한 한국어 후보의 NLU·요약 결과를 위 WebNLG/E2E/SR 결과와 한 표의 품질 순위로 합산하지 않았다. **10–50M 공개 한국어 realizer의 실제 파라미터 수 + 의미 보존 + 말투 정확도를 함께 보고한 1차 자료는 이번 범위에서 미확인**이다. 미확인은 그러한 모델이나 논문이 존재하지 않는다는 결론이 아니다.

## 영어 소형 대조군과 제외 후보

| ID | 설정 계산 / vocab / 공유 embedding | 상태 및 사용 범위 |
|---|---|---|
| `google/t5-efficient-tiny` | **15,570,688**; V=32,128, d=256; embedding 8,224,768 (**52.82%**); int8 가중치만 15.571MB; 공개 FP32 `.bin` 62,321,434 bytes | Apache-2.0, English C4 사전학습. 4/4층. 카드 15.58M과 작은 반올림 차이. 실제 config `d_kv=64`를 사용. 목표 규모 CPU 대조군으로 유용하나 한국어 realizer 후보로 추천하지 않음. |
| `google/t5-efficient-mini` | **31,220,480**; V=32,128, d=384; embedding 12,337,152 (**39.52%**); int8 가중치만 31.220MB; 공개 FP32 `.bin` 124,920,602 bytes | Apache-2.0, English C4 사전학습. 4/4층. 카드 31.23M. 위와 같은 언어 한계. |

[Tiny 원저자 카드](https://huggingface.co/google/t5-efficient-tiny), [Tiny 설정](https://huggingface.co/google/t5-efficient-tiny/blob/3441d7e8bf3f89841f366d39452b95200416e4a9/config.json), [Tiny 파일 API](https://huggingface.co/api/models/google/t5-efficient-tiny?blobs=true), [Mini 원저자 카드](https://huggingface.co/google/t5-efficient-mini), [Mini 설정](https://huggingface.co/google/t5-efficient-mini/blob/af3816c2dbd386f7786f7757c536f0314084ff8b/config.json), [Mini 파일 API](https://huggingface.co/api/models/google/t5-efficient-mini?blobs=true).

Tiny/Mini는 카드에 한국어 사전학습이 없다고 명시되어 있으므로 이름이 tiny이고 실행이 빠르다는 이유만으로 한국어 생성 능력을 전제하지 않는다. 코드·모델·tokenizer의 공개 Apache 표시와 C4의 원문 데이터 권리는 역시 구별한다. 이번 조사에서는 두 모델의 한국어 입력을 실제로 실행하지 않았다.

`google/mt5-small`은 원저자 명시 **300M**이라 이 과제의 124M 상한을 넘는다. encoder-only 한국어 BERT/ELECTRA 및 fill-mask용 ELECTRA generator는 곧바로 사용할 autoregressive seq2seq realizer가 아니므로 크기만으로 대체 후보에 넣지 않는다. [mT5 공식 checkpoint 목록](https://github.com/google-research/multilingual-t5), [ELECTRA generator 예시 카드](https://huggingface.co/skplanet/dialog-koelectra-small-generator)

## 벤치마크에서 확인할 항목

- 표준 T5 두 후보를 **동일 input lengths, generated token 수, batch=1, greedy, CPU thread 수**로 비교한다. 모델 ID와 revision, 라이브러리 버전, CPU 정보, cache 사용 여부를 기록한다.
- cold load와 warm generation을 구분하고, 16/32/64-token 출력에서 end-to-end p50/p95, peak RSS, tokenizer 시간, encoder 시간, decoder 시간을 가능한 범위에서 분리한다. 출력이 EOS로 일찍 끝나면 고정 길이 stress 비용과 자연 종료 결과를 따로 적는다.
- FP32→ONNX→int8 각 단계에서 실행에 필요한 파일 합과 실제 initializer dtype을 확인한다. 단일 decoder 파일 크기를 모델 전체 크기로 쓰지 않는다.
- 한국어 smoke test는 placeholder, 숫자, 이름, 날짜, 부정, 존댓말·반말 조건을 포함한다. **현재 base 모델이 realizer로 미세조정되지 않았다는 사실**을 결과 표에 남긴다. 출력이 문법적이어도 skeleton fact 보존을 별도로 판정한다.
- 후보별 tokenizer의 한국어 문자열 왕복, special-token 처리, unknown 발생을 확인한다. pko는 저자가 `T5TokenizerFast`를 지정한다. Cosmoquester를 추가할 경우 기본 `use_cache=false`와 모델 카드의 BOS/EOS 포맷을 명시하고 같은 실행 조건으로 맞춘다.

표준 encoder-decoder의 ONNX export·ORT 실행·dynamic quantization 경로는 공식 도구에서 제공한다. 해당 경로가 있다는 사실은 각 오래된 체크포인트의 변환 성공이나 한국어 품질 보장이 아니다. [Optimum ONNX 실행 가이드](https://huggingface.co/docs/optimum-onnx/onnxruntime/usage_guides/models), [Optimum quantization](https://huggingface.co/docs/optimum-onnx/onnxruntime/usage_guides/quantization), [ORT quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)

## 확인한 revision 기록

| ID | 조사 시 HEAD SHA |
|---|---|
| `KETI-NLP/ke-t5-small` | `c99e8447b82d036fbfb75dcec33fb60fdf94e189` |
| `KETI-NLP/ke-t5-small-ko` | `55e3935ff76f369fa713913011ea0f4e4a38b70f` |
| `paust/pko-t5-small` | `91c8f3b9a762807daeb344129012593934a63f52` |
| `gogamza/kobart-base-v2` | `f5899cc556216353e23ee36b66fad52b902066c5` |
| `cosmoquester/bart-ko-small` | `32c6ec5844197a774d6460e7fc83812af9dc24e3` |
| `wisenut-nlp-team/KoT5-small` | `a432b8071b4298598c1aca14f3c990db45867bbb` |
| `google/t5-efficient-tiny` | `3441d7e8bf3f89841f366d39452b95200416e4a9` |
| `google/t5-efficient-mini` | `af3816c2dbd386f7786f7757c536f0314084ff8b` |
| `dohyeoplim/kobart-summary-v3-onnx` | `40ecd8ef79d57e3ea9b39fca29bc49c2129e48ad` |

HF API의 크기는 서버가 공개한 byte 수이고 git SHA는 조사시 버전이다. 동적 API 링크의 내용은 이후 변할 수 있으므로 재현 시 위 SHA로 고정한다. 이번 조사는 무료 공개 1차 자료만 사용했으며 학습, 유료 모델 API, 전체 가중치 다운로드를 수행하지 않았다.
