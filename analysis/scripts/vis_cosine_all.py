import json, urllib.request, struct, re, statistics
import numpy as np, ml_dtypes
from huggingface_hub import get_safetensors_metadata

REPO_O = "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B"
REPO_Q = "Qwen/Qwen2.5-VL-32B-Instruct"

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
o_suf = {k[len('model.vision_model.'):]: k for k in mo.weight_map if k.startswith('model.vision_model.')}
q_suf = {k[len('visual.'):]: k for k in mq.weight_map if k.startswith('visual.')}
common = sorted(set(o_suf) & set(q_suf))
print(f"공통 ViT 텐서 전체: {len(common)}개 — 전부 비교\n")

results = []   # (suffix, cos)
mism = []
for s in common:
    try:
        a, sa = tensor(REPO_O, mo.weight_map, o_suf[s]); b, sb = tensor(REPO_Q, mq.weight_map, q_suf[s])
    except Exception as ex:
        print("  err", s, ex); continue
    if sa != sb: mism.append((s, sa, sb)); continue
    results.append((s, cosine(a, b)))

vals = [c for _, c in results]
print(f"비교 완료: {len(results)}개 (shape 불일치 {len(mism)})")
print(f"전체 평균 코사인: {statistics.mean(vals):.4f} | 중앙값 {statistics.median(vals):.4f} | 최소 {min(vals):.4f} | 최대 {max(vals):.4f}")

# 유형별 평균
def kind(s):
    if s.startswith('merger'): return 'merger'
    if 'patch_embed' in s: return 'patch_embed'
    for t in ['attn.qkv.weight','attn.qkv.bias','attn.proj.weight','attn.proj.bias',
              'mlp.gate_proj.weight','mlp.up_proj.weight','mlp.down_proj.weight',
              'mlp.gate_proj.bias','mlp.up_proj.bias','mlp.down_proj.bias','norm1','norm2']:
        if t in s: return t
    return 'etc'
from collections import defaultdict
g = defaultdict(list)
for s, c in results: g[kind(s)].append(c)
print("\n[유형별 평균]")
for k in sorted(g):
    print(f"  {k:22} n={len(g[k]):3} mean={statistics.mean(g[k]):.4f} min={min(g[k]):.4f}")

# qkv.weight 깊이 추이
print("\n[attn.qkv.weight 블록별 코사인 (깊이 추이)]")
qkv = {int(re.search(r'blocks\.(\d+)\.', s).group(1)): c for s, c in results if s.endswith('attn.qkv.weight') and 'blocks.' in s}
line = " ".join(f"{b}:{qkv[b]:.3f}" for b in sorted(qkv))
print("  " + line)

# 최저 10개
print("\n[코사인 최저 10]")
for s, c in sorted(results, key=lambda x: x[1])[:10]:
    print(f"  {c:.4f}  {s}")
if mism:
    print("\n[shape 불일치]")
    for s, sa, sb in mism[:10]: print(f"  {s}: {sa} vs {sb}")
