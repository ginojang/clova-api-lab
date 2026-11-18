#!/usr/bin/env python3
"""Compare committed synthetic r3/r4 artifacts; never runs a service or adapter."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REFS = {
    "r3": ("ec3c9b262a14ffe07958b09f77d8b6e2b3de2481", "elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/"),
    "r4": ("adf49beb0fb094074a36030db09451d70875a796", "elda-orchestrator/measurements/eldacore/m3v02_20261117_r4/"),
}
SOURCE_HASHES = {}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(label, name):
    if not name.endswith((".json", ".jsonl")):
        raise ValueError("only committed JSON/JSONL may be read")
    ref, prefix = REFS[label]
    raw = subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{prefix}{name}"])
    SOURCE_HASHES[f"{ref}:{prefix}{name}"] = sha(raw)
    return raw


def lines(raw):
    return [json.loads(line) for line in raw.splitlines() if line]


def index_checks(report):
    return {c["id"]: {**c, "target_id": t["id"]} for t in report["targets"] for c in t["checks"]}


def counts(statuses):
    c = Counter(statuses)
    return {"planned": sum(c.values()), "passed": c["pass"], "failed": c["fail"], "unknown": c["unknown"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=HERE / "comparison.json")
    args = ap.parse_args()
    mapping = json.loads((ROOT / "runtime/long-memory-research/eval-v1/private/blind_map.json").read_bytes())
    inverse = {v: k for k, v in mapping["targets"].items()}
    reports, predictions, inventories, events_summary, receipts_summary = {}, {}, {}, {}, {}
    protected = {}
    for label, (ref, prefix) in REFS.items():
        folder = HERE if label == "r4" else HERE.parent / "m3-v02-r3-2026-11-17"
        report_raw = blob(label, "report.json")
        if (folder / "score_audit.report.json").read_bytes() != report_raw:
            raise ValueError("local rescored report is not byte-identical: " + label)
        for name in ("score_audit.json", "score_audit.report.json", "provenance_audit.json"):
            path = folder / name
            protected[str(path.relative_to(ROOT))] = sha(path.read_bytes())
        reports[label] = json.loads(report_raw)
        pp = lines(blob(label, "predictions.jsonl"))
        predictions[label] = {p["id"]: p for p in pp}
        if len(pp) != len(predictions[label]):
            raise ValueError("duplicate target ID")
        names = subprocess.check_output(["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only", ref, prefix + "raw/"], text=True).splitlines()
        request_ids = {Path(p).name.removesuffix(".request.json") for p in names if p.endswith(".request.json")}
        response_ids = {Path(p).name.removesuffix(".json") for p in names if p.endswith(".json") and not p.endswith(".request.json")}
        emitted = {p["normalization"]["source_blind_id"] for p in pp}
        assert emitted <= response_ids
        inventories[label] = {"requests": len(request_ids), "responses": len(response_ids),
            "request_response_ids_equal": request_ids == response_ids,
            "nonemitted_raw_targets": sorted(inverse[i] for i in response_ids - emitted)}
        ev = lines(blob(label, "run_events.jsonl"))
        settles = [e for e in ev if e["ev"] == "settle"]
        events_summary[label] = {
            "counts": dict(sorted(Counter(e["ev"] for e in ev).items())),
            "settle_ok": sum(e.get("ok") is True for e in settles),
            "settle_not_ok": sum(e.get("ok") is not True for e in settles),
            "settle_t_failed_true": sum(e.get("t_failed") is True for e in settles),
            "settle_t_failed_false": sum(e.get("t_failed") is False for e in settles),
            "settle_t_failed_absent": sum("t_failed" not in e for e in settles),
            "invalid": [e for e in ev if e["ev"] == "probe_invalid"],
            "checkpoint_failed": [e for e in ev if e["ev"] == "checkpoint_failed"],
            "skipped": [e for e in ev if e["ev"] == "probe_skipped"],
            "done": [e for e in ev if e["ev"] == "done"],
        }
        rr = lines(blob(label, "t_receipts.jsonl"))
        receipts_summary[label] = {
            "rows": len(rr), "distinct_cids": len({r["cid"] for r in rr}),
            "key_matches": sum(r["match"] == "turn_index" for r in rr),
            "nth_agrees": sum(r["nth_agrees"] is True for r in rr),
            "selected_key_duplicates": len(rr) - len({(r["cid"], r["chat_turn"]) for r in rr}),
            "missing": sum(r.get("t_receipt") is None for r in rr),
            "ok_true": sum((r.get("t_receipt") or {}).get("ok") is True for r in rr),
            "ok_false": sum((r.get("t_receipt") or {}).get("ok") is False for r in rr),
            "new_fields_present": {k: sum(k in (r.get("t_receipt") or {}) for r in rr) for k in ("reason", "downgraded", "ops_detail")},
        }
    ca, cb = (index_checks(reports[x]) for x in ("r3", "r4"))
    assert ca.keys() == cb.keys()
    common = predictions["r3"].keys() & predictions["r4"].keys()
    transitions, common_counts = {}, {}
    for category in ("all", "gate", "nongate"):
        ids = [i for i in ca if category == "all" or (ca[i]["gate"] if category == "gate" else not ca[i]["gate"])]
        transitions[category] = dict(sorted(Counter(ca[i]["status"] + "->" + cb[i]["status"] for i in ids).items()))
        ids_common = [i for i in ids if ca[i]["target_id"] in common]
        common_counts[category] = {"r3": counts(ca[i]["status"] for i in ids_common), "r4": counts(cb[i]["status"] for i in ids_common)}
    changes = [{"id": i, "r3": ca[i], "r4": cb[i]} for i in sorted(ca) if (ca[i]["status"], ca[i]["reason"]) != (cb[i]["status"], cb[i]["reason"])]
    h3, h4 = ({t["id"]: t["history_exposure"] for t in reports[k]["targets"]} for k in ("r3", "r4"))
    history_changes = [{"id": i, "r3": h3[i], "r4": h4[i]} for i in sorted(h3) if h3[i] != h4[i]]
    n11 = []
    for domain in ("signage", "guest"):
        for k in (2, 3):
            target = f"n11-{domain}-q{k}"
            raw = json.loads(blob("r4", "raw/" + mapping["targets"][target] + ".json"))
            n11.append({"target": target, "snapshot_fact_rows": len(raw["observed_db"]["_facts"]), "notes": raw["notes"], "invalid_observation": raw.get("invalid_observation")})
    gold_raw = (ROOT / "runtime/long-memory-research/eval-v1/gold.jsonl").read_bytes()
    n08_gold = next(g for g in lines(gold_raw) if g["id"] == "n08-signage-q3")
    n08_projection = {
        "gold_sha256": sha(gold_raw),
        "gold_checks": [c for c in n08_gold["checks"] if c["id"] in ("n08-signage-q3-c03", "n08-signage-q3-c05")],
        "observations": {label: {
            "effective_active_values": pp["n08-signage-q3"]["artifacts"]["context"]["effective_active_values"],
            "must_repeat_values": pp["n08-signage-q3"]["artifacts"]["must_repeat_values"],
            "ops": pp["n08-signage-q3"]["artifacts"]["ops"],
            "answer": pp["n08-signage-q3"]["answer"],
        } for label, pp in predictions.items()},
        "interpretation": "r4 stores/projects '창문 치수 재확인' while the sealed exact expected value is '다음 방문에 창문 치수 재확인'. Both structural checks remain fail; this is not evidence that no promise was stored or that the natural-language answer failed to recall the visit timing.",
    }
    result = {
        "scope": "offline arithmetic/comparison of pinned synthetic JSON/JSONL; no API/DB/adapter execution or server logs",
        "refs": REFS, "predictions": {k: len(v) for k, v in predictions.items()},
        "common_prediction_ids": sorted(common),
        "r3_only_prediction_ids": sorted(predictions["r3"].keys() - predictions["r4"].keys()),
        "r4_only_prediction_ids": sorted(predictions["r4"].keys() - predictions["r3"].keys()),
        "missing_prediction_ids": sorted({t["id"] for t in reports["r4"]["targets"]} - predictions["r4"].keys()),
        "local_report_bytes_equal_to_submitted": True,
        "state_transitions": transitions, "common_observed_counts": common_counts, "changed_checks": changes,
        "history": {"r3": reports["r3"]["history_exposure"], "r4": reports["r4"]["history_exposure"], "changed_targets": history_changes},
        "raw_inventory": inventories, "events": events_summary, "selected_t_receipts": receipts_summary,
        "r4_n11_snapshots": n11, "n08_signage_projection_boundary": n08_projection, "source_sha256": SOURCE_HASHES,
        "limits": [
            "All 470 check status/reason values are equal; this does not imply equal outputs or internal operations.",
            "r4 selected T receipts contain no ok=false and settle t_failed is always false, so the new failure-taint branch was not exercised by this run.",
            "Selected receipts are not a complete attempt ledger; ok=true does not mean each DB operation applied.",
            "n11 distractor delivery and no T failure do not prove 24 facts were stored or the token budget was stressed.",
            "A change in history watched/exposed values changes a target-value-pair denominator, not the target's failure state.",
            "Report/capture/source integrity does not authenticate a live binary or clean working tree.",
            "Sealed M3 pass-only C policy remains unchanged; semantic judgment/source binding/exact tokenizer evidence remain missing.",
        ],
        "protected_files_sha256": protected,
        "protected_files_unchanged": all(sha((ROOT / p).read_bytes()) == h for p, h in protected.items()),
    }
    assert result["protected_files_unchanged"]
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, sort_keys=True, indent=2); stream.write("\n")
    print(json.dumps({k: result[k] for k in ("predictions", "state_transitions", "changed_checks", "selected_t_receipts", "r4_n11_snapshots")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
