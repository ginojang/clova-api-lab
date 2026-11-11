# 한국어 tiny seq2seq realizer: 런타임·배포 근거

확인일: 2026-11-11. 범위: 공개 패키지 메타데이터, 버전 고정 소스, 공식 문서, 원저자 벤치마크. 이 문서 작성 과정에서 모델 전체 가중치 다운로드·학습·유료 API 호출·실제 브라우저 추론은 하지 않았다. 아래의 **지원 코드 확인**, **외부 저자 측정**, **우리 장비 측정 필요**를 구분한다. 메타데이터 스냅샷은 `research-runtime.json`에 있다.

**판정:** T5/BART 계열의 encoder–decoder 생성은 Transformers.js와 ONNX Runtime로 구현 가능하다. 그러나 **10–50M 모델로 한국어 문장 전체를 수십 ms 안에 생성하고, 같은 목표를 브라우저·모바일 CPU 모두에서 달성한다는 주장은 아직 검증되지 않았다.** 우선 native ORT CPU FP32/INT8 + KV cache + greedy를 측정하고, 같은 입력·출력 토큰 조건으로 WASM 및 WebGPU를 별도 검증하는 것이 타당하다. 파라미터 수나 INT8 표기만으로 속도·다운로드 크기·품질을 확정하지 않는다.

## 1. 확인한 버전과 지원의 의미

