#!/usr/bin/env python3
"""Offline C v0.6 dataset/_gold audit; no K3 or model/runtime execution."""
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
OLD = "b91323f4580e17fec9431289c88e0f601dccd669"
NEW = "80b386fb449bac1e05d78451c3033c4716617803"
SOURCE = "memory/scripts/s6_memory_chat_eval.py"
GOLD_OLD = "memory/data/s6_memory_chat_eval_v0_5/eval.jsonl"
GOLD_NEW = "memory/data/s6_memory_chat_eval_v0_6/eval.jsonl"
PINS = {OLD: "a2c4e4ca568b6811ba7ec06b1471682b893346948dd6e555f0c634b7caa7b8ad",
        NEW: "717c9f2d33e222f19e152fc56a58a7898c822333a3fc589e90683aefd0b6a094"}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    return subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], stderr=subprocess.PIPE)


def rows(raw):
    return [json.loads(x) for x in raw.decode().split("\n") if x]


def functions(ref):
    raw = blob(ref, SOURCE)
    if sha(raw) != PINS[ref]:
        raise ValueError("reviewed source hash mismatch")
    names = {"score_rows", "_gold"}
    nodes = [n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name in names]
    if len(nodes) != len(names) or {n.name for n in nodes} != names:
        raise ValueError("reviewed pure function set mismatch")
    ns = {"collections": collections, "A": "assistant", "KINDS": {"order", "install", "design", "quote", "consult"}}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), f"{ref}:{SOURCE}#pure", "exec"), ns)
    score_ast = ast.dump(next(n for n in nodes if n.name == "score_rows"), include_attributes=False)
    return ns, score_ast


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output", type=Path, default=HERE / "c_v06_audit.json",
                    help="New output JSON path; never overwrite an existing file.")
    args = ap.parse_args(argv)
    protected_names = ("score_audit.json", "score_audit.report.json", "score_audit.md", "comparison.py", "comparison.json")
    protected = {name: sha((HERE / name).read_bytes()) for name in protected_names}
    old_bytes, new_bytes = blob(OLD, GOLD_OLD), blob(NEW, GOLD_NEW)
    old_rows, new_rows = rows(old_bytes), rows(new_bytes)
    if len(old_rows) != 13 or len(new_rows) != 15 or new_rows[:13] != old_rows:
        raise ValueError("old thirteen rows/order changed")
    if not new_bytes.startswith(old_bytes) or blob(NEW, GOLD_OLD) != old_bytes:
        raise ValueError("old gold bytes not preserved")
    if [r["id"] for r in new_rows[13:]] != ["d01", "d02"] or len({r["id"] for r in new_rows}) != 15:
        raise ValueError("new ID set mismatch")
    meta = json.loads(blob(NEW, GOLD_NEW.replace("eval.jsonl", "META.json")))
    if hashlib.md5(new_bytes).hexdigest() != meta["eval_md5"]:
        raise ValueError("META MD5 mismatch")
    if sum(len(r["expect"]["promises"]) for r in new_rows) != 5 or meta["expected_promises"] != 5:
        raise ValueError("expected promise count mismatch")
    old, old_ast = functions(OLD)
    new, new_ast = functions(NEW)
    if old_ast != new_ast:
        raise ValueError("score_rows changed unexpectedly")
    old_generated = old["_gold"](copy.deepcopy(new_rows))
    new_generated = new["_gold"](copy.deepcopy(new_rows))
    if {r["id"]: new_generated[r["id"]] for r in old_rows} != old["_gold"](copy.deepcopy(old_rows)):
        raise ValueError("old thirteen generated predictions changed")
    old_self = old["score_rows"](copy.deepcopy(new_rows), copy.deepcopy(old_generated))
    new_self = new["score_rows"](copy.deepcopy(new_rows), copy.deepcopy(new_generated))
    if old_self["rows_ok"] != 13 or new_self["rows_ok"] != 15 or new_self["gates_n"]:
        raise ValueError("unexpected synthetic self-score")
    added = []
    for row in new_rows[13:]:
        turns = {t["turn_index"]: t for t in row["turns"]}
        if turns[1]["text"] != turns[5]["text"] or row["elda_s6"] != {"1": "block", "3": "none", "5": "pass"}:
            raise ValueError("new repeated-promise fixture does not match stated construction")
        p = new_generated[row["id"]]
        if [q["evidence"]["turn_index"] for q in p["promises"]] != [5]:
            raise ValueError("new _gold promise did not select pass turn 5")
        added.append({"id": row["id"], "input": row, "generated_prediction": p,
                      "duplicate_assistant_text_1_equals_5": True, "promise_source_indices": [5],
                      "did_source_indices": [d["turn_index"] for d in p["episode"]["did"]]})
    diagnostics = []

    def diagnostic(name, row, prediction, expected_ok, expected_gates):
        x, p = copy.deepcopy(row), copy.deepcopy(prediction)
        before = json.dumps([x, p], ensure_ascii=False, sort_keys=True)
        result = new["score_rows"]([x], {x["id"]: p})
        if before != json.dumps([x, p], ensure_ascii=False, sort_keys=True):
            raise ValueError("scorer mutated diagnostic input")
        if result["rows_ok"] != expected_ok or result["gates_n"] != expected_gates:
            raise ValueError(f"unexpected {name} result")
        diagnostics.append({"id": name, "analyst_created": True, "input": x, "prediction": p,
                            "score": result, "inputs_unchanged": True})

    for row in new_rows[13:]:
        p = copy.deepcopy(new_generated[row["id"]])
        p["promises"][0]["evidence"]["turn_index"] = 1
        diagnostic(row["id"] + "_block_source_same_text_rejected", row, p, 0, {"promise_not_pass": 1})
    base = copy.deepcopy(new_rows[13])
    no_pass = copy.deepcopy(base); no_pass["elda_s6"]["5"] = "unknown"
    p = new["_gold"]([no_pass])[no_pass["id"]]
    diagnostic("no_matching_pass_falls_back_to_block_and_fails", no_pass, p, 0, {"promise_not_pass": 1})
    unrelated = copy.deepcopy(no_pass)
    unrelated["turns"][1]["text"] = "현재는 간판 상담만 하고 있습니다."
    unrelated["elda_s6"]["1"] = "pass"
    p = new["_gold"]([unrelated])[unrelated["id"]]
    want = unrelated["expect"]["promises"][0]["contains"]
    if want in p["promises"][0]["evidence"]["t"] or p["promises"][0]["evidence"]["turn_index"] != 1:
        raise ValueError("unrelated fallback diagnostic was not constructed correctly")
    diagnostic("unrelated_pass_fallback_self_score_passes", unrelated, p, 1, {})
    incidental = copy.deepcopy(base)
    incidental["turns"][3]["text"] = "순서표라는 말은 예시일 뿐이고 지금 약속한 것은 없습니다."
    incidental["elda_s6"]["3"] = "pass"
    p = new["_gold"]([incidental])[incidental["id"]]
    if p["promises"][0]["evidence"]["turn_index"] != 3:
        raise ValueError("first lexical pass source was not selected")
    diagnostic("incidental_keyword_pass_selected_before_real_promise", incidental, p, 1, {})
    report = {"old_ref": OLD, "new_ref": NEW, "source_path": SOURCE, "source_sha256": PINS[NEW],
              "scope": "static Git review plus pure _gold/score_rows synthetic diagnostics; no K3/main/build/teeth/model/API/DB/runtime execution",
              "old_gold": {"path": GOLD_OLD, "sha256": sha(old_bytes), "md5": hashlib.md5(old_bytes).hexdigest(), "rows": 13},
              "new_gold": {"path": GOLD_NEW, "sha256": sha(new_bytes), "md5": hashlib.md5(new_bytes).hexdigest(), "rows": 15},
              "META": meta, "old_thirteen_exact_byte_prefix": True, "old_v05_file_preserved": True,
              "old_thirteen_generated_predictions_unchanged": True, "score_rows_AST_unchanged": True,
              "added_rows": added, "old_builder_on_new_fixture_self_score": old_self,
              "new_builder_on_new_fixture_self_score": new_self, "diagnostics": diagnostics,
              "limits": ["15/15 is synthetic _gold self-scoring, not model accuracy or a new K3 result.",
                         "The two actual added rows have a unique pass assistant turn 5 containing the expected promise keyword; current _gold selection is correct for them.",
                         "The data stores expected promise keywords, not an explicit expected promise source index. Source 5 follows from this fixture's S6 map.",
                         "Generated episode did uses turn 3 (none), distinct from promise turn 5 (pass).",
                         "The first matching pass keyword and fallback to the first assistant are lexical source selection, not promise entailment validation.",
                         "The unrelated-pass diagnostic intentionally preserves a promise expectation without an eligible matching pass; it demonstrates _gold can mask an inconsistent future fixture, not that the present fifteen rows are wrong.",
                         "These disclosed cases target an observed r3 failure and are a development pretest, not unseen holdout/generalization evidence."],
              "protected_prior_artifact_sha256": protected,
              "protected_prior_artifacts_unchanged": all(sha((HERE / n).read_bytes()) == d for n, d in protected.items())}
    if not report["protected_prior_artifacts_unchanged"]:
        raise ValueError("prior artifact changed")
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False); stream.write("\n")
    print("PASS: old13 byte-preserved; new promise sources5/5; synthetic self-score15/15; five diagnostic outcomes reproduced")


if __name__ == "__main__":
    main()
