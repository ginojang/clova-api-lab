#!/usr/bin/env python3
"""Offline v0.2 scoring of supplied full-input observations; no services.

Observation extension to the frozen CONTRACT.md:
  artifacts.context is an object. Arrays fresh_values, history_memory_values,
  effective_active_values, all_input_values, withdrawn_slots, rendered_item_ids,
  recorded_item_ids contain strings; the two item ID arrays must be unique.
  capture_complete/emitted/replacement_header are strict booleans. fresh_tokens
  is a nonnegative integer. capture_ref/capture_sha256 identify the supplied
  capture; their existence/format does not authenticate its completeness.
  token_method actual, actual_tokenizer, or tokenizer:<nonempty identity> means
  an externally supplied actual count. estimate, approximate, tokensEst, or
  estimate:<method> means an estimate. Other/missing methods cannot substantiate
  an exact token bound. Estimates stay visible in diagnostics, not exact checks.
  artifacts.load_projection_matches (also its context alias) is recomputed from
  the two captured item ID sets; any supplied boolean is ignored.
  artifacts.history_watch_values is a string array produced from observed
  transitions. Its intersection with captured history_memory_values is counted
  independently of replacement_header and independently of the policy result.
  Optional gold.history_watch_values fixes the expected watch coverage. Missing
  observed watch values yield unknown; gold never supplies missing observations.
  An explicitly empty gold watch list is not_applicable. All target denominators
  are retained, with relevant_planned reported separately. Zero measured watched
  values cannot establish strict zero exposure, including legacy fixtures.
  c_completed/source_bound/late_commit_accepted/old_process_closed and optional
  causal/job information remain externally supplied observations backed by row
  evidence.source_ref/source_sha256. No timestamp join, missing epoch, absent
  job result, or receipt alone is converted into causal/source-binding success.

The v0.1 implementation is reused as an exact hash-pinned local copy. Inputs
are validated before masking unavailable context, so malformed observations do
not become unknown. Raw input hashes always refer to original input bytes.
"""

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


BASE_SHA256 = "e3f38706897b2a3b56234aadae3109f497367ffd419b0013807fd596c61786ad"
BASE_PATH = Path(__file__).with_name("_base_scorer.py")
if hashlib.sha256(BASE_PATH.read_bytes()).hexdigest() != BASE_SHA256:
    raise RuntimeError("hash-pinned _base_scorer.py differs from sealed v0.1")
_SPEC = importlib.util.spec_from_file_location("_m3_v02_base_scorer", BASE_PATH)
base = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(base)
InputError = base.InputError
read_jsonl = base.read_jsonl
require = base.require

CONTEXT_ARRAYS = {
    "fresh_values", "history_memory_values", "effective_active_values",
    "all_input_values", "withdrawn_slots", "rendered_item_ids", "recorded_item_ids",
}
CONTEXT_BOOLS = {"capture_complete", "emitted", "replacement_header", "load_projection_matches"}
CONTEXT_STRINGS = {"capture_ref", "capture_sha256", "token_method"}
NEW_BOOLS = {"c_completed", "source_bound", "old_process_closed", "load_projection_matches"}
NEW_ARRAYS = {"history_watch_values", "dropped_reasons", "auto_episode_values"}
ID_ARRAYS = {"rendered_item_ids", "recorded_item_ids"}


def string_array(value, where, *, unique=False):
    require(type(value) is list and all(type(item) is str for item in value),
            f"{where}: expected string array")
    if unique:
        require(all(item.strip() for item in value), f"{where}: empty item ID")
        require(len(set(value)) == len(value), f"{where}: duplicate item ID")


def validate_extension(row):
    identifier, artifacts = row["id"], row["artifacts"]
    for key in NEW_BOOLS:
        if key in artifacts:
            require(type(artifacts[key]) is bool, f"{identifier}.artifacts.{key}: expected bool")
    for key in NEW_ARRAYS:
        if key in artifacts:
            string_array(artifacts[key], f"{identifier}.artifacts.{key}")
    if "relation_prior_count" in artifacts:
        value = artifacts["relation_prior_count"]
        require(type(value) is int and value >= 0,
                f"{identifier}.artifacts.relation_prior_count: expected nonnegative integer")
    if "context" not in artifacts:
        return
    context = artifacts["context"]
    require(type(context) is dict, f"{identifier}.artifacts.context: expected object")
    for key, value in context.items():
        where = f"{identifier}.artifacts.context.{key}"
        if key in CONTEXT_ARRAYS:
            string_array(value, where, unique=key in ID_ARRAYS)
        elif key in CONTEXT_BOOLS:
            require(type(value) is bool, f"{where}: expected bool")
        elif key in CONTEXT_STRINGS:
            require(type(value) is str, f"{where}: expected string")
            if key == "capture_sha256":
                require(base.SHA256.fullmatch(value) is not None, f"{where}: invalid SHA-256")
        elif key == "fresh_tokens":
            require(type(value) is int and value >= 0,
                    f"{where}: expected nonnegative integer, not bool")


