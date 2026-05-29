# CLOVA 오디오 인코더 — Alibaba(Qwen2-Audio / CosyVoice2) 차용 가중치 포렌식

> 분석일: 2026-05-29 · 대상: `naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B` (공개 가중치)
> 질문: Omni-8B의 오디오 인코더(특히 fsmn 모듈)도 비전처럼 중국(Alibaba) 모델 차용인가?
> 결론(요약): **그렇다 — 비전보다 더 강하게.** 연속 오디오 인코더 = **Qwen2-Audio** 그대로 복사(487텐서 **코사인 1.0000**), 이산 fsmn 토크나이저 = **CosyVoice2** 그대로 복사(fsmn **1.0000** + 구조 완전 동일). 둘 다 파인튜닝 흔적조차 없는 **verbatim copy**.

---

## 0. 구조 — Omni-8B의 두 오디오 모듈

| 모듈 | 텐서 수 | config 선언 | 정체 |
|---|---|---|---|
| `model.audio_model.*` | 487 | `audio_config.architectures: ['Qwen2AudioEncoder']` | **Qwen2-Audio 연속 인코더** (Whisper-large-v3 계열: conv1/conv2·embed_positions·32 layers) |
| `model.discrete_audio_model.*` | 102 | `discrete_audio_config.model_type: 'cosyvoice2'` | **CosyVoice2 음성 토크나이저** (fsmn_block + VQ codebook, 6 blocks) |

→ NAVER가 **config에 소스를 직접 라벨링**했다(`Qwen2AudioEncoder`, `cosyvoice2`). 둘 다 Alibaba/FunAudioLLM 계열.

---

## 1. 연속 오디오 인코더 = Qwen2-Audio (verbatim)

### 방법
Omni `model.audio_model.<suffix>` ↔ `Qwen/Qwen2-Audio-7B-Instruct` `audio_tower.<suffix>`. 텐서 이름·shape 완전 일치(conv1 (1280,128,3)·conv2·embed_positions (1500,1280)·layers.N.self_attn.{q,k,v,out}·fc1 (5120,1280)/fc2). safetensors 헤더 + HTTP Range로 전 텐서 코사인.

### 결과 — **487개 전부 코사인 1.0000**

| 유형 | n | 평균 | 최소 |
|---|---|---|---|
| self_attn q/k/v/out.weight | 각 32 | **1.0000** | 1.0000 |
| fc1.weight / fc2.weight | 각 32 | **1.0000** | 1.0000 |
| conv1 / conv2 / embed_positions | 2/2/1 | **1.0000** | 1.0000 |
| layer_norm 류 | 130 | **1.0000** | 1.0000 |
| bias 등 | 160 | **1.0000** | 1.0000 |

> 전체 평균·중앙값·최소·최대 = **1.0000** (shape 불일치 0, n=487). **파인튜닝 없이 Qwen2-Audio audio_tower를 그대로 탑재**(config `freeze_audio_projector:True`와 부합).

---

## 2. 이산 fsmn 토크나이저 = CosyVoice2 (verbatim)

### 방법
소스 `FunAudioLLM/CosyVoice2-0.5B`의 `speech_tokenizer_v2.onnx`를 onnx로 파싱(initializer 102개) → Omni `model.discrete_audio_model.*`(102개)와 비교.

### 구조 일치 (완전)
- initializer **102개 = Omni 102개**, **6 blocks = 6 blocks**.
- shape 분포 동일: `fsmn_block (1280,1,31)`×6, attn `(1280,1280)`×24, mlp `(5120,1280)/(1280,5120)`×6, `conv1 (1280,128,3)`·`conv2 (1280,1280,3)`, quantizer codebook `(1280,8)`.
- ONNX initializer 이름이 Omni와 **글자 그대로 동일**: `blocks.0.attn.fsmn_block.weight` 등.

### 결과 — fsmn **6/6 코사인 1.0000**
- `blocks.0~5.attn.fsmn_block.weight` (1280,1,31): 전부 **1.0000** (이름·shape·값 완전 동일).
- 나머지 attn/mlp 가중치는 ONNX export 시 그래프 연산으로 folding되어 익명 이름(`onnx::Add_####`)으로 바뀌어 이름 매칭 불가 — 단 shape 분포가 완전히 일치하고 fsmn(이 모듈의 고유 시그니처)이 verbatim이므로 동일 모듈로 확정.

> fsmn은 CosyVoice2 음성 토크나이저의 고유 구조다. 그 가중치가 1.0000으로 동일 → **이산 오디오 토크나이저는 CosyVoice2를 그대로 탑재.**

---

## 3. 종합 — Omni-8B 멀티모달 주변부는 Alibaba 부품 조립

| 구성요소 | 소스 | 코사인 | 방식 |
|---|---|---|---|
| 언어모델(두뇌) | (독자) | — | 한국 독자 (별도 LLM 보고서) |
| 비전 인코더 | Qwen2.5-VL-32B | 0.9950 | 복사+파인튜닝 |
| **오디오 연속 인코더** | **Qwen2-Audio** | **1.0000** | **verbatim 복사** |
| **오디오 이산(fsmn)** | **CosyVoice2** | **1.0000** | **verbatim 복사** |

→ **언어 코어는 독자, 멀티모달 주변부(비전·오디오)는 Alibaba 모델(Qwen2.5-VL·Qwen2-Audio·CosyVoice2)을 차용·조립.** 오디오는 비전보다 더 노골적(파인튜닝조차 없는 1.0000). 비전 인코더 하나로도 국가대표 AI 탈락 사유가 됐는데, 오디오 스택은 더 직접적인 복사다.

---

## 4. 한계
- 분석 대상은 **공개 `Omni-8B`**(탈락 모델 `Seed 32B Sync`는 비공개) — 동일 회사·동일 차용 패턴.
- 이산 토크나이저 attn/mlp는 ONNX folding으로 이름 매칭 불가 → fsmn(고유 시그니처) verbatim + 전체 구조 동일로 판정(전 텐서 cosine은 ONNX 그래프 역매핑 필요).
- 연속 인코더 비교 기준은 Qwen2-Audio-7B. (1.0000이므로 사실상 동일 가중치.)

## 5. 재현
1. config.json의 `audio_config.architectures`, `discrete_audio_config.model_type` 확인.
2. 연속: Omni `model.audio_model.*` ↔ Qwen2-Audio-7B `audio_tower.*` safetensors 코사인(Range read).
3. 이산: `FunAudioLLM/CosyVoice2-0.5B/speech_tokenizer_v2.onnx` initializer ↔ Omni `model.discrete_audio_model.*`, `blocks.N.attn.fsmn_block.weight` 매칭 코사인.
- 스크립트: `analysis/scripts/audio_cosine.py`, `cosy_probe.py`, `cosy_cosine.py`, `audio_probe.py`.
