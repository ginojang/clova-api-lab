import json, urllib.request

URL = "http://ec2-43-201-28-94.ap-northeast-2.compute.amazonaws.com/giant/clova/api/clova/chat"
P = json.load(open('/tmp/passages2.json'))
L = json.load(open('/tmp/local_counts2.json'))
models = L['models']

def pt(content):
    b = json.dumps({"model":"HCX-005","messages":[{"role":"user","content":content}],"maxTokens":1,"temperature":0}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type":"application/json"})
    return (json.load(urllib.request.urlopen(r)).get("usage") or {}).get("promptTokens")

anchor = pt(P['anchor'])
clova = {}
for cat, items in L['data'].items():
    clova[cat] = [pt(it['s']) - anchor + 1 for it in items]

# ① 글자당 토큰 (ko/zh/en)
cats = ['ko', 'zh', 'en']
print("=== 글자당 토큰 tokens/char (낮을수록 효율) ===")
print(f"{'model':12} {'ko':>6} {'zh':>6} {'en':>6}")
def row(m):
    out = []
    for cat in cats:
        ch = sum(len(it['s']) for it in L['data'][cat])
        tk = sum(clova[cat]) if m == 'CLOVA' else sum(it['counts'][m] for it in L['data'][cat])
        out.append(tk / ch)
    return out
for m in ['CLOVA'] + models:
    r = row(m); print(f"{m:12} {r[0]:6.3f} {r[1]:6.3f} {r[2]:6.3f}")

# ② 숫자 지문
print("\n=== 숫자 토큰화 지문 (토큰 수) ===")
hdr = f"{'string':>20} {'CLOVA':>6} " + " ".join(f"{m[:8]:>8}" for m in models)
print(hdr)
for i, it in enumerate(L['data']['digits']):
    line = f"{it['s'][:20]:>20} {clova['digits'][i]:>6} " + " ".join(f"{it['counts'][m]:>8}" for m in models)
    print(line)

# ③ 공백/스크립트-혼합 지문
print("\n=== 특수 문자열 지문 (토큰 수) ===")
print(hdr)
for i, it in enumerate(L['data']['special']):
    label = repr(it['s'])[:20]
    line = f"{label:>20} {clova['special'][i]:>6} " + " ".join(f"{it['counts'][m]:>8}" for m in models)
    print(line)