def index_gold(rows):
    """Public bundle validation entry point, including v0.2 gold metadata."""
    indexed = base.index_gold(rows)
    for identifier, row in indexed.items():
        if "history_watch_values" in row:
            values = row["history_watch_values"]
            string_array(values, f"{identifier}.history_watch_values")
            require(len(set(values)) == len(values),
                    f"{identifier}.history_watch_values: duplicate expected value")
    return indexed


def index_predictions(rows, gold):
    """Validate original observations before capture-dependent masking."""
    indexed, run_id = base.index_predictions(rows, gold)
    for row in indexed.values():
        validate_extension(row)
    return indexed, run_id


def capture_reason(row):
    if row is None:
        return "missing_prediction"
    if not base.evidence_present(row):
        return "missing_evidence"
    context = row["artifacts"].get("context", {})
    if context.get("capture_complete") is not True:
        return "incomplete_context_capture"
    if not context.get("capture_ref", "").strip() or not context.get("capture_sha256"):
        return "missing_context_capture_provenance"
    return None


def token_kind(method):
    if method in ("actual", "actual_tokenizer") or (
            method.startswith("tokenizer:") and method[len("tokenizer:"):].strip()):
        return "actual_tokenizer"
    if method in ("estimate", "approximate", "tokensEst") or (
            method.startswith("estimate:") and method[len("estimate:"):].strip()):
        return "estimate"
    return "unknown"


def normalized_prediction(row):
    """Return a private projection, never alter the caller's observations."""
    normalized = copy.deepcopy(row)
    artifacts = normalized["artifacts"]
    artifacts.pop("load_projection_matches", None)
    if capture_reason(row):
        artifacts.pop("context", None)
        return normalized
    context = artifacts["context"]
    context.pop("load_projection_matches", None)
    if ID_ARRAYS <= context.keys():
        matches = set(context["rendered_item_ids"]) == set(context["recorded_item_ids"])
        artifacts["load_projection_matches"] = matches
        context["load_projection_matches"] = matches
    if token_kind(context.get("token_method", "")) != "actual_tokenizer":
        # An estimate may pass an estimate-specific diagnostic, never an exact
        # fresh_tokens budget check. The unmodified count is reported below.
        context.pop("fresh_tokens", None)
    return normalized


def unavailable_reason(row, check):
    parts = base.pointer_parts(check["path"])
    is_context = parts[:2] == ["artifacts", "context"]
    is_projection = parts[:2] == ["artifacts", "load_projection_matches"]
    if not (is_context or is_projection):
        return None
    reason = capture_reason(row)
    if reason:
        return reason
    context = row["artifacts"]["context"]
    if is_projection or parts[2:3] == ["load_projection_matches"]:
        if not ID_ARRAYS <= context.keys():
            return "missing_projection_item_ids"
    if parts[2:3] == ["fresh_tokens"] and token_kind(context.get("token_method", "")) != "actual_tokenizer":
        return "actual_tokenizer_count_required"
    return None


def history_observation(row, expected=None):
    expected_watch = (expected or {}).get("history_watch_values")
    if expected_watch == []:
        return {"status": "not_applicable", "reason": "no_expected_history_watch_values",
                "expected_watch_count": 0, "watched_count": None,
                "exposed_count": None, "exposed_values": None}
    reason = capture_reason(row)
    artifacts = row["artifacts"] if row is not None else {}
    context = artifacts.get("context", {})
    expected_count = len(expected_watch) if expected_watch is not None else None
    if not reason and expected_watch and not set(expected_watch).issubset(
            artifacts.get("history_watch_values", [])):
        reason = "watch_projection_incomplete"
    if not reason and "history_watch_values" not in artifacts:
        reason = "missing_history_watch_values"
    if not reason and "history_memory_values" not in context:
        reason = "missing_history_memory_values"
    if reason:
        return {"status": "unknown", "reason": reason, "watched_count": None,
                "expected_watch_count": expected_count, "exposed_count": None, "exposed_values": None}
    watched = set(artifacts["history_watch_values"])
    exposed = sorted(watched.intersection(context["history_memory_values"]))
    return {"status": "fail" if exposed else "pass", "reason": "captured_exact_value_intersection",
            "expected_watch_count": expected_count, "watched_count": len(watched),
            "exposed_count": len(exposed), "exposed_values": exposed}


