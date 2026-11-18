#!/usr/bin/env python3
"""Re-score committed synthetic C predictions. No model, service, DB or runner execution."""
import argparse
import ast
import collections
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REASONER = {
    "06": "542bd9a9b29c9f10ea1fe5fb24b20a195210f567",
    "07": "f03dbbc26bfdb0f8c865fe83a5ceeae25e43c846",
    "08": "60a26c25d1d06539a842a9ebc74136af43864de7",
}
RESULTS = {"06": "dfd7c92fdfe4cba28c6c4a95353ffd642f7db2c5", "07": "ddce6c4297677643932a60577ca9cc07fd459bba"}
SCORER = "memory/scripts/s6_memory_chat_eval.py"
PINS = {
    "06": "583dc189ca772c3484d1d5ce0d9636d16301b73ab66ea0bcd8570cbdd43e1df4",
    "07": "61ff7e4ac9f2ff9f8c8adb5743636eda4bcb875b61c70b2b38d1d2f974b090ab",
    "08": "9439c5179e9a477e1bc89d41743d775c5cb71ac5a4529e911802a3eacf3b7836",
}
PREFIX = "elda-orchestrator/measurements/eldacore/s6_memory_20261117/"
CONFIG = {"06": "6d7325df", "07": "238c11ba"}
HASHES = {}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blob(ref, path):
    if path.endswith((".gz", ".log")):
        raise ValueError("server logs forbidden")
    data = subprocess.check_output(["git", "-C", str(ROOT), "show", f"{ref}:{path}"])
    HASHES[f"{ref}:{path}"] = sha(data)
    return data


def jsonl(raw):
    return [json.loads(line) for line in raw.splitlines() if line.strip()]


def scorer(version):
    source = blob(REASONER[version], SCORER)
    assert sha(source) == PINS[version]
    node, = [n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "score_rows"]
    ns = {"collections": collections, "A": "assistant", "KINDS": {"order", "install", "design", "quote", "consult"}}
    exec(compile(ast.Module(body=[node], type_ignores=[]), f"{REASONER[version]}:{SCORER}#score_rows", "exec"), ns)
    return ns["score_rows"], ast.dump(node, include_attributes=False)


def aggregate(ev, predictions, function, eval_bytes):
    ids = {row["id"] for row in ev}
    assert len(ids) == len(ev)
    by_id = collections.defaultdict(list)
    for row in predictions:
        by_id[row["id"]].append(row)
    assert set(by_id) == ids and all([r["rep"] for r in rows] == [0, 1, 2] for rows in by_id.values())
    per = [function(ev, {i: rows[k] for i, rows in by_id.items()}) for k in range(3)]
    votes = collections.defaultdict(list)
    for score in per:
        for i, ok in score["_per"]:
            votes[i].append(ok)
    summary = {"K": 3, "per_run_rows_ok": [p["rows_ok"] for p in per], "rows": len(ev),
               "majority_ok": sum(sum(v) * 2 > len(v) for v in votes.values()),
               "gates_n_per_run": [p["gates_n"] for p in per],
               "run0": {k: v for k, v in per[0].items() if k != "_per"},
               "eval_md5": hashlib.md5(eval_bytes).hexdigest()}
    return summary, per


