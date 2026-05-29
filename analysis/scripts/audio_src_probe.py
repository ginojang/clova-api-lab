from huggingface_hub import get_safetensors_metadata, list_repo_files

# 1) Qwen2-Audio: audio encoder 텐서 구조
print("=== Qwen/Qwen2-Audio-7B-Instruct : audio 인코더 텐서 ===")
try:
    m = get_safetensors_metadata("Qwen/Qwen2-Audio-7B-Instruct")
    names = list(m.weight_map.keys())
    au = [n for n in names if 'audio' in n.lower()]
    print(f"  audio 텐서 {len(au)}개. layers.0 + conv 샘플:")
    sample = [n for n in au if 'layers.0.' in n or 'conv' in n or 'embed_positions' in n]
    for fn, fm in m.files_metadata.items():
        for name, info in fm.tensors.items():
            if name in sample[:18]:
                print(f"    {name}  {tuple(info.shape)}")
except Exception as e:
    print("  실패:", type(e).__name__, str(e)[:100])

# 2) CosyVoice2-0.5B: 파일 목록(speech tokenizer가 safetensors인지 onnx인지)
print("\n=== FunAudioLLM/CosyVoice2-0.5B : 파일 목록 ===")
for repo in ["FunAudioLLM/CosyVoice2-0.5B"]:
    try:
        files = list_repo_files(repo)
        for f in files:
            if any(f.endswith(e) for e in ['.safetensors', '.onnx', '.pt', '.bin', '.json']):
                print("   ", f)
    except Exception as e:
        print("  실패:", type(e).__name__, str(e)[:100])
