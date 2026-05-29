import onnx
from onnx import numpy_helper
from huggingface_hub import hf_hub_download
from collections import Counter

p = hf_hub_download("FunAudioLLM/CosyVoice2-0.5B", "speech_tokenizer_v2.onnx")
m = onnx.load(p)
inits = list(m.graph.initializer)
print(f"speech_tokenizer_v2.onnx initializer: {len(inits)}개")

shapes = Counter(tuple(i.dims) for i in inits)
print("\n[shape 빈도 상위]")
for sh, c in shapes.most_common(20):
    print(f"  {c:4}  {sh}")

print("\n[fsmn 후보 (1280,1,31)/(31,1,1280) 등]")
for i in inits:
    d = tuple(i.dims)
    if 31 in d and 1280 in d:
        print("   ", i.name, d)

print("\n[attn/mlp 후보]")
n_attn = sum(1 for i in inits if tuple(i.dims) == (1280, 1280))
n_mlp = sum(1 for i in inits if tuple(i.dims) in [(5120, 1280), (1280, 5120)])
print(f"  (1280,1280) {n_attn}개,  (5120,1280)/(1280,5120) {n_mlp}개")
print("\n[이름 샘플 — encoder/fsmn/attn 포함]")
for i in inits[:0] + [x for x in inits if any(t in x.name.lower() for t in ['fsmn','encoder','attn','self_att'])][:15]:
    print("   ", i.name, tuple(i.dims))
