#!/usr/bin/env python3
"""Verify copied discussion examples against immutable source artifacts; no model calls."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PACK = Path(__file__).with_name("discussion-samples-2026-11-11.json")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def resolve_pointer(document, pointer):
    value = document
    for part in pointer.strip("/").split("/"):
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


def verify():
    pack = json.loads(PACK.read_text())
    assert pack["actualModelCalls"] == 0
    assert pack["selection"]["developmentExposed"] is True
    assert pack["selection"]["unseenHoldout"] is False
    assert pack["status"] == "discussion_background_only"
    assert pack["newGoldLabels"] is False
    sources = {}
    for name, expected in pack["sourceManifest"].items():
        path = ROOT / name
        assert digest(path) == expected, f"source changed: {name}"
        if path.suffix == ".json":
            sources[name] = json.loads(path.read_text())
    items = pack["items"]
    assert len(items) == 8 and len({item["id"] for item in items}) == 8
    assert len({(item["cohort"], item["sourceItemId"]) for item in items}) == 8
    quote_count = 0
    for item in items:
        refs = item["source"]
        for ref in refs.values():
            assert ref["sha256"] == pack["sourceManifest"][ref["path"]]
        packet = resolve_pointer(sources[refs["packet"]["path"]], refs["packet"]["pointer"])
        live = resolve_pointer(sources[refs["live"]["path"]], refs["live"]["pointer"])
        persona = resolve_pointer(sources[refs["persona"]["path"]], refs["persona"]["pointer"])
        mapping = sources[refs["mapping"]["path"]]
        mapped = next(x for x in mapping["items"] if x["id"] == item["sourceItemId"])
        assert mapping["sha256"] == refs["live"]["sha256"]
        assert packet["id"] == item["sourceItemId"]
        assert item["prompt"] == packet["prompt"] == live["prompt"]
        assert item["response"] == packet["text"] == live["deliveredText"]
        assert item["rawDraftContent"] == live["rawDraftContent"]
        assert item["persona"] == packet["persona"] == persona
        assert item["activeMemories"] == packet["activeMemories"] == live["activeMemorySnapshot"]
        assert item["scenarioId"] == mapped["scenarioId"] == live["scenarioId"]
        assert item["variant"] == mapped["variant"]
        assert item["personaKey"] == mapped["personaKey"]
        assert item["newAdjudication"] is None
        assert {r["role"] for r in item["existingReviews"]} == {"primary", "secondary"}
        for review in item["existingReviews"]:
            ref = review["source"]
            source = sources[ref["path"]]
            assert ref["sha256"] == pack["sourceManifest"][ref["path"]]
            assert source["packetSha256"] == refs["packet"]["sha256"]
            assert review["originalReview"] == resolve_pointer(source, ref["pointer"])
            assert review["originalReview"]["id"] == item["sourceItemId"]
            for evidence in review["originalReview"]["evidence"].values():
                quote = evidence.get("quote")
                if quote is not None:
                    assert quote in item["response"], f"quote mismatch: {item['id']}"
                    quote_count += 1
    return {"verifiedItems": len(items), "sourceFiles": len(pack["sourceManifest"]),
            "verbatimReviewQuotes": quote_count, "packetLivePersonaMemoryMatch": len(items),
            "newAdjudications": 0, "actualModelCalls": 0, "packSha256": digest(PACK)}


if __name__ == "__main__":
    print(json.dumps(verify(), ensure_ascii=False, indent=2))
