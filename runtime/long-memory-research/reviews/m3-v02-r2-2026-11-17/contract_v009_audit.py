#!/usr/bin/env python3
"""Pinned, offline v0.009 scorer audit; no external main/build/TS/live calls."""
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
OLD = "5bbf43b2d22cdf386715979668dd21b82234ba6a"
NEW = "0334e5e228fc51d2cc988f8251746947242caf7d"
RUNTIME = "b79015192a9055bca4902e8388e66707947c7c8b"
RESULT = "f31375dd8a1f8cdbaa61d167d47ee66606f007f5"
PREFIX = "elda-orchestrator/measurements/eldacore/s6_memory_20261117/"
PINS = {
    (OLD, "chat"): "03cfd5927c76774eaa6a850715073a8baf4927b8e52645282c3f8b449fd98246",
    (OLD, "turn"): "8fb06e8ae9ead6a9b1213d89ff1225b28c8e27cd171f0e2880fa1843509a6ff2",
    (NEW, "chat"): "41f37f94898fee4a77765f9bbdbaf717bf3962f0b726b30e60f2eedffa0bb9ce",
    (NEW, "turn"): "351aed4057417e039dba2bef4df67ad53338b381aa6cb0782b26f47d05c38eff",
}
HELPER_SHA256 = "d9dc4dcb316d5085ab54aa99025f58abda21a4baea8ccfe3886dbe3324deda9a"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def load_helpers():
    path = Path(__file__).with_name("k3_audit.py")
    if sha(path.read_bytes()) != HELPER_SHA256:
        raise ValueError("reviewed helper changed")
    spec = importlib.util.spec_from_file_location("v009_k3_helpers", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def functions(ref, kind):
    path = f"memory/scripts/s6_memory_{kind}_eval.py"
    raw = blob(ref, path)
    if sha(raw) != PINS[ref, kind]:
        raise ValueError("reviewed scorer SHA mismatch")
    names = {"score_rows", "_gold", "teeth"}
    if kind == "turn":
        names |= {"_match", "_vmatch"}
    nodes = [n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name in names]
    if len(nodes) != len(names) or {n.name for n in nodes} != names:
        raise ValueError("pure function set mismatch")
    ns = {"collections": collections, "copy": copy, "A": "assistant",
          "KINDS": {"order", "install", "design", "quote", "consult"},
          "WRITE": {"ADD", "SUPERSEDE", "CONTEST"}}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), f"{ref}:{path}#pure", "exec"), ns)
    return ns


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "contract_v009_audit.json",
                        help="New output path; existing files are never overwritten.")
    args = parser.parse_args(argv)
    h = load_helpers()
    previous_names = ("k3_audit.py", "k3_audit.json", "k3_audit.md", "contract_v008_audit.py",
                      "contract_v008_audit.json", "raw_k3_audit.py", "raw_k3_audit.json", "raw_k3_audit.md")
    previous = {name: sha((HERE / name).read_bytes()) for name in previous_names}
    prior = h.decode((HERE / "raw_k3_audit.json").read_bytes())
    prior_cases = h.decode((HERE / "contract_v008_audit.json").read_bytes())["synthetic_cases"]
    modules = {(ref, kind): functions(ref, kind) for ref in (OLD, NEW) for kind in ("turn", "chat")}
    allgold, goldmeta, k3, teeth = {}, {}, {}, {}
    for kind in ("turn", "chat"):
        path = f"memory/data/s6_memory_{kind}_eval_v0_5/eval.jsonl"
        before, after = blob(OLD, path), blob(NEW, path)
        if before != after:
            raise ValueError("gold changed")
        meta_old = blob(OLD, path.replace("eval.jsonl", "META.json"))
        meta_new = blob(NEW, path.replace("eval.jsonl", "META.json"))
        if meta_old != meta_new:
            raise ValueError("gold metadata changed")
        gold = h.rows(after); allgold[kind] = {r["id"]: r for r in gold}
        md5 = hashlib.md5(after).hexdigest()
        if md5 != h.decode(meta_new)["eval_md5"]:
            raise ValueError("metadata MD5 mismatch")
        goldmeta[kind] = {"path": path, "rows": len(gold), "sha256": sha(after), "md5": md5,
                          "old_new_bytes_equal": True, "meta_old_new_bytes_equal": True}
        teeth[kind] = modules[NEW, kind]["teeth"](copy.deepcopy(gold))
        if teeth[kind]["verdict"] != "GREEN":
            raise ValueError("upstream pure teeth failed")
        v = prior["variants"][kind]
        pb = blob(RESULT, v["prediction_path"])
        if sha(pb) != v["prediction_sha256"]:
            raise ValueError("frozen prediction SHA mismatch")
        pred = h.rows(pb)
        raw_pred = []
        for row in pred:
            raw = re.sub(r"^```(?:json)?\s*", "", row["raw"].strip(), flags=re.I)
            raw = h.decode(re.sub(r"```\s*$", "", raw))
            raw_pred.append({"id": row["id"], "rep": row["rep"], "measured": row["measured"], **raw})
        post, postruns, _, _ = h.score_summary(gold, pred, modules[NEW, kind]["score_rows"], md5)
        raw, rawruns, _, _ = h.score_summary(gold, raw_pred, modules[NEW, kind]["score_rows"], md5)
        checks = {"saved_post_report_equal": post == h.decode(blob(RESULT, v["saved_report_path"])),
                  "prior_post_summary_equal": post == v["post_guard_score"],
                  "prior_post_per_run_equal": json.loads(json.dumps(postruns)) == v["post_guard_per_run"],
                  "prior_raw_summary_equal": raw == v["raw_input_score"],
                  "prior_raw_per_run_equal": json.loads(json.dumps(rawruns)) == v["raw_input_per_run"]}
        if not all(checks.values()):
            raise ValueError(f"frozen {kind} K3 changed: {checks}")
        k3[kind] = {"prediction_path": v["prediction_path"], "prediction_sha256": sha(pb),
                    "prediction_rows": len(pred), "comparison": checks,
                    "post_guard_summary": post, "raw_input_summary": raw}
    cases = []

    def case(name, kind, row, prediction, expected_new, expected_old_ok=None):
        results = {}
        for ref in (OLD, NEW):
            x, p = copy.deepcopy(row), copy.deepcopy(prediction)
            original = json.dumps([x, p], ensure_ascii=False, sort_keys=True)
            result = modules[ref, kind]["score_rows"]([x], {x["id"]: p})
            if original != json.dumps([x, p], ensure_ascii=False, sort_keys=True):
                raise ValueError("scorer mutated diagnostic input")
            results["old" if ref == OLD else "new"] = result
        observed = {"rows_ok": results["new"]["rows_ok"], "gates_n": results["new"]["gates_n"],
                    "held": results["new"]["counts"].get("did_held_lookup_error", 0),
                    "downgraded": results["new"]["counts"].get("downgraded_no_correction_evidence", 0)}
        if observed != expected_new:
            raise ValueError(f"{name}: unexpected result {observed!r}")
        if expected_old_ok is not None and results["old"]["rows_ok"] != expected_old_ok:
            raise ValueError(f"{name}: old baseline mismatch")
        cases.append({"id": name, "kind": kind, "input": row, "prediction": prediction,
                      "expected_new_observed": expected_new, "old_score": results["old"],
                      "new_score": results["new"], "inputs_unchanged": True})

    def expect(ok, gates=None, held=0, downgraded=0):
        return {"rows_ok": ok, "gates_n": gates or {}, "held": held, "downgraded": downgraded}

    for oldcase in prior_cases:
        if oldcase["id"] in ("boolean_source_alias_bypasses_fix", "float_source_alias_bypasses_fix"):
            case("C_" + oldcase["id"], "chat", oldcase["input"], oldcase["prediction"],
                 expect(0, {"did_no_source": 1}), 1)
    for label, value in (("boolean", True), ("float", 1.0)):
        row = copy.deepcopy(allgold["chat"]["p01"])
        p = modules[NEW, "chat"]["_gold"]([row])[row["id"]]
        p["promises"][0]["evidence"]["turn_index"] = value
        case("C_promise_" + label, "chat", row, p, expect(0, {"promise_not_pass": 1}), 1)
        for field in ("evidence", "correction_evidence"):
            row = copy.deepcopy(allgold["turn"]["s01"])
            row["turns"][0]["turn_index"] = 1
            p = modules[NEW, "turn"]["_gold"]([row])[row["id"]]
            p["ops"][0][field]["turn_index"] = value
            expected = (expect(0, {"evidence_not_human": 1}) if field == "evidence"
                        else expect(0, {"false_memory": 1}, downgraded=1))
            case("T_" + field + "_" + label, "turn", row, p, expected, 1)
    base = copy.deepcopy(allgold["chat"]["e01"])
    base_pred = modules[NEW, "chat"]["_gold"]([base])[base["id"]]
    for value in ("pass", "unknown", "none", "unexpected_verdict", "abstain"):
        row = copy.deepcopy(base); row["elda_s6"]["1"] = value
        case("C_verdict_" + value, "chat", row, copy.deepcopy(base_pred), expect(1), 1)
    row = copy.deepcopy(base); row["elda_s6"] = {}
    case("C_missing_verdict", "chat", row, copy.deepcopy(base_pred), expect(1), 1)
    row = copy.deepcopy(base); row["elda_s6"]["1"] = "lookup_error"
    case("C_lookup_error_required_kind_lost", "chat", row, copy.deepcopy(base_pred), expect(0, held=1), 1)
    row["turns"].append({"turn_index": 3, "speaker": "assistant", "origin_kind": "elda", "text": "간판 시안 세 가지를 새로 준비했어요"})
    row["elda_s6"]["3"] = "pass"
    p = copy.deepcopy(base_pred); p["episode"]["did"][0]["turn_index"] = 3
    p["episode"]["did"].append({"kind": "quote", "what": "synthetic held proposal", "turn_index": 1})
    case("C_lookup_error_with_other_valid_did", "chat", row, p, expect(1, held=1), 1)
    runtime_path = "elda-orchestrator/src/core/eldacore/s6chatEnd.ts"
    runtime = blob(RUNTIME, runtime_path).decode()
    lines = runtime.splitlines()
    report = {"old_ref": OLD, "new_ref": NEW, "runtime_ref": RUNTIME, "prediction_ref": RESULT,
              "scope": "Pure AST-selected score_rows/_gold/teeth and T match helpers; no model/API/DB/runtime/module main/build execution",
              "scorer_sha256": {kind: PINS[NEW, kind] for kind in ("turn", "chat")},
              "gold": goldmeta, "upstream_pure_teeth": teeth, "frozen_k3_comparison": k3,
              "synthetic_cases": cases, "runtime_source": {"path": runtime_path, "sha256": sha(runtime.encode()),
                  "did_guard_lines_99_105": lines[98:105]},
              "reason_names": {"contract": "did_s6_lookup_error", "runtime": "did_source_lookup_error", "scorer_count": "did_held_lookup_error"},
              "limits": ["Unknown and none remain accepted by the revised policy; lookup_error is excluded from kept did.",
                         "Neither Python scorer nor b790 runtime implements the contract's pass/unknown/none allowlist: other verdict strings pass.",
                         "Scorer lookup_error increments a hold counter, not a gate and not unconditional row failure. A row with sufficient other valid did can pass with held=1.",
                         "C upstream teeth covers bool through two turn-1 fix cases, not its float branch; added diagnostic checks both types. T added teeth covers float evidence; added diagnostics cover bool and typed correction evidence.",
                         "TypeScript cannot distinguish parsed numeric 1.0 from 1; Python strict-int rejection is not byte-for-byte runtime parity.",
                         "Identical scores on frozen K3 do not measure new runtime rollout or exercise lookup_error in those predictions."],
              "previous_artifact_sha256": previous,
              "previous_artifacts_unchanged": all(sha((HERE / n).read_bytes()) == d for n, d in previous.items())}
    if not report["previous_artifacts_unchanged"]:
        raise ValueError("previous artifact changed during audit")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write("\n")
    print(f"PASS: {len(cases)} diagnostics; T/C pure teeth GREEN; frozen raw/post K3 unchanged")


if __name__ == "__main__":
    main()
