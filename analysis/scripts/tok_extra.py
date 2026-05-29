import json, urllib.request, glob
from tokenizers import Tokenizer

def dl_load(urls, dest):
    for u in urls:
        try:
            urllib.request.urlretrieve(u, dest)
            t = Tokenizer.from_file(dest)
            print(f"  loaded: {u}")
            return t
        except Exception as e:
            print(f"  skip {u.split('/resolve')[0].split('huggingface.co/')[-1]}: {type(e).__name__}")
    return None

P = json.load(open('/tmp/passages.json'))

def tpc(tok):
    out = {}
    for cat in ['ko', 'zh', 'en']:
        ch = sum(len(s) for s in P[cat])
        tk = sum(len(tok.encode(s).ids) for s in P[cat])
        out[cat] = tk / ch
    return out

models = {}
qp = glob.glob('/home/gino/.cache/huggingface/hub/models--Qwen--Qwen2.5-7B-Instruct/snapshots/*/tokenizer.json')[0]
models['Qwen2.5'] = Tokenizer.from_file(qp)

print("DeepSeek 다운로드:")
ds = dl_load([
    "https://huggingface.co/deepseek-ai/DeepSeek-V3/resolve/main/tokenizer.json",
    "https://huggingface.co/deepseek-ai/deepseek-llm-7b-chat/resolve/main/tokenizer.json",
    "https://huggingface.co/deepseek-ai/DeepSeek-V2.5/resolve/main/tokenizer.json",
], '/tmp/ds.json')
if ds: models['DeepSeek'] = ds

print("GLM 다운로드:")
glm = dl_load([
    "https://huggingface.co/THUDM/glm-4-9b-chat-hf/resolve/main/tokenizer.json",
    "https://huggingface.co/THUDM/glm-4-9b-chat/resolve/main/tokenizer.json",
    "https://huggingface.co/zai-org/GLM-4-9B-0414/resolve/main/tokenizer.json",
    "https://huggingface.co/THUDM/glm-4-9b/resolve/main/tokenizer.json",
], '/tmp/glm.json')
if glm: models['GLM-4'] = glm

print("\nmodel     | ko t/ch | zh t/ch | en t/ch")
for name, tok in models.items():
    r = tpc(tok)
    print(f"{name:9} | {r['ko']:.3f}   | {r['zh']:.3f}   | {r['en']:.3f}")
print("CLOVA*    | 0.428   | 1.242   | 0.198   (* API promptTokens 측정값)")
