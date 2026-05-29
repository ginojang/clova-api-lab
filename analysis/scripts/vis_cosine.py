import json, urllib.request, struct, re, statistics
import numpy as np
import ml_dtypes
from huggingface_hub import get_safetensors_metadata

REPO_O = "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B"
REPO_Q = "Qwen/Qwen2.5-VL-7B-Instruct"

def url(repo, shard): return f"https://huggingface.co/{repo}/resolve/main/{shard}"
def _get(u, rng):
    return urllib.request.urlopen(urllib.request.Request(u, headers={'Range': f'bytes={rng}'})).read()

hdr_cache = {}
def header(u):
    if u in hdr_cache: return hdr_cache[u]
    n = struct.unpack('<Q', _get(u, '0-7'))[0]
    h = json.loads(_get(u, f'8-{8+n-1}'))
    hdr_cache[u] = (h, 8 + n)
    return hdr_cache[u]

def tensor(repo, wm, name):
    u = url(repo, wm[name]); h, ds = header(u)
    info = h[name]; s, e = info['data_offsets']
    raw = _get(u, f'{ds+s}-{ds+e-1}')
    dt = info['dtype']
    if dt == 'F32': a = np.frombuffer(raw, np.float32)
    elif dt == 'F16': a = np.frombuffer(raw, np.float16)
    elif dt == 'BF16': a = np.frombuffer(raw, ml_dtypes.bfloat16)
    else: a = np.frombuffer(raw, np.float32)
    return a.astype(np.float64), tuple(info['shape'])

def cos(a, b): return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

mo = get_safetensors_metadata(REPO_O); mq = get_safetensors_metadata(REPO_Q)
o_suf = {k[len('model.vision_model.'):]: k for k in mo.weight_map if k.startswith('model.vision_model.') and '.merger' not in k}
q_suf = {k[len('visual.'):]: k for k in mq.weight_map if k.startswith('visual.') and '.merger' not in k}
common = sorted(set(o_suf) & set(q_suf))
print(f"공통 ViT 텐서: {len(common)}  (Omni {len(o_suf)} / Qwen {len(q_suf)})")

pick = [s for s in common if re.match(r'blocks\.(0|8|16|24|31)\.', s) or 'patch_embed' in s]
print(f"비교 샘플: {len(pick)}개\n")
cs = []
for s in pick:
    a, sa = tensor(REPO_O, mo.weight_map, o_suf[s])
    b, sb = tensor(REPO_Q, mq.weight_map, q_suf[s])
    if sa != sb:
        print(f"  shape mismatch {s}: {sa} vs {sb}"); continue
    c = cos(a, b); cs.append(c)
    print(f"  cos={c:+.4f}  {s}  {sa}")
if cs:
    print(f"\n평균 코사인: {statistics.mean(cs):.4f} | 최소 {min(cs):.4f} | 최대 {max(cs):.4f} | n={len(cs)}")
