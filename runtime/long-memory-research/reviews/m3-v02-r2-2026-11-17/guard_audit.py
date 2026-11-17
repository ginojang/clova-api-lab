#!/usr/bin/env python3
"""Recheck the ten saved synthetic guard cases; no model, DB, or runtime calls.

Only the three reviewed pure functions from hash-pinned Git blobs are loaded.
The original scorer module, CLI, build function, and imports are never executed.
This checks saved diagnostics, not production behavior or an official gold set.
"""

from __future__ import annotations

import argparse
import ast
import collections
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys


SOURCE_PATH = "memory/scripts/s6_memory_turn_eval.py"
PINS = {
    "old": (
        "fa6d99df6ddaf500aaeabd8fdb3ef1b83a6ed0d8",
        "cde7922f0d63a2b6fbe4c0497adfbe127aec2572924ed0a2365e7f524da961a7",
    ),
    "new": (
        "54e8c18f7600e2d0c94f76b5140ceb3aa499afe1",
        "5953d4a88fc387dcd3f032a19217c6307ef234742ca450576cc4c8a423ae2dc8",
    ),
}
CASE_IDS = (
    "non_correction_substring",
    "assistant_correction_source",
    "quoted_correction",
    "other_person_correction",
    "negated_correction",
    "nonexistent_occurrence_n",
    "same_prediction_post_guard_repair",
    "legitimate_old_prediction_without_new_field",
    "invalid_primary_evidence_not_rescued",
    "wrong_target_not_rescued",
)


def canonical(value):
    """Match JSON types exactly, normalizing scorer tuples to JSON arrays."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def load_score(repo: Path, label: str):
    ref, digest = PINS[label]
    blob = subprocess.check_output(
        ["git", "-C", str(repo), "show", f"{ref}:{SOURCE_PATH}"],
        stderr=subprocess.PIPE,
    )
    if hashlib.sha256(blob).hexdigest() != digest:
        raise ValueError(f"{label}: pinned source SHA256 mismatch")
    names = {"_vmatch", "_match", "score_rows"}
    tree = ast.parse(blob.decode("utf-8"))
    functions = [
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    if len(functions) != 3 or {node.name for node in functions} != names:
        raise ValueError(f"{label}: reviewed function set mismatch")
    namespace = {
        "collections": collections,
        "WRITE": {"ADD", "SUPERSEDE", "CONTEST"},
        "__builtins__": {
            "any": any, "bool": bool, "dict": dict, "enumerate": enumerate,
            "len": len, "list": list, "next": next, "round": round, "set": set,
            "sorted": sorted, "sum": sum,
        },
    }
    module = ast.Module(body=functions, type_ignores=[])
    exec(compile(module, f"{ref}:{SOURCE_PATH}", "exec"), namespace)
    return namespace["score_rows"]


def verify_report(report, repo: Path):
    """Return mismatches; leave the supplied report and files unchanged."""
    if report.get("source_path") != SOURCE_PATH:
        return ["source_path mismatch"]
    for label, (ref, digest) in PINS.items():
        if report.get(f"source_{label}_sha") != ref:
            return [f"{label}: artifact commit pin mismatch"]
        if report.get(f"source_{label}_sha256") != digest:
            return [f"{label}: artifact source SHA256 mismatch"]
    cases = report.get("cases")
    if not isinstance(cases, list) or [c.get("id") for c in cases] != list(CASE_IDS):
        return ["saved ten-case IDs/order mismatch"]
    scorers = {label: load_score(repo, label) for label in PINS}
    failures = []
    for case in cases:
        cid = case["id"]
        if case["input"]["id"] != cid or case["prediction"]["id"] != cid:
            failures.append(f"{cid}: input/prediction ID mismatch")
            continue
        unchanged = True
        actual = {}
        for label, score in scorers.items():
            inp, pred = copy.deepcopy(case["input"]), copy.deepcopy(case["prediction"])
            before = canonical(pred)
            actual[label] = score([inp], {cid: pred})
            unchanged = unchanged and canonical(pred) == before
            if canonical(actual[label]) != canonical(case[f"{label}_score"]):
                failures.append(f"{cid}: {label}_score mismatch")
        if case.get("prediction_unchanged") is not unchanged or not unchanged:
            failures.append(f"{cid}: prediction_unchanged mismatch")
        downgraded = actual["new"]["counts"].get("downgraded_no_correction_evidence", 0) > 0
        if case.get("guard_downgraded") is not downgraded:
            failures.append(f"{cid}: guard_downgraded mismatch")
    return failures


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, default=Path(__file__).with_suffix(".json"))
    args = parser.parse_args(argv)
    try:
        repo = Path(subprocess.check_output(
            ["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--show-toplevel"],
            text=True, stderr=subprocess.PIPE,
        ).strip())
        report = json.loads(args.artifact.read_text(encoding="utf-8"))
        failures = verify_report(report, repo)
    except (OSError, subprocess.CalledProcessError, ValueError, TypeError, KeyError, AttributeError) as exc:
        print(f"guard audit ERROR: {exc}", file=sys.stderr)
        return 2
    if failures:
        print("guard audit MISMATCH:\n" + "\n".join(failures), file=sys.stderr)
        return 1
    print("guard audit PASS: 10/10 saved cases exactly reproduced (old/new pure scorers)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
