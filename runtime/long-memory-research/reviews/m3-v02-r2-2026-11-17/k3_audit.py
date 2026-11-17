#!/usr/bin/env python3
"""Offline audit: only reviewed pure score functions, never upstream main/build."""

import ast
import collections
import copy
import hashlib
import json
from pathlib import Path
import subprocess


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
RESULT_REF = "4449c90077221844cc833b2d2a2a0970fcd94ba7"
OLD_REF = "fa6d99df6ddaf500aaeabd8fdb3ef1b83a6ed0d8"
NEW_REF = "54e8c18f7600e2d0c94f76b5140ceb3aa499afe1"
PREFIX = "elda-orchestrator/measurements/eldacore/s6_memory_20261117/"
VARIANTS = [
    ("T_v0009", "turn", "v05", "23b15df4", "v0009", OLD_REF),
    ("T_v0010", "turn", "v05", "2a41e14b", "v0010", NEW_REF),
    ("C_v0004", "chat", "v04", "c02947e1", "v0004", OLD_REF),
    ("C_v0005", "chat", "v04", "8064fd2b", "v0005", NEW_REF),
]


def blob(ref, path):
    return subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT)


def hashes(raw):
    return {"sha256": hashlib.sha256(raw).hexdigest(), "md5": hashlib.md5(raw).hexdigest()}


def unique(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"duplicate JSON key {key}")
        out[key] = value
    return out


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique)


def rows(raw):
    return [decode(line) for line in raw.decode("utf-8").split("\n") if line.strip()]


def pure_scorer(source, kind, origin):
    wanted = {"score_rows", "_match", "_vmatch"} if kind == "turn" else {"score_rows"}
    functions = [node for node in ast.parse(source, filename=origin).body
                 if isinstance(node, ast.FunctionDef) and node.name in wanted]
    assert {node.name for node in functions} == wanted
    # Do not import/evaluate top-level constants, dataset builder, selftests,
    # command-line parser, filesystem writes, or upstream main.
    module = ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[]))
    scope = {"collections": collections, "WRITE": {"ADD", "SUPERSEDE", "CONTEST"},
             "A": "assistant", "KINDS": {"order", "install", "design", "quote", "consult"}}
    exec(compile(module, origin + "#pure_functions", "exec"), scope)
    return scope["score_rows"]


def score_summary(ev, predictions, score, eval_md5):
    groups = collections.defaultdict(list)
    expected_ids = {row["id"] for row in ev}
    assert len(expected_ids) == len(ev)
    for row in predictions:
        assert row["id"] in expected_ids
        groups[row["id"]].append(row)
    assert set(groups) == expected_ids
    assert all(len(group) == 3 for group in groups.values())
    sequences = {tuple(row["rep"] for row in group) for group in groups.values()}
    assert len(sequences) == 1
    repetition_labels = list(next(iter(sequences)))
    assert len(set(repetition_labels)) == 3
    assert repetition_labels == sorted(repetition_labels)
    original = copy.deepcopy(predictions)
    per_run = [score(ev, {identifier: group[k] for identifier, group in groups.items()}) for k in range(3)]
    assert predictions == original, "pure scoring mutated submitted predictions"
    votes = collections.defaultdict(list)
    for result in per_run:
        for identifier, ok in result["_per"]:
            votes[identifier].append(ok)
    summary = {"K": 3, "per_run_rows_ok": [result["rows_ok"] for result in per_run],
               "rows": len(ev), "majority_ok": sum(sum(value) * 2 > len(value) for value in votes.values()),
               "gates_n_per_run": [result["gates_n"] for result in per_run],
               "run0": {key: value for key, value in per_run[0].items() if key != "_per"},
               "eval_md5": eval_md5}
    failures = []
    indexed = {row["id"]: row for row in ev}
    for k, result in enumerate(per_run):
        for identifier, ok in result["_per"]:
            if not ok:
                prediction = groups[identifier][k]
                individual = score([indexed[identifier]], {identifier: prediction})
                failures.append({"id": identifier, "rep": repetition_labels[k],
                                 "gold_expect": indexed[identifier]["expect"],
                                 "submitted_prediction": prediction,
                                 "score": individual})
    return summary, per_run, failures, repetition_labels


