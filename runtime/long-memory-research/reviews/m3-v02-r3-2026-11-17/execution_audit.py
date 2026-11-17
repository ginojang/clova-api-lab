#!/usr/bin/env python3
"""Read pinned synthetic r3 artifacts; never run the adapter or read server logs."""
import hashlib
import json
import subprocess
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
REPORT = "ec3c9b262a14ffe07958b09f77d8b6e2b3de2481"
RUNTIME = "a315c32c008694e52b0fcfc11651ae986340a7ad"
ADAPTER = "41df84e975c390b6255f7100479164f55bc0f1d8"
BUNDLE = "7b9b9443d8b885742f66aa40d4308018ec46303a"
BASE = "elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/"
ADAPTER_PATH = "elda-orchestrator/src/tools/m3v02Run.ts"
input_hashes = {}


def blob(ref, path):
    if path.endswith(('.log', '.gz')):
        raise ValueError("server logs are outside this audit")
    data = subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT)
    input_hashes[f"{ref}:{path}"] = hashlib.sha256(data).hexdigest()
    return data


def artifact(name):
    return blob(REPORT, BASE + name)


def rows(data):
    return [json.loads(line) for line in data.splitlines() if line]


def duplicates(values):
    return [{"key": key, "count": count} for key, count in Counter(values).items() if count > 1]


def dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


meta = json.loads(artifact("run_meta.json"))
receipts = rows(artifact("t_receipts.jsonl"))
events = rows(artifact("run_events.jsonl"))
blind = rows(blob(BUNDLE, "runtime/long-memory-research/eval-v1/blind/scenarios.jsonl"))
adapter_hashes = {ref: hashlib.sha256(blob(ref, ADAPTER_PATH)).hexdigest()
                  for ref in (REPORT, RUNTIME, ADAPTER)}
event_by_id = {event.get("id", event.get("probe")): event for event in events
               if event.get("id", event.get("probe"))}
receipt_by_event = {receipt["ev"]: receipt for receipt in receipts}
settle_sources = {}
input_events = {}
for story in blind:
    for cp in story["checkpoints"]:
        for event in cp["events"]:
            input_events[event["id"]] = event
            if event.get("action") == "settle_turn":
                settle_sources[event["id"]] = event["params"]["source_event_id"]

groups = defaultdict(list)
for receipt in receipts:
    groups[receipt["cid"]].append(receipt)

settles = []
for event in events:
    if event["ev"] != "settle":
        continue
    source = settle_sources[event["id"]]
    receipt = receipt_by_event.get(source)
    actual = receipt.get("t_receipt") if receipt else None
    settles.append({"id": event["id"], "source_event_id": source,
                    "settle_ok": event["ok"], "settle_at": event["t"],
                    "receipt_present": actual is not None,
                    "receipt_ok": actual.get("ok") if actual else None,
                    "receipt_at": actual.get("ts") if actual else None,
                    "receipt_before_settle": bool(actual and dt(actual["ts"]) <= dt(event["t"]))})

failed = []
for receipt in receipts:
    actual = receipt.get("t_receipt")
    if actual is None or actual.get("ok") is not False:
        continue
    event = event_by_id.get(receipt["ev"], {})
    failed.append({"delivery": receipt, "story": event.get("story"), "checkpoint": event.get("k"),
                   "source_text": input_events.get(receipt["ev"], {}).get("text"),
                   "following_settles": [settle for settle in settles if settle["source_event_id"] == receipt["ev"]]})

affected_probes = []
for event in events:
    if event.get("story") != "n11-guest" or event["ev"] not in ("probe", "probe_invalid"):
        continue
    raw = json.loads(artifact(f"raw/{event['probe']}.json"))
    affected_probes.append({"event": event, "invalid_observation": raw["invalid_observation"],
                            "notes": raw["notes"], "snapshot_fact_rows": len(raw["observed_db"]["_facts"]),
                            "snapshot_started": raw["observed_db"]["_obs_start"]})

delivery_events = [event for event in events if event["ev"] in
                   ("turn", "turn_notification_fixture", "retry_turn", "probe", "probe_invalid")]
