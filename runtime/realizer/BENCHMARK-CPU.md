# Korean seq2seq ONNX CPU benchmark — pluto

측정일: **2026-11-11 KST** (실제 inference 14:31–14:35 UTC). 공개 사전학습 가중치만 사용했고 학습·GPU·유료 API 호출은 하지 않았다. 결과 JSON의 마지막 시작/완료 시각은 완료된 per-model 측정 결과를 다시 합친 시각일 수 있다.

**이 호스트에서는 40.55M BART도 16토큰 생성 p50 최선값이 193.76ms였고, 32토큰은 371.74ms였다.** 두 모델 모두 이번 dynamic INT8 설정이 FP32보다 느렸다. 따라서 이 모델·export·CPU 조건에서 문장당 수십 ms 가정은 성립하지 않는다. 다른 하드웨어·더 작은 모델·다른 export까지 불가능하다는 판정은 아니다.

측정 프로그램은 [benchmark-onnx.py](benchmark-onnx.py), 직접 읽을 원시 샘플·파일 해시·initializer inventory는 [benchmark-cpu.json](results/benchmark-cpu.json), 실제 배포 tokenizer 재로드 및 cache I/O 확인은 [benchmark-bundle-check.json](results/benchmark-bundle-check.json)에 있다. 공개 모델의 범위·라이선스는 [모델 조사](research-models.md)를 함께 본다.

## 환경과 측정 조건

- pluto, Intel Xeon E5-2640 @ 2.50GHz, 논리 CPU 24개, RAM 약31GiB; AVX 있음, **AVX2/VNNI 없음**. 공유 호스트이며 CPU affinity·OS page cache를 강제로 통제하지 않았다.
- Python 3.12.3, torch 2.8.0+cpu, transformers 4.57.6, optimum 2.1.0, optimum-onnx 0.1.0, onnx 1.19.1, onnxruntime 1.31.1, sentencepiece 0.2.1. 정확한 추가 의존성 버전은 JSON에 기록했다.
- batch=1, CPUExecutionProvider, inter-op=1, intra-op=1 또는2, ORT_SEQUENTIAL. PyTorch/OMP/MKL/BLAS 준비 작업은1 thread로 제한했다.
- 같은 한국어 skeleton 한 개: `말투: 해요체 / 주체: 민지 / 행동: 주문 확인 / 상품: 커피 / 수량: 2잔 / 시간: 오늘 오후 3시 / 문장:`. 실제 입력은 두 tokenizer 모두 **28 tokens**였으며 실제 문장은 JSON에 저장했다.
- greedy, KV cache 사용. `min_new_tokens=max_new_tokens=16/32`로 조기 EOS를 억제하고 실제 생성 token 수를 assert했다. decoder start는 길이에서 제외한다. BART의 최종 forced EOS는 유지되며 16/32개에 포함된다. early-EOS 허용 smoke도 별도로 기록했지만 최종 forced EOS를 자연 완결의 증거로 보지 않는다.
- 각 dtype/thread/길이에 **5 warmup + 10 measured**. p50/p95는 10개 샘플의 NumPy 선형 percentile이며 생산 트래픽의 p95 보장은 아니다. 모델 시간과 tokenizer+decode 포함 E2E를 모두 기록했다.
- PyTorch reference는 eager attention. Optimum exporter는 자동 attention 경로를 사용했고 BART trace는 SDPA였다. **opset17**의 encoder/decoder/decoder-with-past 3개 그래프이며 merged decoder는 만들지 않았다. exporter의 opset18 권장·tracer 경고는 있었으나 아래 실제 다중 token 생성과 ID 비교가 통과했다. 임의 길이·batch 전체의 동등성을 검증한 것은 아니다.

## 실제 파라미터와 파일 크기

파라미터 수는 실제 로드한 PyTorch 모델의 `sum(p.numel() for p in model.parameters())`로 세었다. 동일 객체로 묶인 shared embedding/LM head는 중복 제거된다. 아래 파일 크기는 별도 ONNX 저장 파일을 모두 더한 값이다.

| 모델 | 고정 revision | 고유 parameter 수 | 준비 시 PyTorch load | tokenizer load |
|---|---|---:|---:|---:|
| KE-T5 small | `c99e8447b82d036fbfb75dcec33fb60fdf94e189` | 76,895,616 | 123.46ms | 755.18ms |
| BART-ko small | `32c6ec5844197a774d6460e7fc83812af9dc24e3` | 40,554,496 | 391.16ms | 158.62ms |

PyTorch load와 tokenizer load는 이미 내려받은 파일의 객체 로딩 시간이다. 네트워크 다운로드를 포함하지 않으며 OS page cache를 비우지 않았다. `snapshot_download` 시간에는 기존 cache·중단 후 재개가 포함될 수 있으므로 cold network 시간으로 해석하지 않는다.