def main():
    output = HERE / "k3_audit.json"
    if output.exists():
        raise FileExistsError("audit output exists; never overwrite")
    gold_info = {}
    for kind, version in (("turn", "0_5"), ("chat", "0_4")):
        path = f"memory/data/s6_memory_{kind}_eval_v{version}/eval.jsonl"
        meta_path = path.replace("eval.jsonl", "META.json")
        old, new = blob(OLD_REF, path), blob(NEW_REF, path)
        old_meta, new_meta = decode(blob(OLD_REF, meta_path)), decode(blob(NEW_REF, meta_path))
        assert old == new, f"gold changed: {path}"
        assert hashes(old)["md5"] == old_meta["eval_md5"] == new_meta["eval_md5"]
        gold_info[kind] = {"path": path, "old_new_bytes_equal": True, **hashes(old),
                           "rows": len(rows(old)), "meta": new_meta}
    audit = {"result_source_ref": RESULT_REF, "old_scorer_ref": OLD_REF, "new_scorer_ref": NEW_REF,
             "gold": gold_info, "variants": {}, "network_calls": 0, "model_calls": 0, "database_calls": 0,
             "upstream_main_or_build_executed": False,
             "execution": "AST-selected reviewed pure score_rows/_match/_vmatch definitions only"}
    for label, kind, version, config, prompt, source_ref in VARIANTS:
        source_path = f"memory/scripts/s6_memory_{kind}_eval.py"
        source = blob(source_ref, source_path)
        score = pure_scorer(source, kind, source_ref + ":" + source_path)
        gold_raw = blob(source_ref, gold_info[kind]["path"])
        ev = rows(gold_raw)
        stem = f"s6_memory_{kind}_{version}"
        pred_path = PREFIX + f"{stem}_pred_k3_{config}_prompt-{prompt}.jsonl"
        saved_path = PREFIX + f"{stem}_score_k3_{config}.json"
        pred_raw, saved_raw = blob(RESULT_REF, pred_path), blob(RESULT_REF, saved_path)
        predictions, saved = rows(pred_raw), decode(saved_raw)
        summary, per_run, failures, repetitions = score_summary(ev, predictions, score, gold_info[kind]["md5"])
        assert summary == saved, f"saved report mismatch: {label}"
        per_rep_notes = []
        for rep in repetitions:
            selected = [row for row in predictions if row["rep"] == rep]
            notes = {"rep": rep, "observed_rows": len(selected),
                     "explicit_unmeasured": sum(row.get("measured") is False for row in selected),
                     "not_ok": sum(row.get("ok") is False for row in selected)}
            if kind == "turn":
                notes["dropped_reason_counts"] = dict(collections.Counter(
                    str(drop.get("why", drop.get("reason", "<missing>")))
                    for row in selected for drop in row.get("dropped", [])))
                notes["submitted_supersede_without_matching_correction_span"] = {row["id"]: sum(
                    op.get("op") == "SUPERSEDE" and not (
                        (op.get("correction_evidence") or {}).get("t") and
                        (op.get("correction_evidence") or {})["t"] in next(
                            (turn["text"] for gold in ev if gold["id"] == row["id"] for turn in gold["turns"]
                             if turn["turn_index"] == (op.get("correction_evidence") or {}).get("turn_index")), ""))
                    for op in row.get("ops", [])) for row in selected}
            else:
                notes["raw_promises"] = sum(len(row.get("raw_promises", [])) for row in selected)
                notes["scored_promises"] = sum(len(row.get("promises", [])) for row in selected)
                notes["raw_scored_promise_different_ids"] = [row["id"] for row in selected
                    if row.get("raw_promises") != row.get("promises")]
            per_rep_notes.append(notes)
        focus = [row for row in predictions if kind == "turn" and row["id"] in {"k09", "s01", "s02", "j01"}]
        audit["variants"][label] = {"scorer_ref": source_ref, "scorer_path": source_path,
            "scorer_hashes": hashes(source), "prediction_path": pred_path, "prediction_hashes": hashes(pred_raw),
            "saved_report_path": saved_path, "saved_report_hashes": hashes(saved_raw),
            "saved_report_exact_json_equality": summary == saved, "recomputed_summary": summary,
            "prediction_rows": len(predictions), "unique_ids": len(ev), "rep_labels": repetitions,
            "per_run": per_run, "per_rep_notes": per_rep_notes, "failure_rows": failures,
            "focus_predictions": focus,
            "majority_definition": "majority of per-case boolean rows_ok; not a voted model output"}
    audit["chat_scorer_old_new_bytes_equal"] = (
        blob(OLD_REF, "memory/scripts/s6_memory_chat_eval.py") ==
        blob(NEW_REF, "memory/scripts/s6_memory_chat_eval.py"))
    audit["limits"] = [
        "A case repeated three times is one evaluation case, not three independent cases.",
        "Turn ops and chat promises are submitted/scored projections; dropped/raw fields are separate.",
        "Zero named gate hits does not imply zero value errors, missing operations, or semantic errors.",
        "Source correction-evidence checks are lexical; no semantic judgment is supplied here.",
        "This small synthetic T/C pretest is separate from the 84-checkpoint M3 execution and cannot certify it."]
    with output.open("x", encoding="utf-8") as stream:
        json.dump(audit, stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"gold": {key: {k: v for k, v in value.items() if k != "meta"} for key, value in gold_info.items()},
        "variants": {key: {"exact": value["saved_report_exact_json_equality"],
                            "rows_ok": value["recomputed_summary"]["per_run_rows_ok"],
                            "majority": value["recomputed_summary"]["majority_ok"],
                            "failed_ids": [[row["id"] for row in value["failure_rows"] if row["rep"] == rep]
                                           for rep in value["rep_labels"]],
                            "per_rep_notes": value["per_rep_notes"]}
                     for key, value in audit["variants"].items()}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
