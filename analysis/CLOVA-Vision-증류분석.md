# CLOVA 비전 인코더 — Qwen 차용 의혹 가중치 포렌식 (화이트박스)

> 분석일: 2026-05-29 · 대상: `naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B` (공개 가중치)
> 질문: 보도된 **"네이버 비전 인코더 = 중국 Qwen 99.51% 유사"** 가 공개 모델 가중치로 재현되는가?
> 결론(요약): **재현됨.** Omni-8B의 비전 타워는 **Qwen2.5-VL-32B의 ViT를 복사 후 가볍게 파인튜닝**한 것. **공통 ViT 텐서 390개 전체** 평균 코사인 **0.9950**(보도 99.51%와 사실상 동일, shape 불일치 0).

---

## 0. 배경 (언론 보도)

- 2026-01-15, 한국 "독자 AI 파운데이션 모델(국가대표 AI)" 1차에서 네이버 `HyperCLOVA X Seed 32B Sync` 탈락.
- 사유: **비전 인코더(이미지 처리 모듈) 가중치가 알리바바 Qwen과 코사인 99.51%·피어슨 98.98%** — 사실상 동일 계열. "독자 기술" 취지 위배.
- 네이버 해명: "**언어·추론의 두뇌(파운데이션 LM)는 100% 자체 개발**, 비전 인코더만 글로벌 호환성·최적화 위해 중국 오픈소스 기반으로 파인튜닝해 전략적 채택."
- (LLM 축은 별도 보고서 [CLOVA-LLM-증류분석.md]에서 독자로 확인.)

탈락 모델(`Seed 32B Sync`)은 비공개. 본 분석은 **공개된 동일 회사·동일 패턴 모델 `HyperCLOVAX-SEED-Omni-8B`**로 가중치를 직접 검증한다.

---

## 1. 방법론 — 화이트박스 가중치 코사인

- 두 모델의 비전 ViT에서 **대응 텐서**를 찾아 평탄화 후 **코사인 유사도**를 계산.
- 독립 학습 모델끼리는 대응 가중치 코사인이 **≈0**(특히 bias/norm). 0.9+가 나오면 **동일 가중치에서 출발(복사/파인튜닝)**이라는 직접 증거.
- 전체 다운로드 없이 **safetensors 헤더 + HTTP Range 요청**으로 필요한 텐서 바이트만 읽어 계산(수십 MB). bf16은 `ml_dtypes`로 디코딩.

환경: hanaki(RTX 5060 Ti, GPU 불필요 — CPU 계산), `tokenizers`/`numpy`/`ml_dtypes`/`huggingface_hub`.

---

## 2. 아키텍처 발견 — 어디에 Qwen ViT가 있나

NAVER 공개 SEED 비전 모델:

| 모델 | 비전 인코더 | 비고 |
|---|---|---|
| HyperCLOVAX-SEED-Vision-Instruct-3B | **SigLIP**(구글, hidden 1152·27층) | Qwen 아님 — 논란 모델 아님 |
| HyperCLOVAX-SEED-Omni-8B | **2종 공존** (아래) | 논란 직결 후보 |

`Omni-8B` 내부 모듈(safetensors 텐서 prefix 분포):
- `model.vision_model.blocks.*` (384개) + `model.vision_model.merger.*` — **Qwen2.5-VL ViT 시그니처**: 융합 `attn.qkv`(3840), SwiGLU `mlp.gate_proj/up_proj/down_proj`, `merger.ln_q` ← **이게 핵심 비전 인코더**.
- `model.discrete_vision_model.*` (encoder/decoder + bottleneck) — **SigLIP 기반 이산 토크나이저**(별개 모듈, 이미지 생성/이해용). hidden 1152·`fc1/fc2`·`q/k/v/out_proj`.
- `model.audio_model.*`, `model.discrete_audio_model.*`(fsmn_block — Alibaba FunASR 계열 시그니처), `model.language_model.*`, `model.mm_projector`.

→ 비교 대상은 **`model.vision_model`(Qwen2.5-VL ViT)**.

---

## 3. 소스 모델 특정 — 어느 Qwen인가

`model.vision_model`의 MLP intermediate = **3456**. 후보별 ViT MLP gate_proj 차원:

| 후보 | ViT MLP intermediate | merger out-dim |
|---|---|---|
| Qwen2.5-VL-3B-Instruct | 3420 | — |
| Qwen2.5-VL-7B-Instruct | 3420 | (LLM 3584) |
| **Qwen2.5-VL-32B-Instruct** | **3456 ✓** | **5120 ✓** |
| Qwen2.5-Omni-7B / 3B | 3420 | — |

- Omni-8B ViT MLP(3456)·merger out-dim(5120)이 **Qwen2.5-VL-32B에만 일치**.
- 탈락 모델명이 **"Seed 32B Sync"** → 소스 = **Qwen2.5-VL-32B**로 정합.

---

## 4. 결과 — 텐서별 코사인 (vs Qwen2.5-VL-32B-Instruct)

**공통 ViT 텐서 390개 전부** 비교(블록 0~31 × 전 텐서 + merger + patch_embed). **shape 불일치 0.**

### **전체 평균 코사인 = 0.9950** (중앙값 0.9994 · 최소 0.9790 · 최대 1.0000 · n=390)

[유형별 평균 (각 n=32, 32블록)]

