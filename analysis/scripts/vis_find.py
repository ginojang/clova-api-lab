from huggingface_hub import get_safetensors_metadata
import re

m = get_safetensors_metadata("naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B")
names = list(m.weight_map.keys())

# Qwen2.5-VL ViT 시그니처 탐지
sig = {
    'patch_embed': [n for n in names if 'patch_embed' in n],
    '.qkv.': [n for n in names if '.qkv.' in n],
    'merger': [n for n in names if 'merger' in n],
    'gate_proj(vision)': [n for n in names if 'gate_proj' in n and ('vision' in n or 'visual' in n)],
    'visual.': [n for n in names if 'visual' in n.lower()],
}
for k, v in sig.items():
    print(f"{k}: {len(v)}개")
    for n in v[:4]:
        print("   ", n)

print("\n=== 최상위 모듈 prefix 분포 ===")
from collections import Counter
pref = Counter('.'.join(n.split('.')[:3]) for n in names)
for p, c in pref.most_common(25):
    print(f"  {c:5}  {p}")