| 모델 / dtype | encoder bytes | decoder bytes | decoder-with-past bytes | 3 graphs 합 bytes | tokenizer/config bytes | 전체 bundle bytes (MiB) |
|---|---:|---:|---:|---:|---:|---:|
| KE-T5 small fp32 | 206,996,467 | 363,645,274 | 351,038,998 | 921,680,739 | 6,099,995 | 927,780,734 (884.801) |
| KE-T5 small int8 | 150,662,340 | 190,419,428 | 187,195,713 | 528,277,481 | 6,099,995 | 534,377,476 (509.622) |
| BART-ko small fp32 | 107,611,825 | 185,969,643 | 179,654,639 | 473,236,107 | 2,416,049 | 475,652,156 (453.617) |
| BART-ko small int8 | 79,407,705 | 99,414,653 | 97,792,885 | 276,615,243 | 2,416,049 | 279,031,292 (266.105) |

**위 bundle은 이번에 실제 실행한 3-graph 구성이지 최소 가능한 배포량이 아니다.** 런타임 Python/JS/WASM, OS 라이브러리, RSS, KV cache는 포함하지 않는다. tokenizer/config 열은 source 준비본이 아니라 실제 fp32/int8 디렉터리의 파일들을 합했다. 같은 입력으로 이 배포 tokenizer를 다시 로드해 IDs 일치를 확인했다.

양자화는 `quantize_dynamic`, `QInt8`, `per_channel=True`, `reduce_range=False`, `op_types_to_quantize=[MatMul]`, `MatMulConstBOnly=True`다. calibration/training은 하지 않았다. **Gather의 embedding은 FP32로 남고**, norm/bias/position embedding 등도 FP32다. output LM projection과 상수 MatMul weight에 INT8가 적용됐다. 분리된 encoder/decoder/past graph에는 원래 공유하던 embedding 및 decoder weight가 중복 저장된다. 파일별 동일 initializer hash·embedding/LM-head 크기 tensor의 정규화 hash는 JSON에 있다.

| 모델 / graph (INT8 export) | 잔류 FLOAT elements | INT8 elements |
|---|---:|---:|
| KE-T5 small / encoder_model.onnx | 32,876,224 | 18,908,160 |
| KE-T5 small / decoder_model.onnx | 32,957,760 | 58,110,592 |
| KE-T5 small / decoder_with_past_model.onnx | 32,951,616 | 54,958,720 |
| BART-ko small / encoder_model.onnx | 17,468,416 | 9,451,008 |
| BART-ko small / decoder_model.onnx | 17,547,776 | 29,018,880 |
| BART-ko small / decoder_with_past_model.onnx | 17,541,632 | 27,442,944 |

이 element 수는 **저장된 graph initializer** 수이며 상수·scale·반복 weight를 포함한다. 고유 trainable parameter 수와 같지 않다. 이 결과는 “모든 parameter를 한 번만 INT8로 저장하면 N MB”라는 산술과 실제 artifact가 다른 이유를 보여준다. merged decoder·다른 embedding 양자화·vocabulary 설계를 적용한 최소 크기는 이번에 측정하지 않았다.

## warm 생성 시간

단위 ms. 각 셀은 **p50 / p95**다. `generate()` 시간에는 generation loop와 ONNX 실행을 포함하며 tokenize·최종 text decode는 별도다.

| 모델 | dtype | threads | 16 tokens model p50 / p95 | 32 tokens model p50 / p95 | E2E p50: 16 / 32 |
|---|---|---:|---:|---:|---:|
| KE-T5 small | fp32 | 1 | 540.06 / 542.84 | 1012.39 / 1018.17 | 540.80 / 1013.09 |
| KE-T5 small | fp32 | 2 | 349.76 / 352.28 | 674.84 / 686.56 | 350.44 / 675.51 |
| KE-T5 small | int8 | 1 | 746.00 / 768.32 | 1407.07 / 1411.41 | 746.64 / 1407.74 |
| KE-T5 small | int8 | 2 | 471.18 / 480.08 | 897.52 / 917.45 | 471.85 / 898.23 |
| BART-ko small | fp32 | 1 | 287.18 / 292.83 | 549.16 / 551.14 | 287.87 / 549.85 |
| BART-ko small | fp32 | 2 | 193.76 / 195.61 | 371.74 / 383.91 | 194.45 / 372.45 |
| BART-ko small | int8 | 1 | 422.07 / 429.22 | 827.58 / 856.09 | 422.77 / 828.47 |
| BART-ko small | int8 | 2 | 265.17 / 266.89 | 507.73 / 514.03 | 265.86 / 508.45 |

INT8가 더 느린 결과는 이 AVX2 없는 CPU와 이번 graph/kernel 조합의 실측이다. AVX2/VNNI CPU나 ARM dot-product 구현에서도 반드시 느리다고 일반화하지 않는다. cache는 실제 `past_key_values.*` 입력과 `present.*` 출력을 확인했고, 16/32토큰 생성 모두 실행했다.

## session 로드와 첫 추론