delivery_event_ids = [event.get("id", event.get("probe")) for event in delivery_events]
receipt_event_ids = [receipt["ev"] for receipt in receipts]
checks = {
    "adapter_hash_matches_metadata_at_all_three_refs": all(value == meta["adapter_sha256"] for value in adapter_hashes.values()),
    "runtime_metadata_ref_matches_pinned_runtime": meta["runtime_ref"].endswith("@" + RUNTIME),
    "delivery_event_multiset_equals_receipt_event_multiset": Counter(delivery_event_ids) == Counter(receipt_event_ids),
    "all_200_match_by_key": len(receipts) == 200 and all(row["match"] == "turn_index" for row in receipts),
    "all_200_nth_agree": len(receipts) == 200 and all(row["nth_agrees"] is True for row in receipts),
    "all_receipt_turn_indexes_match_delivery": all(row["t_receipt"] is not None and row["chat_turn"] == row["t_receipt"]["turn_index"] for row in receipts),
    "all_selected_turn_ids_present": all(type(row["t_receipt"].get("turn_id")) is int for row in receipts),
    "per_cid_delivery_numbers_contiguous": all([row["n"] for row in group] == list(range(1, len(group) + 1)) for group in groups.values()),
    "per_cid_selected_completion_timestamps_nondecreasing": all([row["t_receipt"]["ts"] for row in group] == sorted(row["t_receipt"]["ts"] for row in group) for group in groups.values()),
    "selected_receipt_not_before_delivery": all(dt(row["t_receipt"]["ts"]) >= dt(row["at"]) for row in receipts),
    "all_settles_have_source_receipt_before_completion": all(row["receipt_before_settle"] for row in settles),
}
result = {
    "audit": "r3 adapter execution/receipt static audit",
    "report_ref": REPORT, "runtime_ref": RUNTIME, "adapter_commit": ADAPTER, "bundle_ref": BUNDLE,
    "adapter_sha256": adapter_hashes,
    "run_started": meta["started"], "last_event": events[-1],
    "receipt_count": len(receipts), "conversation_count": len(groups),
    "receipt_ok_counts": dict(Counter(str(row["t_receipt"]["ok"]).lower() for row in receipts)),
    "receipt_match_counts": dict(Counter(row["match"] for row in receipts)),
    "fixture_counts": dict(Counter(str(row["fixture"]).lower() for row in receipts)),
    "duplicate_selected_cid_turn_keys": duplicates((row["cid"], row["chat_turn"]) for row in receipts),
    "duplicate_selected_turn_ids": duplicates(row["t_receipt"]["turn_id"] for row in receipts),
    "duplicate_delivery_event_ids": duplicates(receipt_event_ids),
    "event_counts": dict(Counter(event["ev"] for event in events)),
    "settle_count": len(settles), "settle_true_on_failed_receipt_count": sum(row["settle_ok"] and row["receipt_ok"] is False for row in settles),
    "failed_receipts": failed, "affected_family_probes": affected_probes,
    "checks": checks,
    "metadata_settle_text": meta["settle"],
    "scope_limits": [
        "200/200 is selected delivery-to-receipt binding, not 200 successful T results: 196 true and 4 false.",
        "Export selects first matching key; it is not an unfiltered per-attempt ledger. No complete-log duplicate/failure census was performed.",
        "turn_id is receipt-only; delivery chat_turn is inferred from increased max(turn_index), not a request-returned turn id.",
        "All four T failures occurred in n11-guest checkpoint 2; every corresponding settle returned true. n11 checkpoints 2/3 still emitted predictions.",
        "Failure reason is omitted from receipt export, although source logger includes reason; it cannot be recovered from these receipts.",
        "No server logs, live services, DB, API, adapter or model were run/read. Runtime dist hash is metadata, not an independently rebuilt artifact.",
        "No automatic score or denominator changes: operational preparation status and end-to-end observed model outcomes must be reported separately.",
    ],
    "input_sha256": input_hashes,
}
assert all(checks.values()), checks
assert not result["duplicate_selected_cid_turn_keys"]
assert not result["duplicate_selected_turn_ids"]
assert len(failed) == 4 and all(row["story"] == "n11-guest" and row["checkpoint"] == 2 for row in failed)
assert len(settles) == 94
(OUT / "execution_audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"checks": checks, "receipts": len(receipts), "ok": result["receipt_ok_counts"],
                  "settles": len(settles), "failed_but_settled": result["settle_true_on_failed_receipt_count"]}, ensure_ascii=False))
