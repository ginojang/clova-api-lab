#!/usr/bin/env python3
"""Compare frozen r2/r3 supplied synthetic observations; no adapter/live calls."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
R2 = "89e0930274396589d16069a050b2a58be532f807"
R3 = "ec3c9b262a14ffe07958b09f77d8b6e2b3de2481"
P2 = "elda-orchestrator/measurements/eldacore/m3v02_20261117_r2/"
P3 = "elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def count(statuses):
    c = Counter(statuses)
    return {"planned": sum(c.values()), "passed": c["pass"], "failed": c["fail"], "unknown": c["unknown"]}


def rows(raw):
    return [json.loads(line) for line in raw.decode().split("\n") if line]


def index_checks(report):
    return {c["id"]: {**c, "target_id": t["id"], "family": t["family"], "interpretation": t["interpretation"]}
            for t in report["targets"] for c in t["checks"]}


def get(row, pointer):
    value = row
    for part in pointer.lstrip("/").split("/"):
        key = part.replace("~1", "/").replace("~0", "~")
        if not isinstance(value, dict) or key not in value:
            return {"missing": True}
        value = value[key]
    return value


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=HERE / "comparison.json")
    args = ap.parse_args(argv)
    all_data = {}
    protected = {}
    for label, ref, prefix, folder in (("r2", R2, P2, HERE.parent / "m3-v02-r2-2026-11-17"),
                                       ("r3", R3, P3, HERE)):
        rb, pb = blob(ref, prefix + "report.json"), blob(ref, prefix + "predictions.jsonl")
        local_report = (folder / "score_audit.report.json").read_bytes()
        local_audit = (folder / "score_audit.json").read_bytes()
        if local_report != rb:
            raise ValueError(label + " local re-score is not byte-identical to committed report")
        protected[str(folder / "score_audit.report.json")] = sha(local_report)
        protected[str(folder / "score_audit.json")] = sha(local_audit)
        predicted = rows(pb)
        if len({p["id"] for p in predicted}) != len(predicted):
            raise ValueError("duplicate prediction")
        all_data[label] = {"report": json.loads(rb), "predictions": {p["id"]: p for p in predicted},
                           "audit": json.loads(local_audit), "report_sha256": sha(rb), "prediction_sha256": sha(pb)}
    a, b = all_data["r2"], all_data["r3"]
    common = sorted(a["predictions"].keys() & b["predictions"].keys())
    ca, cb = index_checks(a["report"]), index_checks(b["report"])
    if ca.keys() != cb.keys():
        raise ValueError("check IDs changed")
    gold_bytes = (ROOT / "runtime/long-memory-research/eval-v1/gold.jsonl").read_bytes()
    gold_checks = {c["id"]: c for r in rows(gold_bytes) for c in r["checks"]}
    matrices, common_counts = {}, {}
    for category in ("all", "gate", "nongate"):
        selected = [i for i in ca if category == "all" or (ca[i]["gate"] if category == "gate" else not ca[i]["gate"])]
        matrix = Counter(ca[i]["status"] + "->" + cb[i]["status"] for i in selected)
        matrices[category] = dict(sorted(matrix.items()))
        selected_common = [i for i in selected if ca[i]["target_id"] in common]
        common_counts[category] = {"r2": count(ca[i]["status"] for i in selected_common),
                                   "r3": count(cb[i]["status"] for i in selected_common)}
    changes = []
    for cid in sorted(ca):
        if (ca[cid]["status"], ca[cid]["reason"]) == (cb[cid]["status"], cb[cid]["reason"]):
            continue
        g = gold_checks[cid]; tid = ca[cid]["target_id"]
        row = {"id": cid, "target_id": tid, "metric": ca[cid]["metric"], "gate": ca[cid]["gate"],
               "old_status": ca[cid]["status"], "new_status": cb[cid]["status"],
               "old_reason": ca[cid]["reason"], "new_reason": cb[cid]["reason"],
               "gold_path": g["path"], "gold_operator": g["operator"], "gold_value": g["value"],
               "old_observation": get(a["predictions"].get(tid), g["path"]),
               "new_observation": get(b["predictions"].get(tid), g["path"])}
        if ca[cid]["metric"] == "load_trace":
            row["projection_ids"] = {label: {key: data["predictions"][tid]["artifacts"]["context"].get(key)
                                                for key in ("recorded_item_ids", "rendered_item_ids")}
                                     for label, data in all_data.items()}
        changes.append(row)
    ht2 = {t["id"]: t["history_exposure"] for t in a["report"]["targets"]}
    ht3 = {t["id"]: t["history_exposure"] for t in b["report"]["targets"]}
    history_changes = [{"id": i, "r2": ht2[i], "r3": ht3[i]} for i in sorted(ht2) if ht2[i] != ht3[i]]
    tree = subprocess.check_output(["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only", R3, P3 + "raw/"], text=True).splitlines()
    request_ids = {Path(p).name.removesuffix(".request.json") for p in tree if p.endswith(".request.json")}
    response_ids = {Path(p).name.removesuffix(".json") for p in tree if p.endswith(".json") and not p.endswith(".request.json")}
    emitted_blind_ids = {p["normalization"]["source_blind_id"] for p in b["predictions"].values()}
    if not emitted_blind_ids <= response_ids:
        raise ValueError("emitted prediction raw filename missing")
    report = {
        "scope": "read-only comparison of committed synthetic projections/reports; raw file names only; no API/DB/gz/raw contents",
        "r2_ref": R2, "r3_ref": R3,
        "source_hashes": {label: {"predictions.jsonl": d["prediction_sha256"], "report.json": d["report_sha256"]} for label, d in all_data.items()},
        "local_reports_byte_identical_to_git": True, "gold_sha256": sha(gold_bytes),
        "prediction_counts": {label: len(d["predictions"]) for label, d in all_data.items()},
        "common_prediction_ids": common, "r2_only_prediction_ids": sorted(a["predictions"].keys() - b["predictions"].keys()),
        "r3_only_prediction_ids": sorted(b["predictions"].keys() - a["predictions"].keys()),
        "missing_prediction_ids_equal": a["audit"]["missing_prediction_ids"] == b["audit"]["missing_prediction_ids"],
        "missing_prediction_ids": b["audit"]["missing_prediction_ids"], "state_transitions": matrices,
        "common_observed_counts": common_counts, "changed_checks": changes,
        "previous_gate_failures": [{"id": i, "metric": ca[i]["metric"], "new_status": cb[i]["status"]}
                                   for i in sorted(ca) if ca[i]["gate"] and ca[i]["status"] == "fail"],
        "history": {"r2": a["report"]["history_exposure"], "r3": b["report"]["history_exposure"], "changed_targets": history_changes},
        "raw_inventory_names_only": {"request_files": len(request_ids), "response_files": len(response_ids),
            "request_response_id_sets_equal": request_ids == response_ids, "emitted_prediction_blind_ids": len(emitted_blind_ids),
            "raw_response_without_emitted_prediction": len(response_ids - emitted_blind_ids),
            "raw_contents_read": False},
        "limits": ["State changes compare supplied projections, not causal runtime improvements.",
                   "History exposure denominator is target/value pairs; changing observed values changes that denominator.",
                   "Semantic judgments remain unknown; source_binding remains unknown and is not authenticated by report equality.",
                   "The sealed C policy remains source S6=pass for promise and episode; newer policy is not applied retrospectively."],
        "protected_audit_files_sha256": protected,
        "protected_audit_files_unchanged": all(sha(Path(p).read_bytes()) == d for p, d in protected.items())}
    if not report["protected_audit_files_unchanged"]:
        raise ValueError("prior/current audit artifact changed during comparison")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False); stream.write("\n")
    print(json.dumps({k: report[k] for k in ("prediction_counts", "raw_inventory_names_only", "state_transitions", "common_observed_counts", "changed_checks", "history")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
