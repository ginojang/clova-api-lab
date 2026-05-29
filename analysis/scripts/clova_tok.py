import json, urllib.request

URL = "http://ec2-43-201-28-94.ap-northeast-2.compute.amazonaws.com/giant/clova/api/clova/chat"
P = json.load(open('/tmp/passages.json'))

def pt(content):
    b = json.dumps({"model": "HCX-005", "messages": [{"role": "user", "content": content}],
                    "maxTokens": 1, "temperature": 0}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json"})
    return (json.load(urllib.request.urlopen(r)).get("usage") or {}).get("promptTokens")

anchor = pt(P['anchor'])
print("anchor promptTokens:", anchor, "(템플릿 오버헤드 보정용)")
print("cat | chars | clova content tok (t/ch)")
for cat in ['ko', 'zh', 'en']:
    ch = tc = 0
    detail = []
    for s in P[cat]:
        p = pt(s)
        ct = p - anchor + 1  # 오버헤드 제거(앵커'.'=1토큰 가정)
        ch += len(s); tc += ct
        detail.append(ct)
    print(f"{cat} | {ch} | {tc} ({tc/ch:.3f})  per={detail}")
