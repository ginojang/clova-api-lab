#!/usr/bin/env python3
"""Offline audit: pinned Git fixtures and reviewed pure C scorer functions only.

Does not run the upstream module, CLI, build, network, DB, or production guard.
The extra cases are analyst-created diagnostics, not model measurements/gold.
"""
from __future__ import annotations

import ast
import argparse
import collections
import copy
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OLD = "54e8c18f7600e2d0c94f76b5140ceb3aa499afe1"
NEW = "5bbf43b2d22cdf386715979668dd21b82234ba6a"
SOURCE = "memory/scripts/s6_memory_chat_eval.py"
SOURCE_SHA256 = "03cfd5927c76774eaa6a850715073a8baf4927b8e52645282c3f8b449fd98246"
GOLD_OLD = "memory/data/s6_memory_chat_eval_v0_4/eval.jsonl"
GOLD_NEW = "memory/data/s6_memory_chat_eval_v0_5/eval.jsonl"


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def rows(raw):
    return [json.loads(line) for line in raw.decode("utf-8").split("\n") if line]


def pure_functions(raw):
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("reviewed scorer SHA256 mismatch")
    names = {"score_rows", "_gold", "teeth"}
    nodes = [node for node in ast.parse(raw).body if isinstance(node, ast.FunctionDef) and node.name in names]
    if len(nodes) != 3 or {node.name for node in nodes} != names:
        raise ValueError("pure function set mismatch")
    ns = {"collections": collections, "copy": copy, "A": "assistant",
          "KINDS": {"order", "install", "design", "quote", "consult"},
          "__builtins__": {name: value for name, value in {
              "any": any, "all": all, "bool": bool, "dict": dict,
              "enumerate": enumerate, "len": len, "list": list, "next": next,
              "round": round, "set": set, "str": str, "sum": sum}.items()}}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), f"{NEW}:{SOURCE}", "exec"), ns)
    return ns


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "contract_v008_audit.json",
                        help="New output JSON path; existing files are never overwritten.")
    args = parser.parse_args(argv)
    old_bytes, new_bytes = blob(OLD, GOLD_OLD), blob(NEW, GOLD_NEW)
    old, new = rows(old_bytes), rows(new_bytes)
    if [r["id"] for r in old] != [r["id"] for r in new]:
        raise ValueError("gold IDs/order changed")
    changes = [{"id": a["id"], "before": a["expect"], "after": b["expect"]}
               for a, b in zip(old, new) if a != b]
    for a, b in zip(old, new):
        aa, bb = copy.deepcopy(a), copy.deepcopy(b)
        aa["expect"].pop("episode_kinds"); bb["expect"].pop("episode_kinds")
        if aa != bb:
            raise ValueError("change outside episode_kinds")
    if [c["id"] for c in changes] != ["p02", "x02"]:
        raise ValueError("changed row IDs mismatch")
    meta = json.loads(blob(NEW, GOLD_NEW.replace("eval.jsonl", "META.json")))
    if hashlib.md5(new_bytes).hexdigest() != meta["eval_md5"]:
        raise ValueError("gold META md5 mismatch")
    ns = pure_functions(blob(NEW, SOURCE))
    score, gold = ns["score_rows"], ns["_gold"]
    by = {r["id"]: r for r in new}
    cases = []

    def case(name, row, prediction, expected):
        row, prediction = copy.deepcopy(row), copy.deepcopy(prediction)
        before = json.dumps([row, prediction], ensure_ascii=False, sort_keys=True)
        result = score([row], {row["id"]: prediction})
        if before != json.dumps([row, prediction], ensure_ascii=False, sort_keys=True):
            raise ValueError(f"{name}: scorer mutated inputs")
        observed = {"rows_ok": result["rows_ok"], "episode_acc": result["episode_acc"], "gates_n": result["gates_n"]}
        if observed != expected:
            raise ValueError(f"{name}: {observed!r} != {expected!r}")
        cases.append({"id": name, "input": row, "prediction": prediction,
                      "expected_observed": expected, "score": result, "inputs_unchanged": True})

    def expected(ok, episode, **gates):
        return {"rows_ok": ok, "episode_acc": episode, "gates_n": gates}

    def pred(row):
        return gold([row])[row["id"]]

    unknown = copy.deepcopy(by["p03"])
    case("unknown_assistant_allowed", unknown, pred(unknown), expected(1, 1.0))
    missing = copy.deepcopy(unknown); missing["elda_s6"] = {}
    case("unjudged_assistant_allowed", missing, pred(missing), expected(1, 1.0))
    for rowid in ("p02", "x02"):
        row = by[rowid]; p = pred(row)
        p["episode"] = {"did": [{"kind": "quote", "what": "synthetic", "turn_index": 1}], "reuse": {}}
        case(f"{rowid}_raw_bad_source_post_drop_kind_correct", row, p, expected(0, 1.0, did_source_bad=1))
    base = by["e01"]
    for name, ti, gate in (("user_source", 0, "did_source_bad"), ("absent_turn", 99, "did_source_bad"),
                           ("null_source", None, "did_no_source")):
        p = pred(base); p["episode"]["did"][0]["turn_index"] = ti
        case(name, base, p, expected(0, 0.0, **{gate: 1}))
    p = pred(base); p["episode"]["did"][0].pop("turn_index")
    case("missing_source", base, p, expected(0, 0.0, did_no_source=1))
    mixed = copy.deepcopy(base)
    mixed["turns"].append({"turn_index": 3, "speaker": "assistant", "origin_kind": "elda", "text": "synthetic blocked utterance"})
    mixed["elda_s6"]["3"] = "block"
    p = pred(mixed); p["episode"]["did"].append({"kind": "quote", "turn_index": 3, "what": "synthetic"})
    case("valid_and_blocked_did", mixed, p, expected(0, 1.0, did_source_bad=1))
    p["episode"]["did"].append(copy.deepcopy(p["episode"]["did"][-1]))
    case("two_bad_did_in_one_row", mixed, p, expected(0, 1.0, did_source_bad=2))
    p = pred(base); p["episode"]["did"].append({"kind": "quote", "turn_index": 1, "what": "fabricated extra work"})
    case("extra_allowed_kind_not_penalized", base, p, expected(1, 1.0))
    p = pred(base); p["episode"]["did"][0]["what"] = "fabricated work or promise content"
    case("did_content_not_semantically_checked", base, p, expected(1, 1.0))
    fixed = copy.deepcopy(base); fixed["elda_s6"]["1"] = "fix"
    # Keep the expected design grounded in a separate valid assistant turn.
    # The supplied did incorrectly cites the fix turn via a bool/float alias.
    fixed["turns"].append({"turn_index": 3, "speaker": "assistant", "origin_kind": "elda", "text": "간판 시안 세 가지를 새로 준비했어요"})
    fixed["elda_s6"]["3"] = "pass"
    for name, ti in (("boolean_source_alias_bypasses_fix", True), ("float_source_alias_bypasses_fix", 1.0)):
        p = pred(base); p["episode"]["did"][0]["turn_index"] = ti
        case(name, fixed, p, expected(1, 1.0))
    teeth = ns["teeth"](copy.deepcopy(new))
    if teeth["verdict"] != "GREEN":
        raise ValueError("upstream pure teeth failed")
    changed_paths = subprocess.check_output(
        ["git", "-C", str(ROOT), "diff", "--name-only", OLD, NEW], text=True).splitlines()
    report = {
        "scope": "offline synthetic pure-function diagnostics; no model/API/DB/production guard execution",
        "source_old_ref": OLD, "source_new_ref": NEW, "source_path": SOURCE,
        "source_new_sha256": SOURCE_SHA256,
        "loaded_functions": ["score_rows", "_gold", "teeth"],
        "gold_old": {"path": GOLD_OLD, "sha256": hashlib.sha256(old_bytes).hexdigest(), "md5": hashlib.md5(old_bytes).hexdigest(), "rows": len(old)},
        "gold_new": {"path": GOLD_NEW, "sha256": hashlib.sha256(new_bytes).hexdigest(), "md5": hashlib.md5(new_bytes).hexdigest(), "rows": len(new)},
        "old_gold_preserved_in_new_commit": blob(NEW, GOLD_OLD) == old_bytes,
        "gold_changed_rows": changes, "meta_prompt_pair": meta["prompt_pair"],
        "changed_paths": changed_paths, "upstream_pure_teeth": teeth,
        "gold_self_score": score(copy.deepcopy(new), gold(copy.deepcopy(new))),
        "synthetic_cases": cases,
        "limits": ["No new model predictions were scored; existing K3 artifacts remain unchanged.",
                   "Git confirms the precise contract/gold/scorer changes, not the author's prior exposure to predictions or decision chronology.",
                   "rows_ok includes raw did-source failures; episode_acc uses only kept did kinds. gates_n counts bad items, not unique rows.",
                   "Allowed-kind extras and did what/outcome meaning are not checked; no general false-episode-memory metric.",
                   "Boolean/float turn_index can alias integer turns while missing the string-keyed S6 verdict; this diagnostic concerns scorer only."]}
    output = args.output
    with output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(f"PASS: {len(cases)} synthetic cases; pure teeth {teeth['verdict']}; wrote {output}")


if __name__ == "__main__":
    main()
