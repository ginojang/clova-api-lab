import json
from huggingface_hub import hf_hub_download

def cfg(repo):
    try:
        p = hf_hub_download(repo, "config.json")
        c = json.load(open(p))
        arch = c.get("architectures")
        vc = c.get("vision_config") or c.get("visual") or {}
        print(f"\n## {repo}\n  architectures: {arch}")
        if vc:
            keys = {k: vc[k] for k in ['model_type','hidden_size','depth','num_hidden_layers','patch_size','out_hidden_size','embed_dim','heads','num_heads'] if k in vc}
            print(f"  vision_config: {keys}")
        else:
            print("  (config에 vision_config 없음 — 별도 모듈일 수 있음)")
    except Exception as e:
        print(f"\n## {repo}\n  config 실패: {type(e).__name__} {e}")

def vis_tensors(repo):
    # safetensors index에서 vision/visual 텐서 이름·매핑 확인
    for idx in ["model.safetensors.index.json"]:
        try:
            p = hf_hub_download(repo, idx)
            wm = json.load(open(p))["weight_map"]
            vis = [k for k in wm if any(t in k.lower() for t in ['visual', 'vision', 'vit', 'image_enc'])]
            print(f"  vision 텐서 {len(vis)}개 (총 {len(wm)}). 예시:")
            for k in vis[:6]:
                print("    ", k)
            return
        except Exception as e:
            print(f"  index 실패: {type(e).__name__}")

for r in ["naver-hyperclovax/HyperCLOVAX-SEED-Vision-Instruct-3B",
          "naver-hyperclovax/HyperCLOVAX-SEED-Omni-8B",
          "Qwen/Qwen2-VL-2B-Instruct"]:
    cfg(r)
    vis_tensors(r)
