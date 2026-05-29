import json, glob, urllib.request
from tokenizers import Tokenizer
import tiktoken

P = json.load(open('/tmp/passages2.json'))
toks = {}

# Qwen2.5 (캐시)
qp = glob.glob('/home/gino/.cache/huggingface/hub/models--Qwen--Qwen2.5-7B-Instruct/snapshots/*/tokenizer.json')[0]
toks['Qwen2.5'] = Tokenizer.from_file(qp)

# 다운로드 후보 (중국계 + 한국계)
DL = {
    'DeepSeek-V3': ["https://huggingface.co/deepseek-ai/DeepSeek-V3/resolve/main/tokenizer.json"],
    'GLM-4': ["https://huggingface.co/THUDM/glm-4-9b-chat-hf/resolve/main/tokenizer.json"],
    'polyglot-ko': ["https://huggingface.co/EleutherAI/polyglot-ko-1.3b/resolve/main/tokenizer.json"],
    'Llama3-Ko': ["https://huggingface.co/beomi/Llama-3-Open-Ko-8B/resolve/main/tokenizer.json"],
    'KoGPT2': ["https://huggingface.co/skt/kogpt2-base-v2/resolve/main/tokenizer.json"],
}
for name, urls in DL.items():
    for u in urls:
        try:
            dest = f'/tmp/tok_{name}.json'
            urllib.request.urlretrieve(u, dest)
            toks[name] = Tokenizer.from_file(dest)
            break
        except Exception as e:
            print(f"  {name} skip: {type(e).__name__}")

cl = tiktoken.get_encoding('cl100k_base')
def count(tname, s):
    if tname == 'cl100k': return len(cl.encode(s))
    return len(toks[tname].encode(s).ids)

models = list(toks) + ['cl100k']
out = {'models': models, 'data': {}}
for cat, items in P.items():
    if cat == 'anchor': continue
    out['data'][cat] = [{'s': s, 'counts': {m: count(m, s) for m in models}} for s in items]
json.dump(out, open('/tmp/local_counts2.json', 'w'), ensure_ascii=False)
print("로드된 토크나이저:", models)
print("저장: /tmp/local_counts2.json")
