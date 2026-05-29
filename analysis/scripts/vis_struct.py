from huggingface_hub import get_safetensors_metadata

def tensors(repo):
    meta = get_safetensors_metadata(repo)
    out = {}  # name -> (shape, dtype, file)
    for fn, fmeta in meta.files_metadata.items():
        for name, info in fmeta.tensors.items():
            out[name] = (tuple(info.shape), str(info.dtype), fn)
    return out

print("== Omni-8B: discrete_vision_model 내부 구조 ==")
o = tensors("naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B")
dv = {k: v for k, v in o.items() if 'discrete_vision' in k}
# 블록0 관련 + qkv/mlp/norm 패턴
b0 = {k: v for k, v in dv.items() if ('.0.' in k) and any(t in k for t in ['qkv', 'proj', 'mlp', 'norm', 'attn', 'fc', 'linear'])}
for k in sorted(b0)[:20]:
    print(f"  {k}  {b0[k][0]} {b0[k][1]} [{b0[k][2]}]")
print(f"  (discrete_vision 텐서 총 {len(dv)}개)")
# 블록 개수 추정
import re
blocks = set()
for k in dv:
    m = re.search(r'blocks?\.(\d+)\.', k) or re.search(r'layers?\.(\d+)\.', k)
    if m: blocks.add(int(m.group(1)))
print(f"  vision 블록 인덱스 범위: {min(blocks) if blocks else '-'}~{max(blocks) if blocks else '-'} (총 {len(blocks)})")

print("\n== Qwen2.5-VL-7B: visual.blocks.0 ==")
q = tensors("Qwen/Qwen2.5-VL-7B-Instruct")
for k in sorted(q):
    if k.startswith('visual.blocks.0.'):
        print(f"  {k}  {q[k][0]} {q[k][1]} [{q[k][2]}]")
qb = set(int(re.search(r'visual\.blocks\.(\d+)\.', k).group(1)) for k in q if re.match(r'visual\.blocks\.\d+\.', k))
print(f"  Qwen visual 블록 수: {len(qb)}")
