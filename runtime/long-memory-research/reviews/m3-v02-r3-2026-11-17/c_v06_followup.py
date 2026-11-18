#!/usr/bin/env python3
"""C v0.6 unique-pass-source follow-up; pinned pure functions, no live calls."""
from __future__ import annotations

import argparse
import ast
import collections
import copy
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OLD = "80b386fb449bac1e05d78451c3033c4716617803"
NEW = "542bd9a9b29c9f10ea1fe5fb24b20a195210f567"
SOURCE = "memory/scripts/s6_memory_chat_eval.py"
GOLD = "memory/data/s6_memory_chat_eval_v0_6/eval.jsonl"
PINS = {OLD: "717c9f2d33e222f19e152fc56a58a7898c822333a3fc589e90683aefd0b6a094",
        NEW: "583dc189ca772c3484d1d5ce0d9636d16301b73ab66ea0bcd8570cbdd43e1df4"}
PRIOR_SHA = "b5e91c1a6f7ed95d20e51472644643e5c563c2bc2cfa083ae3c33b1b8670bfeb"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def functions(ref):
    source = blob(ref, SOURCE)
    if sha(source) != PINS[ref]:
        raise ValueError("reviewed source hash mismatch")
    names = {"score_rows", "_gold"}
    nodes = [n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name in names]
    if len(nodes) != 2 or {n.name for n in nodes} != names:
        raise ValueError("pure function set mismatch")
    ns = {"collections": collections, "A": "assistant", "KINDS": {"order", "install", "design", "quote", "consult"}}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), f"{ref}:{SOURCE}#pure", "exec"), ns)
    return ns, ast.dump(next(n for n in nodes if n.name == "score_rows"), include_attributes=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "c_v06_followup.json",
                        help="New output path; existing files are never overwritten.")
    args = parser.parse_args(argv)
    protected_names = ("c_v06_audit.py", "c_v06_audit.json", "c_v06_audit.md", "score_audit.json",
                       "score_audit.report.json", "score_audit.md", "comparison.py", "comparison.json")
    protected = {name: sha((HERE / name).read_bytes()) for name in protected_names}
    prior_bytes = (HERE / "c_v06_audit.json").read_bytes()
    if sha(prior_bytes) != PRIOR_SHA:
        raise ValueError("previous diagnostic artifact changed")
    prior = json.loads(prior_bytes)
    old, old_ast = functions(OLD)
    new, new_ast = functions(NEW)
    if old_ast != new_ast:
        raise ValueError("score_rows AST changed")
    gb = blob(NEW, GOLD)
    if gb != blob(OLD, GOLD):
        raise ValueError("v0.6 gold changed")
    metadata = GOLD.replace("eval.jsonl", "META.json")
    if blob(NEW, metadata) != blob(OLD, metadata):
        raise ValueError("v0.6 META changed")
    gold = [json.loads(x) for x in gb.decode().split("\n") if x]
    generated = new["_gold"](copy.deepcopy(gold))
    if generated != old["_gold"](copy.deepcopy(gold)):
        raise ValueError("actual fifteen generated predictions changed")
    score = new["score_rows"](copy.deepcopy(gold), copy.deepcopy(generated))
    if score["rows_ok"] != 15 or score["gates_n"]:
        raise ValueError("actual fifteen self-score mismatch")
    results = []
    for case in prior["diagnostics"]:
        row, p = copy.deepcopy(case["input"]), copy.deepcopy(case["prediction"])
        before = canonical([row, p])
        old_result = old["score_rows"]([row], {row["id"]: p})
        if canonical(old_result) != canonical(case["score"]):
            raise ValueError("prior diagnostic baseline mismatch")
        if case["id"].endswith("block_source_same_text_rejected"):
            new_result = new["score_rows"]([row], {row["id"]: p})
            if new_result["rows_ok"] != 0 or new_result["gates_n"] != {"promise_not_pass": 1}:
                raise ValueError("blocked supplied prediction no longer rejected")
            outcome = {"kind": "scored_supplied_prediction", "score": new_result}
        else:
            expected_hits = 2 if case["id"] == "incidental_keyword_pass_selected_before_real_promise" else 0
            try:
                new["_gold"]([row])
            except ValueError as error:
                message = str(error)
                if f"{expected_hits}개" not in message:
                    raise ValueError("unexpected _gold error") from error
                outcome = {"kind": "gold_dataset_error", "error_type": "ValueError", "message": message,
                           "matching_pass_keyword_turns": expected_hits}
            else:
                raise ValueError("invalid/ambiguous fixture did not raise")
        if before != canonical([row, p]):
            raise ValueError("pure functions mutated previous inputs")
        results.append({"id": case["id"], "input": row, "prior_prediction": p,
                        "old_score": old_result, "new_outcome": outcome, "inputs_unchanged": True})
    incidental = next(c for c in prior["diagnostics"] if c["id"] == "incidental_keyword_pass_selected_before_real_promise")
    row = copy.deepcopy(incidental["input"])
    row["elda_s6"]["5"] = "unknown"  # Turn 3 remains the only keyword-containing pass assistant turn.
    p = new["_gold"]([row])[row["id"]]
    result = new["score_rows"]([row], {row["id"]: p})
    if p["promises"][0]["evidence"]["turn_index"] != 3 or result["rows_ok"] != 1 or result["gates_n"]:
        raise ValueError("unique negated-pass diagnostic changed unexpectedly")
    boundary = {"id": "unique_negated_keyword_pass_still_selected", "analyst_created": True,
                "input": row, "generated_prediction": p, "score": result,
                "meaning": "Unique lexical pass evidence is not semantic promise entailment; this is not an error claim about the actual fifteen rows."}
    report = {"old_ref": OLD, "new_ref": NEW, "source_path": SOURCE, "source_sha256": PINS[NEW],
              "scope": "hash-pinned AST _gold/score_rows only; no module/main/build/teeth/K3/model/API/DB/runtime execution",
              "gold_path": GOLD, "gold_sha256": sha(gb), "gold_md5": hashlib.md5(gb).hexdigest(),
              "gold_and_META_bytes_unchanged": True, "score_rows_AST_unchanged": True,
              "actual_fifteen_generated_predictions_unchanged": True, "actual_fifteen_self_score": score,
              "actual_added_sources": {i: {"promise": [q["evidence"]["turn_index"] for q in generated[i]["promises"]],
                                            "did": [d["turn_index"] for d in generated[i]["episode"]["did"]]} for i in ("d01", "d02")},
              "prior_diagnostic_artifact_sha256": PRIOR_SHA, "prior_five_diagnostics": results,
              "additional_boundary": boundary,
              "limits": ["No matching pass fallback and multiple lexical matching pass sources now raise dataset errors, not model failures.",
                         "Exactly one matching pass turn is a synthetic-gold construction constraint, not a runtime rule forbidding repeated legitimate promises.",
                         "A sole keyword-containing denial can still be selected and self-score as correct; the lexical change does not add semantic judgment.",
                         "Current fifteen rows and scores remain valid under the supplied dataset/scorer contract; no holdout/generalization or live K3 result is claimed."],
              "protected_prior_artifact_sha256": protected,
              "protected_prior_artifacts_unchanged": all(sha((HERE / n).read_bytes()) == d for n, d in protected.items())}
    if not report["protected_prior_artifacts_unchanged"]:
        raise ValueError("previous artifact changed")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write("\n")
    print("PASS: actual15 unchanged; prior5 checked; 0/2 matching sources error; unique negated-pass boundary retained")


if __name__ == "__main__":
    main()