def split_scores(ev, predictions, fn):
    groups = {"original13": [r["id"] for r in ev[:13]],
              "v06_d01_d02": [r["id"] for r in ev[13:15]],
              "v07_d03_d04_d05": [r["id"] for r in ev[15:]]}
    return {key: [fn([r for r in ev if r["id"] in ids],
                    {r["id"]: r for r in predictions if r["rep"] == k and r["id"] in ids})
                  for k in range(3)] for key, ids in groups.items() if ids}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=HERE / "audit.json")
    args = parser.parse_args()
    gold_bytes, gold, meta, functions, asts = {}, {}, {}, {}, {}
    for version in REASONER:
        path = f"memory/data/s6_memory_chat_eval_v0_{version[1]}/eval.jsonl"
        gold_bytes[version] = blob(REASONER[version], path)
        gold[version] = jsonl(gold_bytes[version])
        meta[version] = json.loads(blob(REASONER[version], path.replace("eval.jsonl", "META.json")))
        assert hashlib.md5(gold_bytes[version]).hexdigest() == meta[version]["eval_md5"]
        functions[version], asts[version] = scorer(version)
    assert len(set(asts.values())) == 1
    assert gold_bytes["07"].startswith(gold_bytes["06"])
    assert gold["07"][:15] == gold["08"][:15]
    changes = []
    for old, new in zip(gold["07"], gold["08"]):
        assert old["id"] == new["id"]
        if old == new:
            continue
        expected = copy.deepcopy(old)
        expected["expect"]["episode_kinds"] = ["install"]
        assert old["expect"]["episode_kinds"] == ["consult"] and expected == new
        changes.append({"id": old["id"], "path": "/expect/episode_kinds", "old": ["consult"], "new": ["install"]})
    assert [c["id"] for c in changes] == ["d03", "d04"]
    prompts = {}
    for version in REASONER:
        p = blob(REASONER[version], "memory/prompts/s6_memory_chat_end_v0.md")
        body = re.sub(r"<!--[\s\S]*?-->", "", p.decode()).strip()
        prompts[version] = {"file_md5": hashlib.md5(p).hexdigest(), "file_sha256": sha(p), "body_md5": hashlib.md5(body.encode()).hexdigest()}
        if version in RESULTS:
            op = blob(RESULTS[version], "elda-orchestrator/src/prompts/eldacore/s6_memory_chat_end.md")
            obody = re.sub(r"<!--[\s\S]*?-->", "", op.decode()).strip()
            assert body == obody and prompts[version]["body_md5"].startswith(CONFIG[version])
            prompts[version].update(orchestrator_file_sha256=sha(op), normalized_source_body_equal=True)
    assert prompts["07"]["file_sha256"] == prompts["08"]["file_sha256"]
    for version in RESULTS:
        blob(RESULTS[version], "elda-orchestrator/src/tools/s6ChatEndBatch.ts")
        blob(RESULTS[version], "elda-orchestrator/src/core/eldacore/s6chatEnd.ts")
    datasets = {}
    predictions_by_version = {}
    for version in RESULTS:
        name = f"s6_memory_chat_v{version}_pred_k3_{CONFIG[version]}_prompt-v00{version}_raw.jsonl"
        raw_bytes = blob(RESULTS[version], PREFIX + name)
        pred = jsonl(raw_bytes)
        predictions_by_version[version] = pred
        raw_pred = []
        diffs = []
        for row in pred:
            parsed = json.loads(row["raw"].strip().removeprefix("```json").removesuffix("```").strip())
            assert parsed.get("promises", []) == row["raw_promises"]
            raw_pred.append({**parsed, "id": row["id"], "rep": row["rep"]})
            for key in ("promises", "episode", "measured"):
                if parsed.get(key) != row.get(key):
                    diffs.append({"id": row["id"], "rep": row["rep"], "key": key,
                                  "raw": parsed.get(key), "post_guard": row.get(key)})
        summary, per = aggregate(gold[version], pred, functions[version], gold_bytes[version])
        raw_summary, raw_per = aggregate(gold[version], raw_pred, functions[version], gold_bytes[version])
        submitted = json.loads(blob(RESULTS[version], PREFIX + f"s6_memory_chat_v{version}_score_k3_{CONFIG[version]}.json"))
        assert submitted == summary
        cases = []
        index = {r["id"]: r for r in gold[version]}
        for row in pred:
            if not row["id"].startswith("d0"):
                continue
            turns = {t["turn_index"]: t for t in index[row["id"]]["turns"]}
            cases.append({"id": row["id"], "rep": row["rep"], "promises": row["promises"],
                          "promise_source_verdicts": [index[row["id"]]["elda_s6"].get(str(p["evidence"]["turn_index"])) for p in row["promises"]],
                          "did": [{"item": d, "source_turn": turns.get(d.get("turn_index")),
                                   "source_verdict": index[row["id"]]["elda_s6"].get(str(d.get("turn_index")), "none")}
                                  for d in (row.get("episode") or {}).get("did", [])]})
        datasets[version] = {"prediction_sha256": sha(raw_bytes), "rows": len(pred), "submitted_summary_equal": True,
                             "post_guard_summary": summary, "raw_summary": raw_summary, "raw_post_guard_differences": diffs,
                             "per_run": per, "raw_per_run": raw_per, "groups": split_scores(gold[version], pred, functions[version]), "added_cases": cases}
    fixed_pred = predictions_by_version["07"]
    v08summary, v08per = aggregate(gold["08"], fixed_pred, functions["08"], gold_bytes["08"])
    changes_in_scores = [{"rep": k, "changed_rows": [i for (i, was), (_, now) in zip(datasets["07"]["per_run"][k]["_per"], v08per[k]["_per"]) if was != now]} for k in range(3)]
    assert all(r["changed_rows"] == ["d03", "d04"] for r in changes_in_scores)
    d05 = next(r for r in gold["08"] if r["id"] == "d05")
    p05 = copy.deepcopy(next(r for r in fixed_pred if r["id"] == "d05" and r["rep"] == 0))
    earlier = d05["turns"][1]
    p05["promises"] = [{"t": "바퀴 부품 교체", "evidence": {"turn_index": 1, "t": earlier["text"]}}]
    withdrawal_diagnostic = functions["08"]([d05], {"d05": p05})
    assert withdrawal_diagnostic["gates_n"] == {"promise_false": 1}
    report = {"scope": "committed synthetic outputs plus hash-pinned score_rows only; no K3/model/runner/API/DB execution",
              "reasoner_refs": REASONER, "result_refs": RESULTS,
              "gold": {v: {"rows": len(gold[v]), "md5": meta[v]["eval_md5"], "sha256": sha(gold_bytes[v]), "meta": meta[v]} for v in gold},
              "score_rows_ast_same_all_versions": True, "v06_exact_prefix_of_v07": True,
              "v07_to_v08_only_gold_changes": changes, "prompts": prompts, "stored_k3": datasets,
              "v08_rescore_same_v07_predictions": {"summary": v08summary, "per_run": v08per, "groups": split_scores(gold["08"], fixed_pred, functions["08"]), "changes": changes_in_scores},
              "analyst_d05_withdrawal_diagnostic": withdrawal_diagnostic,
              "limits": ["v0.8 18/18x3 is post-output relabeling of the same 54 predictions; no new model calls or independent improvement.",
                         "v0.7 promise successes are development regression evidence after r4 n08 was inspected, not unseen holdout evidence.",
                         "The earlier prompt was not tested on the three new v0.7 cases here, so an isolated prompt causal effect is not measured.",
                         "Scoring checks allowed source turn/verdict and expected kind inclusion, not semantic entailment of did.what/outcome from the cited turn.",
                         "Recorded raw is provider content string, not a full request/network trace; source prompt equality does not independently authenticate execution settings.",
                         "The META prompt_pair still names v0.002; current prompt file MD5 and normalized body config MD5 are distinct identifiers.",
                         "Lexical example-overlap absence does not establish independence from inspected failure cases."],
              "input_sha256": HASHES}
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"v06": datasets["06"]["post_guard_summary"]["per_run_rows_ok"], "v07": datasets["07"]["post_guard_summary"]["per_run_rows_ok"], "v08_same_predictions": v08summary["per_run_rows_ok"], "changed_gold": changes}, ensure_ascii=False))


if __name__ == "__main__":
    main()
