#!/usr/bin/env python3
"""Extract committed synthetic r4 cases; no models, services, DB or logs."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RESULT = "adf49beb0fb094074a36030db09451d70875a796"
RUNTIME = "847c482038c80fef77b44c20d897de9adf42e711"
BUNDLE = "b8d1c47a06c4fb245660ffa3c2c2063d492cb903"
PREFIX = "elda-orchestrator/measurements/eldacore/m3v02_20261117_r4/"
SOURCE = "elda-orchestrator/src/core/eldacore/s6chatEnd.ts"


def audit():
    hashes = {}

    def read(ref, path):
        if path.endswith((".gz", ".log")):
            raise ValueError("server logs are outside this audit")
        data = subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT)
        hashes[f"{ref}:{path}"] = hashlib.sha256(data).hexdigest()
        return data.decode()

    def rows(path):
        return [json.loads(line) for line in read(RESULT, PREFIX + path).splitlines()]

    def locations(text, needle):
        return [i for i, line in enumerate(text.splitlines(), 1) if needle in line]

    mapping = json.loads(read(BUNDLE, "runtime/long-memory-research/eval-v1/private/blind_map.json"))
    scenarios = [json.loads(line) for line in read(BUNDLE, "runtime/long-memory-research/eval-v1/scenarios.jsonl").splitlines()]
    gold = [json.loads(line) for line in read(BUNDLE, "runtime/long-memory-research/eval-v1/gold.jsonl").splitlines()]
    meta = json.loads(read(RESULT, PREFIX + "run_meta.json"))
    events = rows("run_events.jsonl")
    ledger = rows("ltm_op_dump.jsonl")
    receipts = rows("t_receipts.jsonl")
    predictions = {row["id"]: row for row in rows("predictions.jsonl")}
    source = read(RUNTIME, SOURCE)
    adapter_path = "elda-orchestrator/src/tools/m3v02Run.ts"
    adapter = read(RUNTIME, adapter_path)
    displayed = read(RESULT, PREFIX + "c_raw_n08_n10.txt")
    display_rows = []
    lines = displayed.splitlines()
    for i in range(0, len(lines), 2):
        header = re.match(r"== (n\d+-\w+) C# (\d+) ", lines[i])
        assert header and lines[i + 1].startswith("  raw: ")
        display_rows.append({"story": header[1], "ordinal": int(header[2]), "raw": lines[i + 1][7:]})

    cases = {}
    for story_id in ("n08-signage", "n08-guest", "n10-signage", "n10-guest", "n14-signage"):
        story = next(s for s in scenarios if s["id"] == story_id)
        captures = []
        for k in (1, 2, 3):
            target = f"{story_id}-q{k}"
            blind = mapping["targets"][target]
            path = PREFIX + "raw/" + blind + ".json"
            raw = json.loads(read(RESULT, path))
            observation = raw["observed_db"]
            assistant = [{"brain_message_index": i, "text": m["content"]}
                         for i, m in enumerate(raw["request"]["messages"])
                         if m["role"] == "assistant"]
            probe_events = [{"line": i, "event": e} for i, e in enumerate(events, 1) if e.get("probe") == blind]
            captures.append({
                "target": target, "raw_path": path, "in_predictions": target in predictions,
                "real_cid": raw["real_cid"], "notes": raw["notes"],
                "invalid_observation": raw["invalid_observation"], "c_runs": raw["c_runs"],
                "observation": {key: observation.get(key) for key in (
                    "principal_values", "current_values", "needs_confirm", "episode_values", "must_repeat_values",
                    "ops", "dropped_reasons", "_profile", "_op_boundary", "_obs_start")},
                "brain_history_assistant_messages_not_C_request": assistant,
                "fresh_customer_memory_blocks": re.findall(r"<customer_memory>[\s\S]*?</customer_memory>",
                    raw["before_response"].get("hookSpecificOutput", {}).get("additionalContext", "")),
                "answer": raw["answer"],
                "probe_events": probe_events,
            })
        cid = captures[0]["real_cid"]
        cases[story_id] = {
            "canonical_events": [e for cp in story["checkpoints"] for e in cp["events"]],
            "captures": captures,
            "ledger_rows": [{"line": i, "row": r} for i, r in enumerate(ledger, 1) if r["cid"] == cid],
            "T_receipts": [{"line": i, "row": r} for i, r in enumerate(receipts, 1) if r["cid"] == cid],
        }

    c_checks = []
    for story_id in ("n08-signage", "n08-guest", "n10-signage", "n10-guest"):
        runs = cases[story_id]["captures"][-1]["c_runs"]
        for n, run in enumerate(runs, 1):
            summary = run["sum"]
            model = json.loads(summary["raw"])
            text_row = next(x for x in display_rows if x["story"] == story_id and x["ordinal"] == n)
            matching_events = [{"line": i, "t": e["t"], "ev": e["ev"]}
                               for i, e in enumerate(events, 1) if e.get("sum") == summary]
            assert text_row["raw"] == summary["raw"] and len(matching_events) == 1
            assert len(model.get("promises", [])) == summary["promises_seen"]
            c_checks.append({"story": story_id, "ordinal": n, "summary": summary,
                             "parsed_raw": model, "matches_displayed_raw": True,
                             "matching_run_event": matching_events[0]})
    assert len(c_checks) == len(display_rows) == 8
    for domain, expected in (("signage", [0, 0, 1]), ("guest", [0, 0, 0])):
        assert [x["summary"]["promises_seen"] for x in c_checks if x["story"] == "n08-" + domain] == expected
    signage = next(x for x in c_checks if x["story"] == "n08-signage" and x["ordinal"] == 3)
    promise = signage["parsed_raw"]["promises"][0]
    assert promise["evidence"]["turn_index"] == 9 and signage["summary"]["s6"]["9"] == "pass"
    assert promise["p_yes"] == 0.15 and signage["summary"]["applied"] == 1
    applied = [x for x in cases["n08-signage"]["ledger_rows"] if x["row"]["kind"] == "promise"]
    assert len(applied) == 1 and applied[0]["row"]["applied"] and applied[0]["row"]["p_yes"] == 0.15
    for domain in ("signage", "guest"):
        run = next(x for x in c_checks if x["story"] == "n10-" + domain)
        assert run["parsed_raw"]["episode"] is None and run["summary"]["episode"] is False
        captures = cases["n10-" + domain]["captures"]
        assert all(len(c["c_runs"]) == 1 for c in captures)
        assert all("k2:advance_time_unsupported" in c["invalid_observation"] for c in captures[1:])
    n14 = cases["n14-signage"]
    correction = next(x for x in n14["T_receipts"] if x["row"]["chat_turn"] == 3)
    detail = correction["row"]["t_receipt"]["ops_detail"]
    assert detail == [{"op": "SUPERSEDE", "slot": "preference", "downgraded": None,
                       "downgraded_why": None, "ce_turn": 3, "ev_turn": 3}]
    assert correction["row"]["t_receipt"]["downgraded"] == 0
    assert any(x["row"]["op"] == "SUPERSEDE" and x["row"]["applied"] for x in n14["ledger_rows"])

    return {
        "source_commit": RESULT, "runtime_commit": RUNTIME, "bundle_commit": BUNDLE,
        "scope": "Static committed synthetic cases and source; no APIs, model calls, DB or server logs.",
        "run_id": meta["run_id"], "late_judge": meta["dev_env_overrides"]["LTM_LATE_JUDGE"],
        "C_raw_display_matches_all_eight_event_summaries": True,
        "cases": cases, "C_calls": c_checks,
        "n08_signage_q3_projection": {
            "gold": next(x for x in gold if x["id"] == "n08-signage-q3"),
            "prediction": predictions["n08-signage-q3"],
            "full_C_promise_t": promise["t"],
            "applied_t": signage["summary"]["applied_t"],
            "adapter_source_lines": {"path": adapter_path,
                "harvest_drops_next_visit_prefix": locations(adapter, "const a2 ="),
                "harvest_second_prefix_drop": locations(adapter, "const a3 ="),
                "values_are_vocabulary_matches": locations(adapter, "const valuesIn ="),
                "must_repeat_projection": locations(adapter, "must_repeat_values: valuesIn(")},
            "meaning": "Full promise is present in C raw/applied_t and the fresh memory block, but observed value arrays keep only the harvested shorter substring. Exact gold array membership therefore fails; this is not evidence of no promise storage or recall.",
            "raw_stored_fact_value_available": False,
        },
        "source_line_refs": {key: locations(source, needle) for key, needle in {
            "gather_human_assistant_numbering": "turns.push({ turn_index:",
            "S6_is_for_assistant_turns": "for (const t of turns) if (t.speaker === 'assistant') s6[",
            "C_payload_not_in_summary": "content: JSON.stringify({ turns: inp.turns",
            "model_none_remap": "const s6ForModel:",
            "raw_before_failure_return": "sum.raw = c.raw;",
            "p_yes_passed_to_SQL": "typeof p.p_yes === 'number' ? p.p_yes : null",
            "episode_presence_gate": "if (!epochStale && j.episode && Array.isArray(j.episode.did))",
        }.items()},
        "limits": [
            "C raw is returned model content, not the exact C request, HTTP trace, or item-level DB receipt.",
            "Brain history shows the earlier denials and later repeated promise; correspondence to C numbering is supported by source and model references but exact gathered C payload is not captured.",
            "With late judge off, model-visible none becomes unknown. The summary retains original none; these maps must not be equated.",
            "n08-signage raw contains a candidate contradicting its own why; guest raw has no promise. Self-explanations support a failure hypothesis, not an isolated causal experiment.",
            "n10 C1 returns episode:null, so this runtime branch does not attempt episode INSERT. Why the model omitted it is unmeasured.",
            "n10 C1 S6 has one assistant source key1; this does not establish that the full C input contained only one turn.",
            "n10 k2/k3 retain a historical C summary but add no C call and have invalid probes; later retention/expiration behavior is unmeasured.",
            "n14 ce_turn3 and downgrade0 are now recorded, but no exact correction_evidence text/offset/n is supplied. Ordinary evidence offsets are not correction offsets.",
            "A minimum p_yes cutoff above 0.15 would discard this applied promise matching the sealed expectation; this audit does not calibrate confidence or estimate threshold performance.",
            "Source, snapshots and ledger do not independently authenticate live deployment or all possible persistence failures.",
        ],
        "input_sha256": hashes,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path, default=HERE / "runtime_cases.json")
    args = p.parse_args()
    result = audit()
    with args.output.open("x", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    print("PASS: eight C summaries/raws aligned; n08 counts, n10 null/taint and n14 keyed operation verified")


if __name__ == "__main__":
    main()
