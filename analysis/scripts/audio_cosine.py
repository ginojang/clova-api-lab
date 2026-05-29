import json, urllib.request, struct, re, statistics
import numpy as np, ml_dtypes
from huggingface_hub import get_safetensors_metadata

REPO_O = "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B"
REPO_Q = "Qwen/Qwen2-Audio-7B-Instruct"
PRE_O, PRE_Q = "model.audio_model.", "audio_tower."

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
    a = np.frombuffer(raw, {'F32':np.float32,'F16':np.float16,'BF16':ml_dtypes.bfloat16}.get(dt, np.float32))
    return a.astype(np.float64), tuple(info['shape'])
def cosine(a, b): return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

mo = get_safetensors_metadata(REPO_O); mq = get_safetensors_metadata(REPO_Q)
o = {k[len(PRE_O):]: k for k in mo.weight_map if k.startswith(PRE_O)}
q = {k[len(PRE_Q):]: k for k in mq.weight_map if k.startswith(PRE_Q)}
common = sorted(set(o) & set(q))
print(f"Omni model.audio_model {len(o)} / Qwen2-Audio audio_tower {len(q)} / 공통 {len(common)}\n")

res, mism = [], []
for s in common:
    a, sa = tensor(REPO_O, mo.weight_map, o[s]); b, sb = tensor(REPO_Q, mq.weight_map, q[s])
    if sa != sb: mism.append((s, sa, sb)); continue
    res.append((s, cosine(a, b)))
vals = [c for _, c in res]
print(f"비교 {len(res)}개 (shape 불일치 {len(mism)})")
print(f"전체 평균 코사인: {statistics.mean(vals):.4f} | 중앙값 {statistics.median(vals):.4f} | 최소 {min(vals):.4f} | 최대 {max(vals):.4f}")

def kind(s):
    for t in ['self_attn.q_proj.weight','self_attn.k_proj.weight','self_attn.v_proj.weight','self_attn.out_proj.weight',
              'fc1.weight','fc2.weight','layer_norm','final_layer_norm','self_attn_layer_norm','conv1','conv2','embed_positions']:
        if t in s: return t
    return 'bias/etc'
from collections import defaultdict
g = defaultdict(list)
for s, c in res: g[kind(s)].append(c)
print("\n[유형별 평균]")
for k in sorted(g): print(f"  {k:22} n={len(g[k]):3} mean={statistics.mean(g[k]):.4f} min={min(g[k]):.4f}")
print("\n[최저 8]")
for s, c in sorted(res, key=lambda x: x[1])[:8]: print(f"  {c:.4f}  {s}")
if mism:
    print("\n[shape 불일치]")
    for s, sa, sb in mism[:8]: print(f"  {s}: {sa} vs {sb}")
