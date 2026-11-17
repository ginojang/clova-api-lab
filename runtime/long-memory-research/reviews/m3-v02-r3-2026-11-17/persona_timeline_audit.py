#!/usr/bin/env python3
"""Inspect committed synthetic captures only; no service or model execution."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

SOURCE = "ec3c9b262a14ffe07958b09f77d8b6e2b3de2481"
PREFIX = "elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/"
BUNDLE = "7b9b9443d8b885742f66aa40d4308018ec46303a"
MAP_PATH = "runtime/long-memory-research/eval-v1/private/blind_map.json"
# Approximate rollout time supplied in Comms cfc3df2679, not a DB observation.
REPORTED_ROLLOUT = "2026-11-17T04:56:00.000Z"
HEADER = re.compile(r"\[페르소나 ([^@\s]+)@(\d+) md5:([^\]]+)\]")


def git_bytes(ref, path):
    return subprocess.check_output(["git", "show", f"{ref}:{path}"])


def sha(data):
    return hashlib.sha256(data).hexdigest()


def audit():
    mapping_bytes = git_bytes(BUNDLE, MAP_PATH)
    mapping = json.loads(mapping_bytes)
    inverse = {v: k for k, v in mapping["targets"].items()}
    events_bytes = git_bytes(SOURCE, PREFIX + "run_events.jsonl")
    events = [json.loads(line) for line in events_bytes.splitlines()]
    probe_events = {e["probe"]: e for e in events if "probe" in e}
    predictions_bytes = git_bytes(SOURCE, PREFIX + "predictions.jsonl")
    predictions = {json.loads(line)["id"] for line in predictions_bytes.splitlines()}
    paths = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", SOURCE, PREFIX + "raw/"],
        text=True,
    ).splitlines()
    rows = []
    for path in paths:
        if not path.endswith(".json") or path.endswith(".request.json"):
            continue
        raw_bytes = git_bytes(SOURCE, path)
        raw = json.loads(raw_bytes)
        request_path = path[:-5] + ".request.json"
        request_bytes = git_bytes(SOURCE, request_path)
        request = json.loads(request_bytes)
        headers = []
        scope_statement_count = 0
        for index, message in enumerate(request["messages"]):
            content = message.get("content", "")
            if not isinstance(content, str):
                continue
            scope_statement_count += content.count("이 대화 안**에서만 기억하고, 다른 대화로 넘기지 않습니다.")
            for match in HEADER.finditer(content):
                # The persona paragraph ends at the first blank line in this format.
                block = content[match.start():].split("\n\n", 1)[0]
                headers.append({
                    "message_index": index, "role": message["role"],
                    "persona": match[1], "revision": int(match[2]),
                    "header_md5_prefix": match[3],
                    "paragraph_sha256": sha(block.encode()),
                    "paragraph_chars": len(block),
                    "has_name_line": "이름: 엘다" in block,
                    "has_style_line": "말씨: haeyo · warm · normal" in block,
                    "doing_lines": sum(line.startswith("하는 것:") for line in block.splitlines()),
                    "rule_lines": sum(line.startswith("지키는 것:") for line in block.splitlines()),
                })
        target = inverse[raw["probe"]]
        rows.append({
            "target": target, "probe": raw["probe"],
            "probe_event_utc": probe_events[raw["probe"]]["t"],
            "probe_event_kind": probe_events[raw["probe"]]["ev"],
            "in_predictions": target in predictions, "raw_path": path,
            "raw_sha256": sha(raw_bytes), "request_sha256": sha(request_bytes),
            "request_matches_embedded": request == raw["request"],
            "headers": headers, "current_conversation_only_statement_count": scope_statement_count,
        })
    rows.sort(key=lambda r: r["probe_event_utc"])
    late = [r for r in rows if r["probe_event_utc"] >= REPORTED_ROLLOUT]
    signatures = Counter(
        (h["persona"], h["revision"], h["header_md5_prefix"], h["paragraph_sha256"])
        for row in rows for h in row["headers"]
    )
    return {
        "source_commit": SOURCE, "source_prefix": PREFIX, "bundle_ref": BUNDLE,
        "mapping_sha256": sha(mapping_bytes), "events_sha256": sha(events_bytes),
        "predictions_sha256": sha(predictions_bytes),
        "reported_rollout_utc_approximate": REPORTED_ROLLOUT,
        "raw_requests": len(rows), "emitted_requests": sum(r["in_predictions"] for r in rows),
        "embedded_requests_equal": sum(r["request_matches_embedded"] for r in rows),
        "requests_with_persona": sum(bool(r["headers"]) for r in rows),
        "requests_with_rev10": sum(any(h["revision"] == 10 for h in r["headers"]) for r in rows),
        "requests_with_current_conversation_only_statement": sum(bool(r["current_conversation_only_statement_count"]) for r in rows),
        "persona_signatures": [
            {"persona": k[0], "revision": k[1], "header_md5_prefix": k[2],
             "paragraph_sha256": k[3], "occurrences": count}
            for k, count in sorted(signatures.items())
        ],
        "at_or_after_reported_rollout": [{"target": r["target"], "probe_event_utc": r["probe_event_utc"], "in_predictions": r["in_predictions"]} for r in late],
        "limitations": [
            "Probe event timestamps follow observations/model responses; they are not block injection timestamps.",
            "The rollout boundary is approximate owner testimony, not independently measured.",
            "Equality covers the contiguous persona paragraph through its first blank line, not all changing memory/instructions.",
            "Committed requests are evidence of exported captures, not a network trace or independently authenticated live runtime.",
            "T/C model requests and background service state are not covered by these brain captures.",
            "The 12 nonemitted raw requests do not become scored observations.",
        ],
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = audit()
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded)
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
