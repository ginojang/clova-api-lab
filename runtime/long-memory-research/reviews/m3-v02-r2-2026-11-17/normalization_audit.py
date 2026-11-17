#!/usr/bin/env python3
"""Offline S6 normalization audit; pure C functions and frozen synthetic K3."""
from __future__ import annotations

import argparse
import ast
import collections
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OLD = "0334e5e228fc51d2cc988f8251746947242caf7d"
NEW = "b91323f4580e17fec9431289c88e0f601dccd669"
RUNTIME = "1ba433abdc3e43fd9486d099cd854e16768912fa"
RESULT = "f31375dd8a1f8cdbaa61d167d47ee66606f007f5"
SOURCE = "memory/scripts/s6_memory_chat_eval.py"
HELPER_SHA = "d9dc4dcb316d5085ab54aa99025f58abda21a4baea8ccfe3886dbe3324deda9a"
C_PINS = {OLD: "41f37f94898fee4a77765f9bbdbaf717bf3962f0b726b30e60f2eedffa0bb9ce",
          NEW: "a2c4e4ca568b6811ba7ec06b1471682b893346948dd6e555f0c634b7caa7b8ad"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def helpers():
    path = HERE / "k3_audit.py"
    if sha(path.read_bytes()) != HELPER_SHA:
        raise ValueError("reviewed helper hash mismatch")
    spec = importlib.util.spec_from_file_location("normalization_k3_helpers", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pure_c_functions(ref):
    raw = blob(ref, SOURCE)
    if sha(raw) != C_PINS[ref]:
        raise ValueError("reviewed C scorer hash mismatch")
    names = {"score_rows", "_gold", "teeth"}
    nodes = [n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name in names]
    if len(nodes) != len(names) or {n.name for n in nodes} != names:
        raise ValueError("pure function set mismatch")
    ns = {"collections": collections, "copy": copy, "A": "assistant",
          "KINDS": {"order", "install", "design", "quote", "consult"}}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), f"{ref}:{SOURCE}#pure", "exec"), ns)
    return ns, sha(raw)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "normalization_audit.json",
                        help="New output JSON path; existing files are never overwritten.")
    args = parser.parse_args(argv)
    h = helpers()
    previous_names = ("k3_audit.py", "k3_audit.json", "k3_audit.md", "contract_v008_audit.py", "contract_v008_audit.json",
                      "raw_k3_audit.py", "raw_k3_audit.json", "raw_k3_audit.md",
                      "contract_v009_audit.py", "contract_v009_audit.json", "contract_v009_audit.md")
    previous = {name: sha((HERE / name).read_bytes()) for name in previous_names}
    old, oldsha = pure_c_functions(OLD)
    new, newsha = pure_c_functions(NEW)
    gold_info = {}
    golds = {}
    for kind in ("chat", "turn"):
        path = f"memory/data/s6_memory_{kind}_eval_v0_5/eval.jsonl"
        a, b = blob(OLD, path), blob(NEW, path)
        metadata = path.replace("eval.jsonl", "META.json")
        if a != b or blob(OLD, metadata) != blob(NEW, metadata):
            raise ValueError("gold or META changed")
        md5 = hashlib.md5(b).hexdigest()
        if md5 != h.decode(blob(NEW, metadata))["eval_md5"]:
            raise ValueError("gold MD5 mismatch")
        golds[kind] = h.rows(b)
        gold_info[kind] = {"path": path, "rows": len(golds[kind]), "sha256": sha(b), "md5": md5,
                           "gold_bytes_equal": True, "meta_bytes_equal": True}
    tpath = "memory/scripts/s6_memory_turn_eval.py"
    tbytes = blob(NEW, tpath)
    if tbytes != blob(OLD, tpath):
        raise ValueError("T source unexpectedly changed")
    teeth = new["teeth"](copy.deepcopy(golds["chat"]))
    if teeth["verdict"] != "GREEN":
        raise ValueError("C pure teeth failed")
    base = next(r for r in golds["chat"] if r["id"] == "e01")
    base_pred = new["_gold"]([base])[base["id"]]
    cases = []
    values = ["pass", "fix", "block", "unknown", "none", "lookup_error", None, "abstain", "unexpected_verdict"]
    for value in values:
        row, pred = copy.deepcopy(base), copy.deepcopy(base_pred)
        label = "missing_key" if value is None else value
        row["elda_s6"] = {} if value is None else {"1": value}
        before = json.dumps([row, pred], ensure_ascii=False, sort_keys=True)
        old_result = old["score_rows"]([row], {row["id"]: pred})
        new_result = new["score_rows"]([row], {row["id"]: pred})
        if before != json.dumps([row, pred], ensure_ascii=False, sort_keys=True):
            raise ValueError("scorer mutated diagnostic input")
        allowed = value in ("pass", "unknown", "none", None)
        source_bad = value in ("fix", "block")
        held = not allowed and not source_bad
        expected = {"rows_ok": int(allowed), "gates_n": {"did_source_bad": 1} if source_bad else {},
                    "did_s6_lookup_error": int(held)}
        observed = {"rows_ok": new_result["rows_ok"], "gates_n": new_result["gates_n"],
                    "did_s6_lookup_error": new_result["counts"].get("did_s6_lookup_error", 0)}
        if observed != expected:
            raise ValueError(f"{label}: unexpected normalized behavior {observed}")
        cases.append({"id": label, "input": row, "prediction": pred, "expected_observed": expected,
                      "old_score": old_result, "new_score": new_result, "inputs_unchanged": True})
    prior = h.decode((HERE / "raw_k3_audit.json").read_bytes())["variants"]["chat"]
    pb = blob(RESULT, prior["prediction_path"])
    if sha(pb) != prior["prediction_sha256"]:
        raise ValueError("frozen prediction SHA mismatch")
    pred = h.rows(pb)
    raw_pred = []
    for p in pred:
        raw = re.sub(r"^```(?:json)?\s*", "", p["raw"].strip(), flags=re.I)
        raw = h.decode(re.sub(r"```\s*$", "", raw))
        raw_pred.append({"id": p["id"], "rep": p["rep"], "measured": p["measured"], **raw})
    post, postruns, _, _ = h.score_summary(golds["chat"], pred, new["score_rows"], gold_info["chat"]["md5"])
    raw, rawruns, _, _ = h.score_summary(golds["chat"], raw_pred, new["score_rows"], gold_info["chat"]["md5"])
    comparison = {"stored_post_score_equal": post == h.decode(blob(RESULT, prior["saved_report_path"])),
                  "previous_post_summary_equal": post == prior["post_guard_score"],
                  "previous_post_per_run_equal": json.loads(json.dumps(postruns)) == prior["post_guard_per_run"],
                  "previous_raw_summary_equal": raw == prior["raw_input_score"],
                  "previous_raw_per_run_equal": json.loads(json.dumps(rawruns)) == prior["raw_input_per_run"]}
    if not all(comparison.values()):
        raise ValueError("frozen C K3 score changed")
    runtime_path = "elda-orchestrator/src/core/eldacore/s6chatEnd.ts"
    rb = blob(RUNTIME, runtime_path)
    report = {"old_ref": OLD, "new_ref": NEW, "runtime_ref_read_only": RUNTIME, "prediction_ref": RESULT,
              "scope": "reviewed C score_rows/_gold/teeth only; no model/API/DB/TS/upstream main/build execution",
              "source_path": SOURCE, "old_source_sha256": oldsha, "new_source_sha256": newsha,
              "gold": gold_info, "T_source_bytes_unchanged": True, "T_source_sha256": sha(tbytes),
              "T_note": "T source, gold, and frozen predictions unchanged; no unnecessary new T scorer execution.",
              "upstream_C_pure_teeth": teeth, "normalization_cases": cases,
              "frozen_C_K3": {"prediction_sha256": sha(pb), "prediction_rows": len(pred), "comparison": comparison,
                              "post_guard_summary": post, "raw_input_summary": raw},
              "runtime_source": {"path": runtime_path, "sha256": sha(rb), "lines_99_107": rb.decode().splitlines()[98:107]},
              "reason_alignment": {"lookup_error": {"contract": "did_s6_lookup_error", "runtime": "did_s6_lookup_error", "scorer_count": "did_s6_lookup_error"},
                                   "out_of_list": {"contract": "did_s6_lookup_error", "runtime": "did_s6_unexpected", "scorer_count": "did_s6_lookup_error"}},
              "limits": ["Nine analyst-created normalization cases are not model measurements or official gold.",
                         "The scorer now excludes out-of-list values; arbitrary strings no longer become eligible did sources.",
                         "Hold counts remain separate from gates and row success; normalization does not change this aggregation contract.",
                         "Scorer and runtime both exclude out-of-list strings, but runtime preserves a different reason key.",
                         "The contract explicitly allows unknown caused by late-judge failures; held does not imply automatic retry or guaranteed recovery.",
                         "Missing-key behavior was tested. Explicit JSON null is not the missing-key test; no expanded malformed-type survey was run."],
              "previous_artifact_sha256": previous,
              "previous_artifacts_unchanged": all(sha((HERE / n).read_bytes()) == v for n, v in previous.items())}
    if not report["previous_artifacts_unchanged"]:
        raise ValueError("previous artifact changed during audit")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write("\n")
    print("PASS: 9 normalization cases; C teeth GREEN; frozen C raw/post K3 unchanged; T source/gold unchanged")


if __name__ == "__main__":
    main()
