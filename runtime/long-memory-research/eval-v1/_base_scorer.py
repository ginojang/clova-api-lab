#!/usr/bin/env python3
"""Offline scoring of supplied observations; never calls a model or a service."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys


class InputError(ValueError):
    """The input cannot be evaluated under CONTRACT.md."""


OPERATORS = {"eq", "contains", "excludes", "set_eq", "lte"}
SHA256 = re.compile(r"[0-9a-fA-F]{64}\Z")
MISSING = object()
ARTIFACT_TYPES = {
    "current_values": list,
    "retrieved_values": list,
    "injected_values": list,
    "ops": list,
    "command": (str, type(None)),
    "needs_confirm": bool,
    "block_tokens": int,
    "late_commit_accepted": bool,
    "memory_epoch": int,
    "episode_values": list,
    "principal_values": list,
    "ltm_reads": int,
    "ltm_writes": int,
    "paused": bool,
    "resume_allowed": bool,
    "must_repeat_values": list,
    "episode_sources": dict,
}
NONNEGATIVE_COUNTERS = {"block_tokens", "memory_epoch", "ltm_reads", "ltm_writes"}


def require(condition, message):
    if not condition:
        raise InputError(message)


def text_field(obj, key, where, *, nonempty=True):
    require(key in obj and type(obj[key]) is str, f"{where}.{key}: expected string")
    if nonempty:
        require(bool(obj[key].strip()), f"{where}.{key}: empty string")
    return obj[key]


def validate_json(value, where="JSON"):
    """Reject non-JSON Python values and overflowed JSON floats as well."""
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float:
        require(math.isfinite(value), f"{where}: non-finite number")
        return
    if type(value) is list:
        for i, item in enumerate(value):
            validate_json(item, f"{where}[{i}]")
        return
    if type(value) is dict:
        for key, item in value.items():
            require(type(key) is str, f"{where}: non-string object key")
            validate_json(item, f"{where}.{key}")
        return
    raise InputError(f"{where}: unsupported JSON type")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise InputError(f"non-finite JSON constant: {value}")


def read_jsonl(path):
    raw = Path(path).read_bytes()
    try:
        content = raw.decode("utf-8")
    except UnicodeError as exc:
        raise InputError(f"{path}: invalid UTF-8") from exc
    rows = []
    # JSONL records are LF-delimited. Unicode line separators are valid inside
    # JSON strings and must remain part of the original answer and its digest.
    for number, line in enumerate(content.split("\n"), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line, object_pairs_hook=unique_object,
                             parse_constant=reject_constant)
            validate_json(row)
            require(type(row) is dict, "expected JSON object")
        except (ValueError, RecursionError) as exc:
            raise InputError(f"{path}:{number}: {exc}") from exc
        rows.append(row)
    return rows, hashlib.sha256(raw).hexdigest()


def strict_equal(left, right):
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return left.keys() == right.keys() and all(
            strict_equal(left[key], right[key]) for key in left)
    if type(left) is list:
        return len(left) == len(right) and all(
            strict_equal(a, b) for a, b in zip(left, right))
    return left == right


def has_duplicates(values):
    return any(any(strict_equal(value, prior) for prior in values[:i])
               for i, value in enumerate(values))


def pointer_parts(path):
    require(type(path) is str and path.startswith("/artifacts/"),
            "check.path: expected /artifacts/... JSON Pointer")
    require(re.search(r"~(?![01])", path) is None, "check.path: invalid ~ escape")
    return [part.replace("~1", "/").replace("~0", "~")
            for part in path.split("/")[1:]]


def resolve_pointer(row, path):
    current = row
    for part in pointer_parts(path):
        if type(current) is dict:
            if part not in current:
                return MISSING
            current = current[part]
        elif type(current) is list:
            if re.fullmatch(r"0|[1-9][0-9]*", part) is None:
                return MISSING
            # Avoid converting arbitrarily long, out-of-range index strings.
            if len(part) > len(str(len(current))):
                return MISSING
            index = int(part)
            if index >= len(current):
                return MISSING
            current = current[index]
        else:
            return MISSING
    return current


def is_number(value):
    return type(value) in (int, float) and (
        type(value) is int or math.isfinite(value))


def evaluate_operator(actual, operator, expected, where):
    if operator == "eq":
        require(type(actual) is type(expected), f"{where}: eq type mismatch")
        return strict_equal(actual, expected)
    if operator in ("contains", "excludes", "set_eq"):
        require(type(actual) is list, f"{where}: expected array")
        if operator == "set_eq":
            return not has_duplicates(actual) and len(actual) == len(expected) and all(
                any(strict_equal(item, other) for other in actual) for item in expected)
        included = any(strict_equal(item, expected) for item in actual)
        return included if operator == "contains" else not included
    require(is_number(actual), f"{where}: lte requires finite number, not bool")
    return actual <= expected


def index_gold(rows):
    indexed = {}
    for row in rows:
        require(type(row) is dict, "gold row: expected object")
        validate_json(row, "gold")
        identifier = text_field(row, "id", "gold")
        require(identifier not in indexed, f"duplicate gold ID: {identifier}")
        for key in ("scenario_id", "family", "domain", "answer_rubric"):
            text_field(row, key, identifier)
        if "interpretation" in row:
            require(type(row["interpretation"]) is str and
                    row["interpretation"] in ("contract", "challenge"),
                    f"{identifier}.interpretation: expected contract or challenge")
        require(type(row.get("positive")) is bool, f"{identifier}.positive: expected bool")
        checks = row.get("checks")
        require(type(checks) is list and len(checks) >= 2,
                f"{identifier}.checks: expected at least two checks")
        seen = set()
        for check in checks:
            require(type(check) is dict, f"{identifier}.check: expected object")
            check_id = text_field(check, "id", identifier)
            require(check_id not in seen, f"{identifier}: duplicate check ID {check_id}")
            seen.add(check_id)
            text_field(check, "metric", identifier)
            require(type(check.get("gate")) is bool, f"{identifier}.{check_id}.gate: expected bool")
            pointer_parts(check.get("path"))
            operator = check.get("operator")
            require(type(operator) is str and operator in OPERATORS,
                    f"{identifier}.{check_id}: unsupported operator")
            require("value" in check, f"{identifier}.{check_id}: missing value")
            value = check["value"]
            if operator == "set_eq":
                require(type(value) is list and not has_duplicates(value),
                        f"{identifier}.{check_id}: set_eq expects unique array")
            if operator == "lte":
                require(is_number(value), f"{identifier}.{check_id}: invalid lte bound")
        indexed[identifier] = row
    return indexed


def validate_provenance(row, identifier):
    for field in ("evidence", "judgment"):
        if field not in row:
            continue
        obj = row[field]
        require(type(obj) is dict, f"{identifier}.{field}: expected object")
        keys = ("source_ref", "source_sha256") if field == "evidence" else (
            "verdict", "answer_sha256", "judge_id", "judge_version", "rationale")
        for key in keys:
            if key in obj:
                require(type(obj[key]) is str, f"{identifier}.{field}.{key}: expected string")
        hash_key = "source_sha256" if field == "evidence" else "answer_sha256"
        if hash_key in obj:
            require(SHA256.fullmatch(obj[hash_key]) is not None,
                    f"{identifier}.{field}.{hash_key}: invalid SHA-256")
        if field == "judgment" and "verdict" in obj:
            require(obj["verdict"] in ("pass", "fail", "unknown"),
                    f"{identifier}.judgment.verdict: invalid verdict")


def index_predictions(rows, gold):
    indexed, runs = {}, set()
    for row in rows:
        require(type(row) is dict, "prediction row: expected object")
        validate_json(row, "prediction")
        identifier = text_field(row, "id", "prediction")
        require(identifier in gold, f"unknown prediction ID: {identifier}")
        require(identifier not in indexed, f"duplicate prediction ID: {identifier}")
        runs.add(text_field(row, "run_id", identifier))
        text_field(row, "answer", identifier, nonempty=False)
        require(type(row.get("artifacts")) is dict, f"{identifier}.artifacts: expected object")
        for key, value in row["artifacts"].items():
            if key in ARTIFACT_TYPES:
                allowed = ARTIFACT_TYPES[key]
                allowed = allowed if type(allowed) is tuple else (allowed,)
                require(type(value) in allowed, f"{identifier}.artifacts.{key}: invalid type")
            if key in NONNEGATIVE_COUNTERS:
                require(value >= 0, f"{identifier}.artifacts.{key}: expected nonnegative integer")
            if key == "ops":
                require(all(type(item) is str for item in value),
                        f"{identifier}.artifacts.ops: expected string elements")
        validate_provenance(row, identifier)
        # Validate all observed operator operands, even if evidence is missing.
        for check in gold[identifier]["checks"]:
            actual = resolve_pointer(row, check["path"])
            if actual is not MISSING:
                evaluate_operator(actual, check["operator"], check["value"],
                                  f"{identifier}.{check['id']}")
        indexed[identifier] = row
    require(len(runs) <= 1, "mixed run_id values")
    return indexed, next(iter(runs), None)


def evidence_present(row):
    evidence = row.get("evidence", {})
    return bool(evidence.get("source_ref", "").strip() and
                evidence.get("source_sha256", ""))


def semantic_result(row):
    if row is None:
        return "unknown", "missing_prediction"
    if not evidence_present(row):
        return "unknown", "missing_evidence"
    judgment = row.get("judgment", {})
    required = ("verdict", "answer_sha256", "judge_id", "judge_version", "rationale")
    if not all(judgment.get(key, "").strip() for key in required):
        return "unknown", "missing_judgment_provenance"
    digest = hashlib.sha256(row["answer"].encode("utf-8")).hexdigest()
    if digest != judgment["answer_sha256"].lower():
        return "unknown", "answer_hash_mismatch"
    return judgment["verdict"], "externally_supplied_judgment"


def tally(statuses):
    counts = {key: 0 for key in ("planned", "passed", "failed", "unknown")}
    for status in statuses:
        counts["planned"] += 1
        counts[{"pass": "passed", "fail": "failed", "unknown": "unknown"}[status]] += 1
    decided = counts["passed"] + counts["failed"]
    counts["pass_rate_planned"] = counts["passed"] / counts["planned"] if counts["planned"] else None
    counts["pass_rate_decided"] = counts["passed"] / decided if decided else None
    counts["status"] = ("fail" if counts["failed"] else
                        "incomplete" if counts["unknown"] or not counts["planned"] else "pass")
    return counts


def score(gold_rows, prediction_rows, input_hashes=None):
    """Score JSON values; supplied judgments are bound but not authenticated."""
    gold = index_gold(gold_rows)
    predictions, run_id = index_predictions(prediction_rows, gold)
    metrics, gates, targets, semantic, overall, gate_statuses = {}, {}, [], [], [], []
    for identifier in sorted(gold):
        expected, row = gold[identifier], predictions.get(identifier)
        observed_checks, target_statuses = [], []
        for check in sorted(expected["checks"], key=lambda item: item["id"]):
            actual = MISSING if row is None else resolve_pointer(row, check["path"])
            if row is None:
                status, reason = "unknown", "missing_prediction"
            elif not evidence_present(row):
                status, reason = "unknown", "missing_evidence"
            elif actual is MISSING:
                status, reason = "unknown", "missing_path"
            else:
                passed = evaluate_operator(actual, check["operator"], check["value"],
                                           f"{identifier}.{check['id']}")
                status, reason = ("pass" if passed else "fail"), "observed_comparison"
            observed_checks.append({"id": check["id"], "metric": check["metric"],
                                    "gate": check["gate"], "status": status, "reason": reason})
            metrics.setdefault(check["metric"], []).append(status)
            if check["gate"]:
                gates.setdefault(check["metric"], []).append(status)
                gate_statuses.append(status)
            target_statuses.append(status)
        semantic_status, semantic_reason = semantic_result(row)
        semantic.append(semantic_status)
        target_statuses.append(semantic_status)
        overall.extend(target_statuses)
        targets.append({"id": identifier, "scenario_id": expected["scenario_id"],
                        "family": expected["family"], "domain": expected["domain"],
                        "interpretation": expected.get("interpretation", "unspecified"),
                        "positive": expected["positive"], "status": tally(target_statuses)["status"],
                        "checks": observed_checks,
                        "semantic": {"status": semantic_status, "reason": semantic_reason}})
    coverage = tally("pass" if identifier in predictions else "unknown" for identifier in gold)
    gate_overall = tally(gate_statuses)
    overall_status = tally(overall)["status"]
    if overall_status == "pass" and gate_overall["status"] != "pass":
        overall_status = "incomplete"
    interpretation_statuses = {}
    for target in targets:
        status = "unknown" if target["status"] == "incomplete" else target["status"]
        interpretation_statuses.setdefault(target["interpretation"], []).append(status)
    return {
        "schema_version": "0.1", "run_id": run_id, "status": overall_status,
        "input_hashes": input_hashes or {},
        "claims_scope": "supplied_observation_projection_only",
        "physical_deletion": "not_measured",
        "judgment_provenance": "externally_supplied; not independently authenticated",
        "deployment_approval": False,
        "units": {"targets": len(gold), "positive_targets": sum(r["positive"] for r in gold.values()),
                  "scenarios": len({r["scenario_id"] for r in gold.values()}),
                  "families": len({r["family"] for r in gold.values()}),
                  "independent_targets_assumed": False},
        "coverage": coverage,
        "metrics": {key: tally(metrics[key]) for key in sorted(metrics)},
        "semantic": tally(semantic),
        "gates": {key: tally(gates[key]) for key in sorted(gates)},
        "gate_overall": gate_overall,
        "by_interpretation": {
            key: tally(interpretation_statuses[key]) for key in sorted(interpretation_statuses)
        },
        "targets": targets,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gold", required=True, type=Path)
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        gold, gold_hash = read_jsonl(args.gold)
        predictions, prediction_hash = read_jsonl(args.predictions)
        report = score(gold, predictions, {"gold_sha256": gold_hash,
                                          "predictions_sha256": prediction_hash})
        serialized = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2,
                                allow_nan=False) + "\n"
        if args.output is not None:
            # Exclusive creation also protects inputs and prevents overwrite races.
            with args.output.open("x", encoding="utf-8") as output:
                output.write(serialized)
        else:
            sys.stdout.write(serialized)
        return 0 if report["status"] == "pass" else 1
    except (InputError, OSError, ValueError, RecursionError) as exc:
        print(json.dumps({"status": "input_error", "error": str(exc)},
                         ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