각 dtype/thread마다 새 ORT model/session을 만들었다. 첫 추론은 그 직후의 고정16토큰이다. 이 표의 load는 로컬 파일→3개 ORT session 생성이며 **네트워크·디스크 cold boot 시간은 아니다**.

| 모델 | dtype | threads | 3-session load ms | 첫16-token model ms |
|---|---|---:|---:|---:|
| KE-T5 small | fp32 | 1 | 4058.86 | 554.24 |
| KE-T5 small | fp32 | 2 | 3597.81 | 380.60 |
| KE-T5 small | int8 | 1 | 2392.78 | 747.83 |
| KE-T5 small | int8 | 2 | 2269.68 | 465.09 |
| BART-ko small | fp32 | 1 | 1772.27 | 293.09 |
| BART-ko small | fp32 | 2 | 1731.36 | 196.71 |
| BART-ko small | int8 | 1 | 954.45 | 427.76 |
| BART-ko small | int8 | 2 | 911.34 | 264.52 |

## 실행 정확성과 품질 범위

| 모델 | PyTorch FP32 → ONNX FP32 fixed16 IDs | INT8 vs FP32 fixed16 | INT8 vs FP32 fixed32 |
|---|---|---|---|
| KE-T5 small | 완전 일치 | 1위치 변화 / 17 IDs | 1위치 변화 / 33 IDs |
| BART-ko small | 완전 일치 | 완전 일치 | 4위치 변화 / 33 IDs |

위 ID 비교에는 decoder start가 포함되므로 전체 길이는17/33이다. 모든 measured repeat에서 같은 조건의 출력 IDs는 동일했다. 단 하나의 입력에서 argmax IDs가 일치한 것은 모든 입력의 logits·의미 보존 동등성을 증명하지 않는다. INT8 결과 변화도 품질 하락/향상의 방향을 여기서 판정하지 않는다.

두 체크포인트는 **skeleton→한국어 말투 realizer로 학습하지 않았다.** KE-T5는 이 입력에서 반복적인 무관 token을 냈고, BART는 입력을 일부 복사했다. 이는 runtime smoke 결과이며 사용할 수 있는 realizer 품질을 뜻하지 않는다. parent의 teacher/slot 평가는 별도 자료다.

BART tokenizer는 원본 Unigram/Metaspace를 유지한 generic `PreTrainedTokenizerFast`로 로드했다. 원저자 포맷에 맞춰 `[BOS] $A [EOS]` template를 적용하고 BOS=2/EOS=3/PAD=0, vocab length=32,000, 새 embedding 행 없음, source 저장→재로드와 실제 fp32/int8 bundle 재로드의 token IDs 일치를 확인했다. 원본 `use_cache=false`는 준비본에서 config와 generation config 모두 true로 바꿨다. 가중치 학습·변경은 없었다.

**BART 가중치 라이선스는 미확정**이므로 이번 실행은 내부 비용 비교다. 공개 다운로드가 가능하다는 이유로 배포 추천으로 바꾸지 않는다. [고정 모델 카드](https://huggingface.co/cosmoquester/bart-ko-small/blob/32c6ec5844197a774d6460e7fc83812af9dc24e3/README.md)

## 재현

실행 버전은 [REQUIREMENTS-CPU.txt](REQUIREMENTS-CPU.txt)에 고정했다. 이번 실행은 기존 `.local/realizer-venv`를 사용했다. 새 환경을 만든다면 PyTorch CPU wheel index에서 `torch==2.8.0+cpu`를 먼저 설치하고 나머지 requirements를 같은 venv에 설치한다. 설치 cache도 repository 내부로 지정해야 한다.

```bash
HF_HOME="$PWD/.local/realizer-cache/huggingface" \
PIP_CACHE_DIR="$PWD/.local/realizer-cache/pip" \
XDG_CACHE_HOME="$PWD/.local/realizer-cache/xdg" \
HF_HUB_DISABLE_IMPLICIT_TOKEN=1 HF_HUB_DISABLE_TELEMETRY=1 \
.local/realizer-venv/bin/python runtime/realizer/benchmark-onnx.py
```

프로그램은 인증 token을 보내지 않고 고정 revision의 public 파일만 가져온다. 가중치·cache·export는 `.local/realizer-cache` 및 `.local/realizer-models`에 저장하며 커밋 대상이 아니다. 모델별 완료된 결과는 같은 warmup/repeat 조건이면 재사용한다. 완전한 재측정이 필요하면 해당 모델의 `.local/realizer-models/<model>/result.json`을 다른 이름으로 보관한 뒤 다시 실행한다. `--model ke-t5-small` 또는 `--model bart-ko-small`로 한 후보만 선택할 수 있다.

실험의 다음 단계는 같은 품질을 만족하는 더 작은 realizer를 만든 뒤, 현재 native baseline과 비교하는 것이다. 브라우저 WASM/WebGPU·Android/iOS latency와 한국어 말투 품질은 이 CPU 실험으로 검증되지 않았다.
