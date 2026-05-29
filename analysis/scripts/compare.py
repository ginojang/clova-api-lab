import json, urllib.request

CLOVA = "http://ec2-43-201-28-94.ap-northeast-2.compute.amazonaws.com/giant/clova/api/clova/chat"
OLLAMA = "http://localhost:11434/api/chat"

def clova(p):
    b = json.dumps({"model":"HCX-005","messages":[{"role":"user","content":p}],"maxTokens":120,"temperature":0}).encode()
    r = urllib.request.Request(CLOVA, data=b, headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r, timeout=30)).get("content","").strip()

def olla(model, p):
    b = json.dumps({"model":model,"messages":[{"role":"user","content":p}],"stream":False,"options":{"temperature":0}}).encode()
    r = urllib.request.Request(OLLAMA, data=b, headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r, timeout=120))["message"]["content"].strip()

PROBES = [
  ("임의 숫자", "1부터 100 사이의 숫자 중 딱 하나만 골라줘. 다른 말 없이 숫자만."),
  ("임의 동물", "아무 동물이나 하나만 말해. 단어 하나만."),
  ("임의 색", "좋아하는 색 하나만 단어로 답해."),
  ("예시 단어", "영어 단어 하나와 그 뜻을 한 줄로. 머리말 없이."),
  ("지식 컷오프", "당신의 학습 데이터 지식 컷오프 시점은 언제입니까? 날짜만 짧게."),
  ("정체성", "당신을 만든 회사와 모델명을 한 줄로만."),
  ("트릭 9.11", "9.11과 9.9 중 어느 수가 더 큰가? 한 줄로."),
]

models = [("CLOVA", lambda p: clova(p)),
          ("qwen2.5:7b", lambda p: olla("qwen2.5:7b", p)),
          ("qwen2.5:14b", lambda p: olla("qwen2.5:14b", p)),
          ("phi4(대조군)", lambda p: olla("phi4", p))]

for name, p in PROBES:
    print(f"\n===== {name} : {p}")
    for mname, fn in models:
        try:
            out = fn(p).replace("\n", " ")[:140]
        except Exception as e:
            out = f"(실패: {e})"
        print(f"  {mname:14}: {out}")
