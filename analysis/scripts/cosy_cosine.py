import json, urllib.request, struct, statistics
import numpy as np, ml_dtypes, onnx
from onnx import numpy_helper
from huggingface_hub import hf_hub_download, get_safetensors_metadata

REPO_O = "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B"

# CosyVoice2 ONNX initializers
p = hf_hub_download("FunAudioLLM/CosyVoice2-0.5B", "speech_tokenizer_v2.onnx")
onx = {i.name: numpy_helper.to_array(i).astype(np.float64) for i in onnx.load(p).graph.initializer}
print(f"CosyVoice2 ONNX 텐서: {len(onx)}개")

# Omni discrete_audio_model 텐서 range-read
def url(repo, shard): return f"https://huggingface.co/{repo}/resolve/main/{shard}"
def _get(u, rng): return urllib.request.urlopen(urllib.request.Request(u, headers={'Range': f'bytes={rng}'}), timeout=60).read()
hc = {}
def header(u):
    if u in hc: return hc[u]
    n = struct.unpack('<Q', _get(u, '0-7'))[0]
    hc[u] = (json.loads(_get(u, f'8-{8+n-1}')), 8 + n); return hc[u]
def tensor(repo, wm, name):
    u = url(repo, wm[name]); h, ds = header(u); info = h[name]; s, e = info['data_offsets']
    raw = _get(u, f'{ds+s}-{ds+e-1}'); dt = info['dtype']
    a = np.frombuffer(raw, {'F32': np.float32, 'F16': np.float16, 'BF16': ml_dtypes.bfloat16}.get(dt, np.float32))
    return a.astype(np.float64), tuple(info['shape'])
def cosine(a, b):
    a, b = a.ravel(), b.ravel()
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

mo = get_safetensors_metadata(REPO_O)
dnames = [k for k in mo.weight_map if k.startswith('model.discrete_audio_model.')]
res, miss, mism = [], [], []
for n in dnames:
    suf = None
    for pre in ['model.discrete_audio_model.encoder.', 'model.discrete_audio_model.']:
        if n.startswith(pre) and n[len(pre):] in onx:
            suf = n[len(pre):]; break
    if suf is None:
        miss.append(n); continue
    a, sa = tensor(REPO_O, mo.weight_map, n)
    b = onx[suf]
    if tuple(b.shape) != sa:
        mism.append((suf, sa, tuple(b.shape))); continue
    res.append((suf, cosine(a, b)))

vals = [c for _, c in res]
print(f"매칭 {len(res)} / ONNX미매칭 {len(miss)} / shape불일치 {len(mism)}")
if vals:
    print(f"전체 평균 코사인: {statistics.mean(vals):.4f} | 중앙값 {statistics.median(vals):.4f} | 최소 {min(vals):.4f} | 최대 {max(vals):.4f}")
print("\n[최저 10]")
for s, c in sorted(res, key=lambda x: x[1])[:10]:
    print(f"  {c:.4f}  {s}")
if miss: print("\n미매칭(ONNX에 없음) 예시:", miss[:6])
if mism: print("\nshape 불일치 예시:", mism[:6])
