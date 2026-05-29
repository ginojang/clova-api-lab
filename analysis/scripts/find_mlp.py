from huggingface_hub import get_safetensors_metadata

def vit_mlp(repo):
    try:
        m = get_safetensors_metadata(repo)
        hit = {}
        for fn, fm in m.files_metadata.items():
            for name, info in fm.tensors.items():
                low = name.lower()
                if 'blocks.0.' in low and ('visual' in low or 'vision' in low):
                    if 'gate_proj.weight' in low or ('mlp' in low and 'weight' in low and 'fc1' in low):
                        hit['mlp_gate/fc1'] = (name, tuple(info.shape))
                    if 'qkv.weight' in low:
                        hit['qkv'] = (name, tuple(info.shape))
        return hit
    except Exception as e:
        return f"ERR {type(e).__name__}: {str(e)[:80]}"

for r in ["Qwen/Qwen2.5-VL-3B-Instruct",
          "Qwen/Qwen2.5-VL-32B-Instruct",
          "Qwen/Qwen2.5-Omni-7B",
          "Qwen/Qwen2.5-Omni-3B"]:
    print(f"\n{r}:")
    print("  ", vit_mlp(r))
print("\n(목표: Omni-8B vision MLP intermediate = 3456)")