def history_tally(entries):
    relevant = [entry for entry in entries if entry["status"] != "not_applicable"]
    summary = base.tally(entry["status"] for entry in relevant)
    measured_watch = sum(entry["watched_count"] for entry in entries if entry["watched_count"] is not None)
    strict_status = summary["status"]
    if strict_status == "pass" and measured_watch == 0:
        strict_status = "incomplete"
    summary.update(
        planned=len(entries), relevant_planned=len(relevant), not_applicable=len(entries) - len(relevant),
        pass_rate_planned=summary["passed"] / len(entries) if entries else None,
        pass_rate_relevant=summary["passed"] / len(relevant) if relevant else None,
        status=strict_status, strict_zero_status=strict_status, policy_gate=False,
        measured_watch_values=measured_watch,
        measured_exposed_values=sum(entry["exposed_count"] for entry in entries if entry["exposed_count"] is not None),
        unit="target/value pairs; repeated checkpoints are not independent",
    )
    return summary


def token_observation(row):
    reason = capture_reason(row)
    context = row["artifacts"].get("context", {}) if row is not None else {}
    method = context.get("token_method")
    if reason:
        return {"kind": "unknown", "reason": reason, "token_method": method, "fresh_tokens": None}
    if "fresh_tokens" not in context:
        return {"kind": "unknown", "reason": "missing_fresh_tokens", "token_method": method, "fresh_tokens": None}
    kind = token_kind(method or "")
    return {"kind": kind, "reason": "externally_supplied_count" if kind != "unknown" else "unrecognized_token_method",
            "token_method": method, "fresh_tokens": context["fresh_tokens"]}


def score(gold_rows, prediction_rows, input_hashes=None):
    gold = index_gold(gold_rows)
    # Validate observed operand types before unavailable context is masked.
    predictions, _ = index_predictions(prediction_rows, gold)
    normalized = [normalized_prediction(row) for row in predictions.values()]
    report = base.score(gold_rows, normalized, input_hashes)
    report.update(schema_version="0.2", base_scorer_sha256=BASE_SHA256,
                  context_provenance="externally supplied capture and projections; not independently authenticated",
                  policy_pass_implies_history_zero_exposure=False,
                  causal_provenance="externally supplied source/job/epoch links; no timestamp inference")
    captures, histories, token_counts = [], [], {"actual_tokenizer": 0, "estimate": 0, "unknown": 0}
    exposure_by_interpretation = {}
    for target in report["targets"]:
        identifier = target["id"]
        row = predictions.get(identifier)
        expected = {check["id"]: check for check in gold[identifier]["checks"]}
        for observed in target["checks"]:
            if observed["status"] == "unknown":
                reason = unavailable_reason(row, expected[observed["id"]])
                if reason:
                    observed["reason"] = reason
        capture = {"status": "unknown", "reason": capture_reason(row)}
        if capture["reason"] is None:
            capture = {"status": "pass", "reason": "externally_supplied_complete_capture"}
        target["context_capture"] = capture
        captures.append(capture["status"])
        exposure = history_observation(row, gold[identifier])
        target["history_exposure"] = exposure
        histories.append(exposure)
        exposure_by_interpretation.setdefault(target["interpretation"], []).append(exposure)
        tokens = token_observation(row)
        target["token_measurement"] = tokens
        token_counts[tokens["kind"]] += 1
    report["context_coverage"] = base.tally(captures)
    history_summary = history_tally(histories)
    history_summary["by_interpretation"] = {
        key: history_tally(exposure_by_interpretation[key]) for key in sorted(exposure_by_interpretation)
    }
    report["history_exposure"] = history_summary
    report["token_measurements"] = {"planned": len(gold), **token_counts,
                                    "exact_budget_uses": "actual_tokenizer_only"}
    return report


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
        if args.output is None:
            sys.stdout.write(serialized)
        else:
            with args.output.open("x", encoding="utf-8") as output:
                output.write(serialized)
        return 0 if report["status"] == "pass" else 1
    except (InputError, OSError, ValueError, RecursionError) as exc:
        print(json.dumps({"status": "input_error", "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
