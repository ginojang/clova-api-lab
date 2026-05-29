import json, urllib.request, struct, re, statistics
import numpy as np, ml_dtypes
from huggingface_hub import get_safetensors_metadata

REPO_O = "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B"
REPO_Q = "Qwen/Qwen2.5-VL-32B-Instruct"

def url(repo, shard): return f"https://huggingface.co/{repo}/resolve/main/{shard}"
def _get(u, rng): return urllib.request.urlopen(urllib.request.Request(u, headers={'Range': f'bytes={rng}'})).read()
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
def cos(a, b): return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

mo = get_safetensors_metadata(REPO_O); mq = get_safetensors_metadata(REPO_Q)
o_suf = {k[len('model.vision_model.'):]: k for k in mo.weight_map if k.startswith('model.vision_model.')}
q_suf = {k[len('visual.'):]: k for k in mq.weight_map if k.startswith('visual.')}
common = sorted(set(o_suf) & set(q_suf))
pick = [s for s in common if re.match(r'blocks\.(0|8|16|24|31)\.', s) or 'patch_embed' in s or s.startswith('merger')]
print(f"공통 텐서 {len(common)} / 비교 {len(pick)} (vs Qwen2.5-VL-32B)\n")
cs = []; mism = []
for s in pick:
    a, sa = tensor(REPO_O, mo.weight_map, o_suf[s]); b, sb = tensor(REPO_Q, mq.weight_map, q_suf[s])
    if sa != sb: mism.append((s, sa, sb)); continue
    c = cos(a, b); cs.append((s, c))
for s, c in cs:
    print(f"  cos={c:+.4f}  {s}")
if mism:
    print("\n  shape mismatch:")
    for s, sa, sb in mism: print(f"    {s}: {sa} vs {sb}")
vals = [c for _, c in cs]
print(f"\n평균 {statistics.mean(vals):.4f} | 최소 {min(vals):.4f} | 최대 {max(vals):.4f} | n={len(vals)}")