| 구성요소 | 2026-11-11 조회 결과 | 실무 제약 / 근거 |
|---|---|---|
| `@huggingface/transformers` | npm `latest=4.3.2`, 배포 2026-10-27; `next=4.4.0-next.0` | 4.3.2는 `onnxruntime-web=1.31.0-dev.20260914-8d85527a0`, `onnxruntime-node=1.30.0`를 명시한다. standalone ORT 최신판과 같은 버전이라고 쓰면 안 된다. [npm 메타데이터](https://registry.npmjs.org/@huggingface/transformers), [고정 package.json](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/package.json) |
| `onnxruntime-web` | npm `latest=1.31.1`, 배포 2026-10-26 | 직접 ORT Web를 사용하는 경우의 최신 stable. JS 프레임워크가 묶은 의존성을 임의 교체한 조합은 별도 검증한다. [npm](https://registry.npmjs.org/onnxruntime-web) |
| Python `onnxruntime` | PyPI `1.31.1`, 배포 2026-10-26, Python `>=3.11` | native CPU 측정 버전을 결과에 기록한다. [PyPI](https://pypi.org/pypi/onnxruntime/1.31.1/json) |
| `optimum-onnx` | PyPI `0.1.0`, 배포 2025-12-23 | 요구사항 `optimum~=2.1.0`, `transformers>=4.36,<4.58.0`, ORT extra `>=1.18.0`. Python >=3.9이나 위 ORT 최신판 조합은 >=3.11 필요. [PyPI](https://pypi.org/pypi/optimum-onnx/0.1.0/json), [v0.1.0 의존성](https://github.com/huggingface/optimum-onnx/blob/v0.1.0/pyproject.toml) |
| Python `transformers` 후보 pin | `4.57.6`는 실제 배포 버전, 2026-01-16 | 위 Optimum 범위를 만족하는 재현용 후보이며 최신판이라는 뜻이 아니다. 이 문서에서 설치·export 성공을 검증한 조합은 아니다. [PyPI](https://pypi.org/pypi/transformers/4.57.6/json) |

### T5/BART 생성 지원

| 확인 항목 | 확인 결과 | 남는 검증 |
|---|---|---|
| 모델 클래스 | 4.3.2에 `T5ForConditionalGeneration`, `BartForConditionalGeneration` 존재. [T5](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/models/t5/modeling_t5.js), [BART](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/models/bart/modeling_bart.js) | 이름만 같은 custom 모델, tokenizer, export variant까지 자동 지원한다는 뜻은 아니다. |
| encoder–decoder 실행 | Seq2Seq는 `encoder_model`과 `decoder_model_merged` 세션을 사용한다. encoder를 먼저 실행한 뒤 decoder에 encoder outputs, attention mask, KV cache를 전달하는 생성 코드가 있다. [session 설정](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/models/session_config.js), [생성 코드](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/models/modeling_utils.js) | custom ONNX의 입력·출력 이름, cache shape, start/EOS token 설정을 맞춰야 한다. |
| 캐시 | `use_cache_branch`로 첫 step과 이후 step을 구분하고 `past_key_values`를 갱신한다. GPU 출력 위치 설정도 존재한다. [session 구현](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/models/session.js) | 프레임워크 cache 지원과 실제 그래프의 cache 사용을 구별한다. 토큰마다 encoder를 다시 실행하거나 전체 prefix를 재계산하면 안 된다. |
| 공식 테스트 | tiny random T5의 `.generate()` batch 1 / batch >1 기대 토큰 테스트가 있다. [고정 테스트](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/tests/models/t5/test_modeling_t5.js) | 이 테스트의 존재를 한국어 품질·모든 브라우저 WebGPU 통과 증거로 쓰지 않는다. |
| WebGPU | Transformers.js는 `device: 'webgpu'`를 ORT Web로 연결한다. ORT 직접 사용 시 `onnxruntime-web/webgpu` import와 EP 선택이 필요하다. [HF 가이드](https://huggingface.co/docs/transformers.js/guides/webgpu), [ORT 가이드](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) | exact graph × dtype × browser × GPU별 세션 생성과 다중 토큰 생성 성공을 확인한다. |
| decoding | 초기 실험은 `num_beams:1`, `do_sample:false`로 고정한다. 4.3.2 생성 소스에는 새 beam 생성 미지원 TODO가 남아 있다. [생성 코드](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/models/modeling_utils.js#L957) | Python `generate()` 옵션 전체가 JS에서도 같은 동작이라는 가정은 금지한다. |

**ORT Web는 모델 전체의 의미를 이해하는 T5 생성 서버가 아니다.** ONNX 세션 실행을 제공하고, tokenizer·generation loop·EOS·cache 관리는 Transformers.js 또는 애플리케이션이 맡는다. native 전용 fused `BeamSearch` 그래프를 그대로 가져오는 경로보다 encoder/decoder export가 브라우저 검증에 적합하다.

### dtype·quantization·cold load

| 항목 | 실제 제약 |
|---|---|
| dtype 선택 | `fp32`, `fp16`, `q8`/`int8`/`uint8`, `q4`/`q4f16` 등은 **이미 만들어진 해당 ONNX 파일 선택**이다. 로딩 옵션 하나로 원본 모델이 자동 양자화되는 것은 아니다. encoder와 decoder에 서로 다른 dtype도 지정 가능하다. [HF dtype 문서](https://huggingface.co/docs/transformers.js/en/guides/dtypes) |
| 기본값 | 4.3.2 소스 기준 WASM 기본은 q8, 그 외 기본은 fp32. 실험에서는 항상 명시한다. fp16 WebGPU는 adapter의 `shader-f16` 지원을 확인한다. [고정 dtype 소스](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/utils/dtypes.js) |
| q8 ≠ GPU INT8 가속 보장 | ORT v1.31.1 WebGPU 표에는 `MatMulNBits`, `GatherBlockQuantized`, `If`, `MatMul` 등이 있으나 `MatMulInteger`/`DynamicQuantizeLinear`는 나열되지 않는다. native CPU용 dynamic INT8 export가 WebGPU에 그대로 적합하다고 가정하지 않는다. 지원 안 되는 노드의 fallback·복사·실패 여부를 profile로 확인한다. [버전 고정 op 목록](https://github.com/microsoft/onnxruntime/blob/v1.31.1/js/web/docs/webgpu-operators.md) |
| kernel 제약 | 같은 목록의 fused `Attention`/`MultiHeadAttention`에는 mask 및 past/present 구현 제약이 표시되어 있다. native 최적화 graph를 브라우저에 재사용하기 전 확인한다. |
| cache residency | GPU에서 CPU로 KV를 매 step 복사하면 이점이 줄어든다. ORT는 GPU tensor IO binding을 지원한다. graph capture는 static shape + 모든 compute kernel이 WebGPU일 때 적용 후보이며, 길이가 증가하는 일반 decoder에 자동 적용되는 약속이 아니다. [ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html) |
| WASM threading | cross-origin isolation과 WASM multithreading 지원이 있어야 multi-thread가 켜진다. `numThreads=1`과 실제 활성 thread 수를 따로 기록한다. WebGPU와 ORT `wasm.proxy`는 함께 사용할 수 없으므로 WebGPU worker는 직접 구성한다. [ORT 환경 설정](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html) |
| cold load | 최초 다운로드, Cache API 읽기, ONNX parsing/session 생성, CPU/GPU weight 업로드, shader compile, 첫 inference를 분리한다. Cache API는 네트워크 재다운로드를 줄일 뿐 살아 있는 session이나 GPU KV cache를 보존하지 않는다. Transformers.js의 browser cache는 API가 있을 때 기본 활성이다. [HF env 구현](https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/env.js), [ORT large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) |
| 메모리 | protobuf 2GB 단일 파일 제한, ORT Web 문서상 WASM32 4GB 접근 제한과 external data 처리 제약이 있다. 10–50M의 직접 병목은 보통 여기에 도달하기 전 생길 수 있다. 다운로드 bytes 외에 JS buffer, ORT arena, GPU weight, activation, KV cache가 필요하다. [ORT large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) |

## 2. WebGPU 배포 표: 2026-11-11 확인

다음은 **확인된 출시 하한 및 현재 공개된 제약**이다. 최신 브라우저의 모든 patch/장비를 실기 검증한 목록은 아니다. ORT 사이트의 Safari·Firefox ❌ 표와 일부 HF 안내는 출시 정보를 늦게 반영하므로 브라우저 vendor와 GPU for the Web 작업반 자료를 우선했다. 작업반 표 최종 편집일은 2026-10-02다. [작업반 구현 상태](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)

| 브라우저 / OS | 확인된 기본 활성 범위 | 제약·별도 확인 |
|---|---|---|
| Chrome/Chromium 계열, Windows x86/x64·macOS·ChromeOS | Chromium 113+ | HTTPS/localhost, 사용 가능한 adapter, graphics acceleration, driver/blocklist에 좌우된다. Windows ARM64는 작업반 표상 아직 flag 경로. Chromium 계열 각 제품 release의 exact EP smoke test 필요. [Chrome 문제 해결](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips) |
| Chrome Linux | 144 Intel Gen12+; 147부터 NVIDIA Wayland, 작업반 표의 driver `535.183.01+` | AMD·다른 조합까지 기본 활성로 일반화하지 않는다. [Chrome 144](https://developer.chrome.com/blog/new-in-webgpu-144), [Chrome 147–148](https://developer.chrome.com/blog/new-in-webgpu-147-148), [작업반 표](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) |
| Chrome Android | 121 Android 12+의 Qualcomm/ARM GPU로 출시 | 현재 작업반 표는 Intel도 포함하고 Imagination은 Android 16+ / Chrome 139를 명시한다. Samsung Xclipse·기타는 TBD. Android 전 기종 보장은 아니다. [Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121), [작업반 표](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) |
| Firefox Windows | 141부터 출시 | dedicated worker 등 문맥별 지원이 다를 수 있다. 현재 MDN은 142부터 service worker를 제외한 문맥을 명시한다. [141 release](https://www.firefox.com/en-US/firefox/141.0/releasenotes/), [MDN 현황](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features#webgpu_api) |
| Firefox macOS Apple Silicon | 145는 macOS Tahoe 26+; 147은 지원되는 모든 macOS로 확대 | Intel Mac까지 포함하는 발표가 아니다. [145 release](https://www.firefox.com/en-US/firefox/145.0/releasenotes/), [147 release](https://www.firefox.com/en-US/firefox/147.0/releasenotes/) |
| Firefox Linux / Intel Mac | 최신 작업반·MDN 자료는 Nightly 기본 활성, Stable/Beta 기본 활성 아님 | 연내 계획을 출시 완료로 적지 않는다. [MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features#webgpu_api) |
| Firefox Android | 작업반 표는 Beta/Nightly + `gfx.webgpu.ignore-blocklist` flag | 일반 사용자의 stable 지원으로 계산하지 않는다. [작업반 표](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) |
| Safari macOS | Safari 26 + **macOS Tahoe 26 이상** | Safari 26 앱 자체는 Sonoma/Sequoia에도 설치되지만 WebGPU의 OS 하한은 다르다. WebKit maintainer가 이전 OS 미지원을 명시했다. [Safari 26 발표](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [WebKit 299237 comment 3](https://bugs.webkit.org/show_bug.cgi?id=299237#c3) |
| Safari iPhone/iPad | Safari 26 + iOS/iPadOS 26 | 버전·GPU 기능·메모리·실제 ORT 그래프 검증 필요. [WebKit 발표](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/) |
| Chrome/Edge/Firefox iOS 앱 | Safari의 출시 사실만으로 각 앱의 exact build 지원 확정 불가 | 브라우저 이름보다 실제 엔진·OS·`navigator.gpu`·adapter·모델 smoke test 결과를 기록. 이 조사에서 각 앱의 최신 iOS build별 검증은 수행하지 않음. |

따라서 “WebGPU가 없으면 WASM fallback”은 필요하지만 fallback에서도 같은 latency SLO가 유지된다는 뜻은 아니다. 각 경로에 대해 session 생성 실패, GPU device loss, 메모리 부족을 처리하고 가장 작은 deterministic template 경로를 남기는 설계가 현실적이다.

## 3. native CPU INT8: 실제 공개 사례의 범위

아래 수치는 저자 공개 결과다. 이 저장소의 측정 결과가 아니며, 한국어 realizer와 출력 길이·하드웨어가 다르다. cold/warm·토큰 조건이 없으면 없는 그대로 기록한다.

| 원저자 사례 | 모델·장비·입출력 조건 | 공개 수치 | 해석 한계 |
|---|---|---|---|
| [ByT5 G2P ONNX 저자](https://huggingface.co/klebster/g2p_multilingual_byT5_tiny_onnx) | T5ForConditionalGeneration / ByT5-tiny **20.6M**; Intel **i9-13900KS**, 128GB DDR5; 10개 언어 총 300개 단어; greedy; 8 threads | INT8 **5.30ms/word**, FP32 7.47ms, PyTorch CPU 7.83ms; ORT default 25.09ms | 단어→IPA 작업이다. 실제 입력/출력 byte-token 길이, warmup 수, p95, cold load, 측정 runtime 버전 미공개. 예제 `max_length=50`은 실제 평균 생성 길이가 아니다. |
| [fastT5 저자](https://github.com/Ki6an/fastT5), [원본 plot](https://raw.githubusercontent.com/Ki6an/fastT5/master/data/t5-base-quant.png), [타이밍 코드](https://github.com/Ki6an/fastT5/blob/master/fastT5/model_testing_tools.py) | T5-base 약 **223M**; **AMD EPYC 7B12**; 영어→프랑스어, sequence length ≤130 조건 평균; beam 1/3/5/7/9 | 원본 그래프 beam1 INT8 **1.078초**, PyTorch **5.117초**; beam3 INT8 3.558초, PyTorch 10.91초. 단위는 `perf_counter()` 차이로 확인 | 파라미터 규모·출력 길이가 다르다. 타이밍 코드는 이미 전달된 모델의 `generate()`만 재며 tokenizer/load 제외, 별도 warmup 없음. 당시 실행 lockfile 미공개; 저장소 setup은 fastT5 0.1.4 / ORT 1.10.0을 요구한다. README의 최대 5.7× 문구와 특정 막대의 비율은 다르다. |
| [T5-small GEC 양자화 저자](https://huggingface.co/TonyRaju/gec-t5-small-coedit-onnx-int8/blob/main/README.md) | **60.5M**, Google Colab CPU 2 threads, 영어 문장 50개; CPU 제품명·beam·실제 토큰수·cold/warm·버전 미공개 | INT8 p50 **117ms**, p95 **203ms**; PyTorch FP32 226/282ms; disk 152MB vs 231MB | 조건 누락이 많아 보조 사례로만 사용. 별도 throughput 53.42 sentences/s는 batching/concurrency 설명 없이 latency의 역수와 맞지 않아 근거로 채택하지 않는다. |

**ByT5 배포 주의:** 카드에는 INT8 27MB 결과가 있지만 조회 시점 main의 실제 3개 ONNX는 `encoder_model.onnx=57,234,020B`, `decoder_model.onnx=26,118,052B`, `decoder_with_past_model.onnx=22,960,684B`, 합 **106,312,756B = 106.313MB = 101.388MiB**였다. 파일 목록은 FP32 보고값과 일치하며 카드만 보고 27MB INT8 파일을 내려받았다고 간주하면 안 된다. 실제 initializer dtype/op inspection 또는 직접 양자화가 필요하다. [Hub tree API](https://huggingface.co/api/models/klebster/g2p_multilingual_byT5_tiny_onnx/tree/main?recursive=true)

이 사례들은 “작은 T5의 native CPU 배포가 가능하다”는 근거다. 하나의 ms 수치를 모든 encoder–decoder, 한국어 문장, Android/iPhone 또는 WASM에 적용할 근거는 아니다. CPU의 INT8 명령어, dynamic activation 양자화 비용, thread oversubscription에 따라 속도 향상 여부도 달라진다. [ORT quantization 설명](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)

## 4. 모델 크기 주장 점검

### embedding / reranker도 크기 범위가 넓다

동일 task 이름은 동일 크기·architecture를 의미하지 않는다. 아래는 공식 배포자의 config 및 Hub safetensors metadata 조회 결과다. F32/BF16 tensor element 수를 기준으로 반올림했으며 작은 모델의 I64 position buffer 512개 등은 trainable parameter에 넣지 않았다. `research-runtime.json`에 model revision SHA를 기록했다.

| 모델 | 크기 등급 / 확인된 float tensor 수 | 구조상 의미 / 공식 출처 |
|---|---|---|
| all-MiniLM-L6-v2 embedding | **22.713M** | 6 layers, hidden384, vocab30,522. [config](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/blob/main/config.json), [API](https://huggingface.co/api/models/sentence-transformers/all-MiniLM-L6-v2) |
| ms-marco-MiniLM-L6-v2 reranker | **22.714M** | 작은 cross-encoder도 존재한다. pair마다 forward 필요. [API](https://huggingface.co/api/models/cross-encoder/ms-marco-MiniLM-L6-v2) |
| bge-small-en-v1.5 embedding | **33.360M** | 12 layers, hidden384. [API](https://huggingface.co/api/models/BAAI/bge-small-en-v1.5) |
| bge-base-en-v1.5 embedding | **109.482M** | 12 layers, hidden768. [API](https://huggingface.co/api/models/BAAI/bge-base-en-v1.5) |
| multilingual-e5-small embedding | **117.654M** | 이름은 small이어도 vocab250,037 × hidden384 때문에 약96M word embedding이 있다. [config](https://huggingface.co/intfloat/multilingual-e5-small/blob/main/config.json), [API](https://huggingface.co/api/models/intfloat/multilingual-e5-small) |
| bge-reranker-base | **278.044M** | XLM-R base, hidden768, vocab250,002. [config](https://huggingface.co/BAAI/bge-reranker-base/blob/main/config.json), [API](https://huggingface.co/api/models/BAAI/bge-reranker-base) |
| bge-m3 embedding | 약 **568M** backbone | XLM-R 24 layers, hidden1024. 아래 계산 참조. [config](https://huggingface.co/BAAI/bge-m3/blob/main/config.json) |
| bge-reranker-v2-m3 | **567.756M** | 24 layers, hidden1024. [API](https://huggingface.co/api/models/BAAI/bge-reranker-v2-m3) |
| Qwen3-Embedding-0.6B / 4B / 8B | 명목 **0.6B / 4B / 8B**; 저장 tensor 수 **595.777M / 4,021.774M / 7,567.295M** | decoder 기반 embedding도 있다. 8B output vector를 작은 차원으로 잘라도 weight 8B가 작은 encoder로 바뀌지는 않는다. [공식 모델 목록](https://huggingface.co/Qwen/Qwen3-Embedding-8B), [0.6B API](https://huggingface.co/api/models/Qwen/Qwen3-Embedding-0.6B), [4B API](https://huggingface.co/api/models/Qwen/Qwen3-Embedding-4B), [8B API](https://huggingface.co/api/models/Qwen/Qwen3-Embedding-8B) |
| Qwen3-Reranker-0.6B / 8B | 저장 tensor 수 **595.777M / 8,188.548M** | embedding과 reranker의 같은 명목 size도 저장 tensor 수가 다를 수 있다. [0.6B API](https://huggingface.co/api/models/Qwen/Qwen3-Reranker-0.6B), [8B API](https://huggingface.co/api/models/Qwen/Qwen3-Reranker-8B) |

영어용 MiniLM/BGE-small의 작은 크기는 한국어 품질 근거가 아니다. 반대로 “embedding/reranker는 모두 수백 M 이상”도 사실이 아니다. 검색·rerank·realization의 각 목적에 필요한 품질과 latency를 독립적으로 비교해야 한다.

### BGE-M3의 `250k × 768 ≈190M`은 잘못된 모델 대입

공식 `BAAI/bge-m3/config.json`은 `vocab_size=250002`, `hidden_size=1024`, `num_hidden_layers=24`, `intermediate_size=4096`, `max_position_embeddings=8194`다. 따라서 **word embedding만 `250002 × 1024 = 256,002,048` parameters**다. `250002 × 768 = 192,001,536`은 hidden768인 XLM-R base 계열에 해당하는 계산이다. [공식 config](https://huggingface.co/BAAI/bge-m3/blob/main/config.json)

config로 계산한 XLMRobertaModel backbone은 pooler 포함 **567,754,752**, pooler 제외 **566,705,152** parameters다. 실제 공식 ONNX external weight file `2,266,820,608B`는 후자의 FP32 bytes와 정확히 일치한다. sparse/ColBERT head 파일은 별도이고 export에 따라 포함 범위가 다르므로 전체 시스템의 단일 exact parameter 수로 혼용하지 않는다. [공식 파일 tree](https://huggingface.co/api/models/BAAI/bge-m3/tree/main?recursive=true)

### 0.1B의 raw bytes와 배포 artifact

`0.1B = 100,000,000`개 **고유 parameter를 모두 같은 정밀도로 한 번만 저장한다는 가정**이다. MB는 10^6B, MiB는 2^20B. 아래는 산술값이며 측정 artifact 크기가 아니다.

| 포맷 | raw bytes | MB | MiB |
|---|---:|---:|---:|
| FP32 | 400,000,000 | 400 | 381.470 |
| FP16/BF16 | 200,000,000 | 200 | 190.735 |
| INT8 | 100,000,000 | 100 | 95.367 |
| 4-bit packed | 50,000,000 | 50 | 47.684 |

10–50M 범위의 raw INT8는 **10–50MB (9.537–47.684MiB)**다. 실제 배포량은 graph protobuf, scales/zero-points, 미양자화 FP32 embedding/norm/bias, tokenizer, config, runtime JS/WASM, external data, 그래프 간 중복 weight가 추가된다. HTTP 압축 전후도 구별한다. weight tying은 원래 PyTorch 객체 안의 공유이며 **서로 다른 encoder/decoder ONNX 파일 사이에 공유 저장을 자동 보장하지 않는다.** decoder와 decoder-with-past를 합치면 중복을 줄일 수 있지만 encoder와 decoder에 복제된 embedding까지 모두 없어지는 것은 아니다. [Optimum export 문서](https://huggingface.co/docs/optimum-onnx/onnx/usage_guides/export_a_model), [fastT5 설계](https://github.com/Ki6an/fastT5)

따라서 “100M INT8 artifact는 반드시 100MB”, “50M INT8면 runtime RAM도 50MB”, “4-bit니까 속도도 8배”는 모두 채택하지 않는다.

## 5. export / 실행 경로와 검증 항목

아래는 공식 API와 고정 소스로 점검한 **실험 시작 예시**다. 이 문서에서 아래 조합을 설치하거나 실행하지 않았으며, 실제 통과 버전은 benchmark 결과의 lockfile·manifest가 권위다. PyTorch/ONNX/exporter 버전도 결과에 반드시 추가한다.

```bash
# 별도 실험 venv, Python 3.11+에서 사용할 pin 후보
python -m pip install 'optimum-onnx[onnxruntime]==0.1.0' \
  'optimum==2.1.0' 'transformers==4.57.6' 'onnxruntime==1.31.1'

# MODEL은 이미 검토한 로컬 T5/BART checkpoint 또는 고정 HF revision 경로.
# --no-post-process를 쓰지 않아 decoder merge를 허용한다.
optimum-cli export onnx --model "$MODEL" \
  --task text2text-generation-with-past --opset 17 "$OUT_FP32"
```

Optimum v0.1.0에서 직접 `ORTModelForSeq2SeqLM.from_pretrained(..., export=True)`를 쓰면 `use_merged` 기본값은 false다. 브라우저용 merged decoder가 목적이면 `use_merged=True`를 명시하거나 위 CLI 후 결과 파일을 점검한다. [v0.1.0 seq2seq 소스](https://github.com/huggingface/optimum-onnx/blob/v0.1.0/optimum/onnxruntime/modeling_seq2seq.py), [export 문서](https://huggingface.co/docs/optimum-onnx/onnx/usage_guides/export_a_model)

native INT8 실험은 우선 FP32와 동일 입력으로 결과 일치/허용오차를 확인한 뒤 encoder·decoder·decoder-with-past 각각에 dynamic quantization을 적용한다. `quantize_dynamic(..., weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul'])`는 출발점이며 “모든 parameter INT8”가 아니다. 기본 비상수 attention MatMul까지 양자화하는 선택, per-channel, signedness는 속도·정확도를 실측해 정한다. merged `If` 내부 subgraph의 양자화 여부도 op/initializer inventory로 확인한다. [ORT quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)

```python
import onnxruntime as ort
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoTokenizer

so = ort.SessionOptions()
so.intra_op_num_threads = 1   # 1, 2, 4, 8을 따로 측정
so.inter_op_num_threads = 1
so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
model = ORTModelForSeq2SeqLM.from_pretrained(
    OUT_DIR, provider='CPUExecutionProvider', session_options=so,
    use_cache=True,
)
tokenizer = AutoTokenizer.from_pretrained(OUT_DIR)
inputs = tokenizer(TEXT, return_tensors='pt')
tokens = model.generate(**inputs, do_sample=False, num_beams=1,
                        max_new_tokens=32)
```

브라우저 artifact는 model root의 config/tokenizer와 `onnx/encoder_model.onnx`, `onnx/decoder_model_merged.onnx` 및 선택한 dtype suffix 파일을 함께 제공한다. custom 한국어 tokenizer는 JS 로드와 Unicode roundtrip부터 검증한다. tokenizer에 미등록 placeholder나 한글이 `<unk>`로 사라지는 경로를 허용하지 않는다.

```js
// package-lock에 @huggingface/transformers@4.3.2 및 실제 ORT 의존성 고정
import { AutoTokenizer, AutoModelForSeq2SeqLM, env } from '@huggingface/transformers';
env.allowRemoteModels = false;
env.localModelPath = '/models/';
const id = 'realizer'; // /models/realizer/{config,tokenizer,onnx/...}
const tokenizer = await AutoTokenizer.from_pretrained(id);
const adapter = await navigator.gpu?.requestAdapter();
const device = adapter ? 'webgpu' : 'wasm';
// 초기 동등성 검증은 실제 fp32 파일 사용. q8/q4/fp16은 별도 export 실험.
const model = await AutoModelForSeq2SeqLM.from_pretrained(id, {
  device, dtype: 'fp32',
});
const ids = await model.generate({
  ...tokenizer(text), max_new_tokens: 32, num_beams: 1, do_sample: false,
});
const answer = tokenizer.batch_decode(ids, { skip_special_tokens: true });
```

이 feature detection만으로 모델 성공이 보장되지는 않는다. session 생성·실제 decode의 실패를 처리해 WASM으로 재시도하고, fp16을 택할 때는 `adapter.features.has('shader-f16')`도 점검한다. `device='webgpu'`인데 CPU fallback이 개입했는지는 profile로 확인한다.

| 측정 축 | 반드시 남길 값 |
|---|---|
| 모델·파일 | revision SHA, 고유 parameter 수, vocab/hidden/layers, 각 ONNX bytes/SHA256, dtype별 initializer/op count, merged/cache 유무, tokenizer bytes |
| 환경 | CPU/GPU/메모리/OS, native package lock; 브라우저 exact version, adapter 정보·limits·shader-f16, WASM threads/crossOriginIsolated |
| 실제 workload | batch1, 한국어 실제 token 수, slot serialization, input length 16/32/64/128; 실제 output 8/16/32/64; EOS 조기종료 여부 |
| latency | 다운로드 제외/포함 cold init, 첫 inference, warm p50/p95, encoder, decoder 첫 token, 이후 token별, tokenizer+decode 포함 E2E |
| quality | FP32와 INT8 결과 차이, 숫자·고유명사·placeholder 복원/보존, 누락·중복·환각, 도메인 held-out exact-match 및 사람 평가 |
| 모바일 | 실기 iOS/Android, battery/thermal 상태, 짧은 burst와 반복 호출, foreground/background 복귀, 메모리/device-loss 실패율 |

최초 의사결정 기준은 **선택한 10–50M 모델 + 제한된 입력 schema + 짧은 생성 길이**의 native CPU 결과다. 그 결과가 좋으면 WASM과 WebGPU로 확대한다. “브라우저에서 지원됨”, “native에서 빠름”, “한국어 의미 보존이 됨”은 서로 다른 통과 조건이다.
