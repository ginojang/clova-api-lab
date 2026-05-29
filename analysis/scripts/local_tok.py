import json, glob
from tokenizers import Tokenizer
import tiktoken

qpath = glob.glob('/home/gino/.cache/huggingface/hub/models--Qwen--Qwen2.5-7B-Instruct/snapshots/*/tokenizer.json')[0]
q = Tokenizer.from_file(qpath)
cl = tiktoken.get_encoding('cl100k_base')
P = json.load(open('/tmp/passages.json'))

print("cat | chars | qwen2.5 tok (t/ch) | cl100k tok (t/ch)")
for cat in ['ko', 'zh', 'en']:
    ch = qc = cc = 0
    for s in P[cat]:
        ch += len(s); qc += len(q.encode(s).ids); cc += len(cl.encode(s))
    print(f"{cat} | {ch} | {qc} ({qc/ch:.3f}) | {cc} ({cc/ch:.3f})")
