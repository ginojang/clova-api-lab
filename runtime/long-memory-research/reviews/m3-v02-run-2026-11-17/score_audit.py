#!/usr/bin/env python3
"""Re-score committed synthetic observations locally; never runs the adapter."""

import argparse
from collections import Counter, defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
EVAL = ROOT / "runtime/long-memory-research/eval-v1"
COMMIT = "9ad23dde4a4164f6da0a83f4854d58b42036905b"
PREFIX = "elda-orchestrator/measurements/eldacore/m3v02_20261117/"


def blob(name):
    return subprocess.check_output(["git", "show", f"{COMMIT}:{PREFIX}{name}"], cwd=ROOT)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def save(directory, name, value):
    with (directory / name).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        stream.write("\n")


def counts(items):
    count = Counter(items)
    return {"planned": sum(count.values()), "passed": count["pass"],
            "failed": count["fail"], "unknown": count["unknown"]}


def differences(left, right, path=""):
    if type(left) is not type(right):
        return [{"path": path, "kind": "type"}]
    if isinstance(left, dict):
        output = []
        for key in sorted(left.keys() | right.keys()):
            if key not in left or key not in right:
                output.append({"path": path + "/" + key, "kind": "missing_key"})
            else:
                output.extend(differences(left[key], right[key], path + "/" + key))
        return output
    if isinstance(left, list):
        if len(left) != len(right):
            return [{"path": path, "kind": "length"}]
        return [item for i, (a, b) in enumerate(zip(left, right))
                for item in differences(a, b, path + "/" + str(i))]
    return [] if left == right else [{"path": path, "kind": "value"}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=HERE,
                        help="existing directory for new audit files; never overwrites")
    output = parser.parse_args().output_dir.resolve()
    if not output.is_dir():
        raise ValueError("output directory must already exist")
    if any((output / name).exists() for name in ("score_audit.report.json", "score_audit.json")):
        raise FileExistsError("audit output already exists; select an empty directory")
    manifest_raw = (EVAL / "manifest.json").read_bytes()
    manifest = json.loads(manifest_raw)
    verified = {}
    for name in ("scorer.py", "_base_scorer.py", "gold.jsonl", "plan.json", "CONTRACT.md"):
        actual = digest((EVAL / name).read_bytes())
        if actual != manifest["sha256"][name]:
            raise ValueError(f"sealed manifest mismatch: {name}")
        verified[name] = actual
    spec = importlib.util.spec_from_file_location("m3_v02_sealed_audit_scorer", EVAL / "scorer.py")
    scorer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scorer)
    gold, gold_hash = scorer.read_jsonl(EVAL / "gold.jsonl")
    raw = blob("predictions.jsonl")
    predictions = []
    for line in raw.decode("utf-8").split("\n"):
        if line.strip():
            row = json.loads(line, object_pairs_hook=scorer.base.unique_object,
                             parse_constant=scorer.base.reject_constant)
            scorer.base.validate_json(row)
            predictions.append(row)
    original_report_raw = blob("report.json")
    original_report = json.loads(original_report_raw, object_pairs_hook=scorer.base.unique_object,
                                 parse_constant=scorer.base.reject_constant)
    report = scorer.score(gold, predictions, {"gold_sha256": gold_hash,
                                             "predictions_sha256": digest(raw)})
    indexed_gold = scorer.index_gold(gold)
    indexed_predictions, _ = scorer.index_predictions(predictions, indexed_gold)
    missing = sorted(indexed_gold.keys() - indexed_predictions.keys())
    all_checks, gates, nongates, failures = [], [], [], []
    by_family, by_scenario = defaultdict(list), defaultdict(list)
    reason_counts, gate_reasons, nongate_reasons = Counter(), Counter(), Counter()
    missing_prediction_checks, supplied_prediction_checks = [], []
    by_interpretation = defaultdict(lambda: {"checks": [], "gates": []})
    for target in report["targets"]:
        expected = {check["id"]: check for check in indexed_gold[target["id"]]["checks"]}
        row = indexed_predictions.get(target["id"])
        for check in target["checks"]:
            status = check["status"]
            all_checks.append(status)
            (gates if check["gate"] else nongates).append(status)
            by_family[target["family"]].append(status)
            by_scenario[target["scenario_id"]].append(status)
            by_interpretation[target["interpretation"]]["checks"].append(status)
            if check["gate"]:
                by_interpretation[target["interpretation"]]["gates"].append(status)
            (missing_prediction_checks if row is None else supplied_prediction_checks).append(status)
            if status == "unknown":
                reason_counts[check["reason"]] += 1
                (gate_reasons if check["gate"] else nongate_reasons)[check["reason"]] += 1
            if status == "fail":
                gold_check = expected[check["id"]]
                actual = scorer.base.resolve_pointer(row, gold_check["path"])
                if actual is scorer.base.MISSING:
                    actual = "<missing or derived>"
                failures.append({"target_id": target["id"], "scenario_id": target["scenario_id"],
                                 "family": target["family"], "interpretation": target["interpretation"],
                                 **check, "path": gold_check["path"], "operator": gold_check["operator"],
                                 "expected": gold_check["value"], "observed": actual})
    semantic_reasons = Counter(target["semantic"]["reason"] for target in report["targets"])
    history_reasons = Counter(target["history_exposure"]["reason"] for target in report["targets"])
    checks_by_metric = defaultdict(list)
    for target in report["targets"]:
        for check in target["checks"]:
            checks_by_metric[check["metric"]].append(check["status"])
    audit = {
        "audit_kind": "offline re-score of committed synthetic supplied observations",
        "source_commit": COMMIT, "source_prefix": PREFIX, "run_id": report["run_id"],
        "network_calls": 0, "database_calls": 0, "model_calls": 0,
        "external_adapter_executed": False,
        "source_hashes": {"predictions.jsonl": digest(raw), "report.json": digest(original_report_raw)},
        "sealed_manifest_sha256": digest(manifest_raw), "verified_sealed_files": verified,
        "report_exact_json_equality": report == original_report,
        "report_differences": differences(original_report, report),
        "units": report["units"], "overall_status": report["status"],
        "prediction_rows": len(predictions), "unique_prediction_ids": len(indexed_predictions),
        "missing_prediction_ids": missing,
        "target_statuses": dict(Counter(target["status"] for target in report["targets"])),
        "all_structural_checks": counts(all_checks), "gate_checks": counts(gates),
        "nongate_structural_checks": counts(nongates),
        "checks_in_missing_predictions": counts(missing_prediction_checks),
        "checks_in_supplied_predictions": counts(supplied_prediction_checks),
        "structural_unknown_reasons": dict(reason_counts), "gate_unknown_reasons": dict(gate_reasons),
        "nongate_unknown_reasons": dict(nongate_reasons),
        "semantic": report["semantic"], "semantic_reasons": dict(semantic_reasons),
        "context_coverage": report["context_coverage"], "token_measurements": report["token_measurements"],
        "history_exposure": report["history_exposure"], "history_reasons": dict(history_reasons),
        "by_metric": {key: counts(value) for key, value in sorted(checks_by_metric.items())},
        "by_family": {key: counts(value) for key, value in sorted(by_family.items())},
        "by_scenario": {key: counts(value) for key, value in sorted(by_scenario.items())},
        "by_interpretation": {key: {kind: counts(items) for kind, items in value.items()}
                              for key, value in sorted(by_interpretation.items())},
        "failure_checks": failures,
        "limits": ["Exact agreement with the scorer does not authenticate supplied evidence or capture completeness.",
                   "Failure metric categories do not establish runtime-versus-adapter causes.",
                   "No semantic judgments are inferred from structural results.",
                   "Raw model requests, actual customer logs, keys, and live services were not read."]
    }
    assert len(all_checks) == manifest["counts"]["checks"] == 470
    assert counts(gates) == {key: report["gate_overall"][key] for key in ("planned", "passed", "failed", "unknown")}
    assert counts(all_checks) == {key: sum(metric[key] for metric in report["metrics"].values())
                                  for key in ("planned", "passed", "failed", "unknown")}
    save(output, "score_audit.report.json", report)
    save(output, "score_audit.json", audit)
    print(json.dumps({key: audit[key] for key in (
        "report_exact_json_equality", "source_hashes", "missing_prediction_ids", "all_structural_checks",
        "gate_checks", "nongate_structural_checks", "structural_unknown_reasons", "gate_unknown_reasons",
        "semantic_reasons", "target_statuses", "by_interpretation")}, ensure_ascii=False, indent=2))
    return int(not audit["report_exact_json_equality"])


if __name__ == "__main__":
    raise SystemExit(main())
