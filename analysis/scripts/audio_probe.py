import json
from huggingface_hub import hf_hub_download, get_safetensors_metadata

REPO = "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B"

# 1) config의 audio 관련 선언
p = hf_hub_download(REPO, "config.json")
c = json.load(open(p))
print("=== config audio 관련 ===")
for k, v in c.items():
    if 'audio' in k.lower():
        if isinstance(v, dict):
            print(f"{k}: { {kk: v[kk] for kk in list(v)[:12]} }")
        else:
            print(f"{k}: {v}")

# 2) 텐서 구조
m = get_safetensors_metadata(REPO)
def shapes(prefix):
    out = {}
    for fn, fm in m.files_metadata.items():
        for name, info in fm.tensors.items():
            if name.startswith(prefix):
                out[name] = tuple(info.shape)
    return out

for pref in ["model.audio_model.", "model.discrete_audio_model."]:
    t = shapes(pref)
    print(f"\n=== {pref}* : {len(t)}개 텐서 ===")
    # 블록 수 추정
    import re
    blk = set()
    for k in t:
        mm = re.search(r'(?:blocks|layers)\.(\d+)\.', k)
        if mm: blk.add(int(mm.group(1)))
    print(f"  블록/레이어 범위: {min(blk) if blk else '-'}~{max(blk) if blk else '-'} (총 {len(blk)})")
    # 블록0 + 비블록(임베딩/conv 등) 텐서 샘플
    b0 = {k: v for k, v in t.items() if '.0.' in k}
    nonblk = {k: v for k, v in t.items() if not re.search(r'(?:blocks|layers)\.\d+\.', k)}
    print("  [블록0 텐서]")
    for k in sorted(b0)[:16]:
        print(f"    {k.replace(pref,'')}  {b0[k]}")
    print("  [비블록 텐서(임베딩/conv/proj 등)]")
    for k in sorted(nonblk)[:12]:
        print(f"    {k.replace(pref,'')}  {nonblk[k]}")
