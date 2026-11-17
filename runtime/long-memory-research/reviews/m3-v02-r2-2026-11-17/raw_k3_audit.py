#!/usr/bin/env python3
"""Audit committed synthetic K3 raw/post-guard projections, without live calls.

Only hash-pinned reviewed pure Python score functions are executed. The TS
producer/guard sources are read as evidence, never imported or executed.
"""
from __future__ import annotations

import collections
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RESULT_REF = "f31375dd8a1f8cdbaa61d167d47ee66606f007f5"
SCORER_REF = "5bbf43b2d22cdf386715979668dd21b82234ba6a"
PREFIX = "elda-orchestrator/measurements/eldacore/s6_memory_20261117/"
PINS = {
    "turn": {"source_sha256": "8fb06e8ae9ead6a9b1213d89ff1225b28c8e27cd171f0e2880fa1843509a6ff2",
             "prediction": "s6_memory_turn_v05_pred_k3_2a41e14b_prompt-v0010_raw.jsonl",
             "prediction_sha256": "35187f8d59d869f6d88d7eedf8ac7db93f877eb9fda7af26488c709a7b0d43c2",
             "score": "s6_memory_turn_v05_score_k3_2a41e14b_raw.json"},
    "chat": {"source_sha256": "03cfd5927c76774eaa6a850715073a8baf4927b8e52645282c3f8b449fd98246",
             "prediction": "s6_memory_chat_v05_pred_k3_6d7325df_prompt-v0006_raw.jsonl",
             "prediction_sha256": "f4fec03db617bfdd6207208dba2abed32fa8d1a8d7d0a0ca936f7f924704bd5a",
             "score": "s6_memory_chat_v05_score_k3_6d7325df.json"},
}
HELPER_SHA256 = "d9dc4dcb316d5085ab54aa99025f58abda21a4baea8ccfe3886dbe3324deda9a"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def helpers():
    path = Path(__file__).with_name("k3_audit.py")
    if sha(path.read_bytes()) != HELPER_SHA256:
        raise ValueError("reviewed local helper SHA256 mismatch")
    spec = importlib.util.spec_from_file_location("k3_pure_helpers", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # Reviewed stdlib-only module; main not called.
    return module


def raw_json(h, value):
    if not isinstance(value, str):
        raise ValueError("missing/nonstring raw output")
    text = re.sub(r"^```(?:json)?\s*", "", value.strip(), flags=re.I)
    text = re.sub(r"```\s*$", "", text)
    parsed = h.decode(text)
    if not isinstance(parsed, dict):
        raise ValueError("raw output is not an object")
    return parsed


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def dropped_did(raw, kept):
    remaining = collections.Counter(canonical(item) for item in kept)
    removed = []
    for item in raw:
        key = canonical(item)
        if remaining[key]:
            remaining[key] -= 1
        else:
            removed.append(item)
    if any(remaining.values()):
        raise ValueError("post-guard did is not a sub-multiset of raw did")
    return removed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "raw_k3_audit.json",
                        help="New output JSON path; existing files are never overwritten.")
    args = parser.parse_args(argv)
    h = helpers()
    protected = [Path(__file__).with_name(n) for n in ("k3_audit.py", "k3_audit.json", "k3_audit.md")]
    protected_before = {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in protected}
    report = {"result_ref": RESULT_REF, "scorer_ref": SCORER_REF,
              "scope": "committed synthetic data and pure scorers only; no model/API/DB/TS execution",
              "scoring_helper_sha256": HELPER_SHA256, "variants": {}}
    for kind, pin in PINS.items():
        spath = f"memory/scripts/s6_memory_{kind}_eval.py"
        source = blob(SCORER_REF, spath)
        if sha(source) != pin["source_sha256"]:
            raise ValueError("scorer source pin mismatch")
        score = h.pure_scorer(source, kind, SCORER_REF + ":" + spath)
        gpath = f"memory/data/s6_memory_{kind}_eval_v0_5/eval.jsonl"
        gb = blob(SCORER_REF, gpath); gold = h.rows(gb)
        md5 = hashlib.md5(gb).hexdigest()
        indexed = {row["id"]: row for row in gold}
        pb = blob(RESULT_REF, PREFIX + pin["prediction"])
        if sha(pb) != pin["prediction_sha256"]:
            raise ValueError("prediction pin mismatch")
        predictions = h.rows(pb)
        sb = blob(RESULT_REF, PREFIX + pin["score"]); saved = h.decode(sb)
        post, post_runs, post_failures, reps = h.score_summary(gold, predictions, score, md5)
        if post != saved:
            raise ValueError(f"{kind}: saved post-guard score mismatch")
        parsed = [raw_json(h, row["raw"]) for row in predictions]
        raw_predictions = []
        for row, raw in zip(predictions, parsed):
            if "id" in raw or "rep" in raw:
                raise ValueError("unexpected raw identifier")
            raw_predictions.append({"id": row["id"], "rep": row["rep"], "measured": row["measured"], **copy.deepcopy(raw)})
        raw_score, raw_runs, raw_failures, raw_reps = h.score_summary(gold, raw_predictions, score, md5)
        if reps != raw_reps:
            raise ValueError("rep mismatch")
        notes = []
        focus = []
        for rep in reps:
            pairs = [(row, raw) for row, raw in zip(predictions, parsed) if row["rep"] == rep]
            note = {"rep": rep, "observed_rows": len(pairs),
                    "explicit_unmeasured": sum(row.get("measured") is False for row, _ in pairs)}
            if kind == "turn":
                note.update({"not_ok": sum(row.get("ok") is False for row, _ in pairs),
                             "drop_counts": dict(collections.Counter(d["why"] for row, _ in pairs for d in row.get("dropped", []))),
                             "runtime_downgraded_markers": sum(bool(o.get("downgraded")) for row, _ in pairs for o in row.get("ops", [])),
                             "raw_ops": sum(len(raw.get("ops", [])) for _, raw in pairs),
                             "post_ops": sum(len(row.get("ops", [])) for row, _ in pairs)})
                for row, raw in pairs:
                    if row["id"] in {"k09", "s01", "s02", "j01"} or any(f["id"] == row["id"] and f["rep"] == rep for f in post_failures):
                        focus.append({"id": row["id"], "rep": rep, "raw": raw,
                                      "post_ops": row["ops"], "dropped": row["dropped"],
                                      "gold_expect": indexed[row["id"]]["expect"]})
            else:
                removed = []
                raw_total = kept_total = 0
                for row, raw in pairs:
                    if row["raw_promises"] != raw.get("promises", []):
                        raise ValueError("raw_promises disagrees with preserved raw JSON")
                    before = ((raw.get("episode") or {}).get("did") or [])
                    after = ((row.get("episode") or {}).get("did") or [])
                    raw_total += len(before); kept_total += len(after)
                    for item in before:
                        if type(item.get("turn_index")) is not int:
                            raise ValueError("noninteger raw did source; needs separate typed analysis")
                    for item in dropped_did(before, after):
                        goldrow = indexed[row["id"]]; ti = item["turn_index"]
                        turn = next((t for t in goldrow["turns"] if t["turn_index"] == ti), None)
                        removed.append({"id": row["id"], "rep": rep, "did": item,
                                        "source_speaker": None if turn is None else turn["speaker"],
                                        "source_s6": goldrow["elda_s6"].get(str(ti))})
                    if row["id"] in {"p02", "x02", "p03"}:
                        focus.append({"id": row["id"], "rep": rep, "raw": raw,
                                      "post_episode": row["episode"], "post_promises": row["promises"],
                                      "gold_expect": indexed[row["id"]]["expect"]})
                note.update({"raw_did": raw_total, "kept_did": kept_total, "removed_did": removed,
                             "raw_promises": sum(len(raw.get("promises", [])) for _, raw in pairs),
                             "kept_promises": sum(len(row.get("promises", [])) for row, _ in pairs),
                             "promise_projection_changed_ids": [row["id"] for row, raw in pairs if row["promises"] != raw.get("promises", [])]})
            notes.append(note)
        report["variants"][kind] = {
            "source_path": spath, "source_sha256": sha(source),
            "gold_path": gpath, "gold_sha256": sha(gb), "gold_md5": md5,
            "prediction_path": PREFIX + pin["prediction"], "prediction_sha256": sha(pb),
            "saved_report_path": PREFIX + pin["score"], "saved_report_sha256": sha(sb),
            "prediction_rows": len(predictions), "unique_ids": len(gold), "rep_labels": reps,
            "raw_json_parsed_rows": len(parsed), "post_guard_saved_score_exact_json_equal": True,
            "post_guard_score": post, "post_guard_per_run": post_runs, "post_guard_failures": post_failures,
            "raw_input_score": raw_score, "raw_input_per_run": raw_runs, "raw_input_failures": raw_failures,
            "per_rep_observations": notes, "focus": focus,
            "raw_score_scope": "Same current scorer fed parsed raw model fields. Scorer-internal filtering/normalization still applies; not a separately authored semantic judge."}
    report["limits"] = [
        "C saved 13/13x3 scores filtered episode/promise fields, not every raw proposal.",
        "Current C gold v0.5 changed p02/x02 policy labels; do not compare directly with v0.4 as model improvement.",
        "T saved _raw score also consumes filtered ops; the filename means raw is preserved, not raw is the scored field.",
        "K3 is repeated known synthetic cases; majority is boolean row-pass majority, not a model-output vote.",
        "Scorer bool/float turn-index aliases were separately demonstrated in contract_v008_audit.json; all did source indices in these C raw outputs are integers.",
        "Neither pure scoring nor stored raw data establishes actual DB persistence, deployment, or operational reliability."]
    report["previous_k3_artifacts_unchanged"] = all(sha(p.read_bytes()) == protected_before[str(p.relative_to(ROOT))] for p in protected)
    report["previous_k3_artifact_sha256"] = protected_before
    if not report["previous_k3_artifacts_unchanged"]:
        raise ValueError("previous K3 artifact changed during audit")
    out = args.output
    with out.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write("\n")
    for kind, value in report["variants"].items():
        print(kind, "post", value["post_guard_score"]["per_run_rows_ok"], "raw", value["raw_input_score"]["per_run_rows_ok"])
    print("PASS: saved reports exactly reproduced; previous K3 artifacts unchanged")


if __name__ == "__main__":
    main()