| 텐서 유형 | 평균 | 최소 |
|---|---|---|
| `norm1.weight` / `norm2.weight` | **1.0000** | 0.9999 |
| `attn.qkv.bias` | **0.9999** | 0.9999 |
| `mlp.up_proj.bias` | 0.9998 | 0.9995 |
| `mlp.down_proj.bias` | 0.9997 | 0.9991 |
| `attn.proj.bias` | 0.9995 | 0.9985 |
| `mlp.gate_proj.bias` | 0.9990 | 0.9919 |
| `attn.qkv.weight` | 0.9902 | 0.9844 |
| `mlp.up_proj.weight` | 0.9891 | 0.9839 |
| `mlp.down_proj.weight` | 0.9882 | 0.9835 |
| `attn.proj.weight` | 0.9878 | 0.9790 |
| `mlp.gate_proj.weight` | 0.9873 | 0.9833 |
| `merger` (n=5) | 0.9949 | 0.9805 |
| `patch_embed` (n=1) | 0.9973 | — |

**깊이 추이** `attn.qkv.weight` 32블록: 0.996(b0) → 0.984(중간 b7~11) → 0.995(심층 b25~30) → 0.991(b31). U자형이지만 전 구간 ≥0.984.

**최저값조차 0.9790**(`blocks.0.attn.proj.weight`). 즉 390개 전 텐서가 0.979~1.000 구간에 몰려 있음.

---

## 5. 해석

- **bias·norm·merger.ln_q가 1.0000** → 독립 학습이면 절대 불가능. **가중치 동일 출처 확정.**
- **weight 행렬 0.98~0.99 + 깊이/층별 미세 변형** → 복사된 인코더를 **파인튜닝**한 전형적 시그니처(초기화 공유 후 소폭 적응).
- 평균 **0.9950 ≈ 보도된 99.51%** — 정부/분석기관 결과를 **공개 모델에서 독립 재현**한 셈.
- 소스가 **Qwen2.5-VL-32B**(MLP 3456·merger 5120·모델명 "32B")로 정합.

> **Omni-8B의 비전 타워(`model.vision_model`)는 Qwen2.5-VL-32B의 `visual` 타워를 복사 후 파인튜닝한 것.** 보도의 "비전 인코더 Qwen 차용"이 가중치로 직접 확증된다.

---

## 6. 전체 그림 (LLM vs 비전 — 정반대)

| 구성요소 | 분석 방식 | 결과 |
|---|---|---|
| 언어모델(두뇌) | 블랙박스 4축(토크나이저 등) | **한국 독자** (별도 보고서) |
| 비전 인코더 | 화이트박스 가중치 코사인 | **Qwen2.5-VL-32B 복사+파인튜닝 (0.9950)** |

→ 네이버 해명("두뇌 100% 자체, 인코더만 전략 채택")·탈락 사유(비전 인코더 Qwen 차용)가 **둘 다 데이터로 확인**됨.

---

## 7. 한계

- 분석 대상은 **공개 `Omni-8B`**(실제 탈락 모델 `Seed 32B Sync`는 비공개). 동일 회사·동일 소스(Qwen2.5-VL-32B)·동일 패턴이 공개 가중치로 확인된 것.
- **공통 ViT 텐서 390개 전부** 비교함(표본 아님, shape 불일치 0). `discrete_vision_model`(SigLIP)·audio 모듈은 범위 밖.
- 비교 기준은 32B-Instruct. NAVER가 정확히 어떤 32B 체크포인트/리비전을 썼는지는 미세 차이 가능(평균 0.9950은 이미 결정적).
- `discrete_vision_model`(SigLIP)·audio(fsmn) 모듈은 본 분석에서 다루지 않음 — 추가 조사 여지.

---

## 8. 재현 방법

1. `huggingface_hub.get_safetensors_metadata(repo)` 로 `weight_map`·`files_metadata`(텐서 shape) 획득.
2. Omni-8B `model.vision_model.<suffix>` ↔ Qwen `visual.<suffix>` 로 suffix 매칭.
3. safetensors 헤더(앞 8바이트 길이 + JSON) 파싱 → 각 텐서 `data_offsets`.
4. `https://huggingface.co/{repo}/resolve/main/{shard}` 에 **HTTP Range**로 해당 바이트만 GET → dtype(F32/F16/BF16; bf16은 `ml_dtypes`) 디코딩 → float64.
5. 평탄화 후 코사인 `a·b/(|a||b|)`.
- 소스 특정: 후보별 `visual.blocks.0.mlp.gate_proj.weight` shape로 MLP intermediate(=3456) 매칭.

---

## 9. 출처(언론)

- MBC: "중국 모델 베꼈는데 국가대표 AI?"‥네이버 결국 탈락 — imnews.imbc.com/replay/2026/nwdesk/article/6793926_37004.html
- 뉴스스페이스 빅테크칼럼: 네이버, 한국 주권 AI에 중국 AI 기술 사용 인정 — newsspace.kr/news/article.html?no=11704
- 뉴스1 단독: 韓 대표AI 또 자체 기술 논란…네이버, 오픈소스 일부 차용 — news1.kr/it-science/general-it/6029076
- 코리아데일리: '소버린 AI 원조' 네이버, 국가대표 AI 탈락 — koreadaily.com/article/20260115013714664
