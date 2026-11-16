#!/usr/bin/env python3
"""Validate, seal, or export one chronological M3 session. No network access."""
import argparse
import hashlib
import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREREG = "66c7b4ed7924df7e866a8ad3bfc7dfcffa043925"
PLAN_HASH = "4bd537d16a51abd43ed66b7456699b84f1c3046af08add353a14a25cd1d1380d"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def parse(text):
    def bad_constant(value):
        raise ValueError(f"nonfinite JSON number: {value}")
    def finite(value):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("nonfinite JSON number")
        if isinstance(value, dict):
            for child in value.values():
                finite(child)
        elif isinstance(value, list):
            for child in value:
                finite(child)
    result = json.loads(text, object_pairs_hook=unique_object, parse_constant=bad_constant)
    finite(result)
    return result


def rows(path):
    return [parse(line) for line in path.read_text(encoding="utf-8").split("\n") if line.strip()]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(root=ROOT, check_manifest=True):
    require(digest(root / "plan.json") == PLAN_HASH, "preregistered plan changed")
    plan = parse((root / "plan.json").read_text(encoding="utf-8"))
    stories = rows(root / "scenarios.jsonl")
    gold = rows(root / "gold.jsonl")
    blind = rows(root / "blind/scenarios.jsonl")
    labels = rows(root / "blind/annotation_template.jsonl")
    mapping = parse((root / "private/blind_map.json").read_text(encoding="utf-8"))
    require(len(stories) == plan["counts"]["stories"], "story count")
    require(len(gold) == plan["counts"]["targets"], "target count")
    require(Counter(s["family"] for s in stories) == Counter({f: 2 for f in plan["families"]}), "family coverage")
    require(Counter((s["family"], s["domain"]) for s in stories) == Counter((f, d) for f in plan["families"] for d in plan["domains"]), "domain pairing")
    ids, probe_ids, event_ids = set(), set(), set()
    probes = {}
    forbidden = {"answer_rubric", "checks", "expected", "gold"}

    def no_gold(value, parent=None):
        if isinstance(value, dict):
            require(not forbidden.intersection(value), "gold field leaked into runtime input")
            if "verdict" in value:
                require(parent == "s6" and value.get("source") == "synthetic_fixture"
                        and value["verdict"] in {"pass", "fix", "block", "unknown"},
                        "gold verdict leaked into runtime input")
            for key, child in value.items():
                no_gold(child, key)
        elif isinstance(value, list):
            for child in value:
                no_gold(child)

    for story in stories:
        no_gold(story)
        require(story["id"] not in ids, "duplicate story ID")
        ids.add(story["id"])
        require(set(story["scope"]) == {"product", "principal_id", "persona_id"}, "scope triple")
        require(len(story["sessions"]) == 3, "three sessions required")
        times = []
        previous_events, previous_sessions, jobs = set(), set(), set()
        for session in story["sessions"]:
            require(session["id"] not in previous_sessions, "duplicate session ID")
            previous_sessions.add(session["id"])
            stamp = datetime.fromisoformat(session["at"].replace("Z", "+00:00"))
            require(stamp.tzinfo is not None, "session time must have timezone")
            times.append(stamp)
            require(bool(session["events"]), "empty session")
            for event in session["events"]:
                require(event["id"] not in event_ids, "duplicate event ID")
                event_ids.add(event["id"])
                require(event["kind"] in {"turn", "control"}, "unknown event kind")
                if event["kind"] == "turn":
                    require(event["speaker"] in {"human", "assistant", "notification"}, "speaker enum")
                    require(isinstance(event["text"], str) and event["text"].strip(), "turn text")
                    require("origin" in event, "turn origin required")
                else:
                    require(isinstance(event["action"], str) and event["action"], "control action")
                    require(isinstance(event["params"], dict), "control params")
                    action, params = event["action"], event["params"]
                    require(action in {"settle_turn", "end_session", "idle_consolidation", "queue_job", "complete_job", "replay_job", "advance_time", "attempt_resume"}, "unsupported control")
                    if action == "settle_turn":
                        require(params["through_event_id"] in previous_events, "unknown/future turn reference")
                    if action in {"end_session", "idle_consolidation", "attempt_resume"}:
                        key = "closed_session_id" if action == "attempt_resume" else "session_id"
                        require(params[key] in previous_sessions, "unknown/future session reference")
                    if action == "queue_job":
                        require(params["job_id"] not in jobs, "duplicate queued job")
                        require(params["source_event_ids"] and all(e in previous_events for e in params["source_event_ids"]), "unknown/future job source")
                        jobs.add(params["job_id"])
                    if action in {"complete_job", "replay_job"}:
                        require(params["job_id"] in jobs, "unknown/future job reference")
                    if action == "advance_time":
                        require(datetime.fromisoformat(params["to"].replace("Z", "+00:00")) >= stamp, "clock moved backward")
                previous_events.add(event["id"])
            probe = session["probe"]
            require(probe["id"] not in probe_ids, "duplicate probe ID")
            require(isinstance(probe["query"], str) and probe["query"].strip(), "probe query")
            require(set(probe["scope"]) == {"product", "principal_id", "persona_id"}, "probe scope triple")
            probe_ids.add(probe["id"])
            probes[probe["id"]] = story
        require(times == sorted(times) and len(set(times)) == 3, "session chronology")
    require(len({g["id"] for g in gold}) == len(gold), "duplicate gold ID")
    require({g["id"] for g in gold} == probe_ids, "gold/probe bijection")
    for target in gold:
        story = probes[target["id"]]
        require(target["scenario_id"] == story["id"], "gold story mismatch")
        require(target["family"] == story["family"] and target["domain"] == story["domain"], "gold group mismatch")
        require(type(target["positive"]) is bool, "positive must be bool")
        require(bool(target["answer_rubric"].strip()), "missing semantic rubric")
        require(len(target["checks"]) >= 2, "too few structural checks")
        require(len({c["id"] for c in target["checks"]}) == len(target["checks"]), "duplicate check ID")
        for check in target["checks"]:
            require(check["operator"] in {"eq", "contains", "excludes", "set_eq", "lte"}, "check operator")
            require(check["path"].startswith("/artifacts/"), "check path boundary")
            require(type(check["gate"]) is bool and bool(check["metric"]), "check metric/gate")
    require(set(mapping["scenarios"]) == ids, "blind story mapping")
    require(set(mapping["targets"]) == probe_ids, "blind target mapping")
    require(len(set(mapping["scenarios"].values())) == len(ids), "blind story collisions")
    require(len(set(mapping["targets"].values())) == len(probe_ids), "blind target collisions")
    require({s["id"] for s in blind} == set(mapping["scenarios"].values()), "blind story coverage")
    require(len(blind) == len(stories), "blind story duplicates")
    blind_targets = [session["probe"]["id"] for story in blind for session in story["sessions"]]
    require(set(blind_targets) == set(mapping["targets"].values()) and len(blind_targets) == len(gold), "blind probe coverage")
    for story in blind:
        no_gold(story)
        require("family" not in story and "domain" not in story, "blind condition label leak")
    lookup = {key: value for table in mapping.values() for key, value in table.items()}
    def remap(value):
        if isinstance(value, str):
            return lookup.get(value, value)
        if isinstance(value, list):
            return [remap(child) for child in value]
        if isinstance(value, dict):
            return {key: remap(child) for key, child in value.items()}
        return value
    expected_blind = [remap({key: value for key, value in story.items() if key not in {"family", "domain"}}) for story in stories]
    require(blind == expected_blind, "blind history/map mismatch")
    require(len(labels) == len(gold) and {r["id"] for r in labels} == set(blind_targets), "annotation coverage")
    for row in labels:
        require(all(value is None or value == "" for key, value in row.items() if key != "id"), "prefilled annotation")
    from scorer import index_gold
    index_gold(gold)
    if check_manifest:
        manifest = parse((root / "manifest.json").read_text(encoding="utf-8"))
        require(manifest["preregistration_commit"] == PREREG, "preregistration commit")
        for relative, expected in manifest["sha256"].items():
            path = (root / relative).resolve()
            require(path.is_relative_to(root.resolve()), "manifest path escapes bundle")
            require(path.is_file() and digest(path) == expected, f"hash mismatch: {relative}")
        required = {"scenarios.jsonl", "gold.jsonl", "plan.json", "CONTRACT.md", "scorer.py", "build_dataset.py", "bundle.py", "blind/scenarios.jsonl", "blind/annotation_template.jsonl", "private/blind_map.json"}
        require(required.issubset(manifest["sha256"]), "manifest missing required file")
    return {"stories": len(stories), "sessions": sum(len(s["sessions"]) for s in stories), "targets": len(gold), "positive_targets": sum(g["positive"] for g in gold), "families": len(plan["families"]), "model_calls": 0}


def export_stage(root, scenario, session_index):
    validate(root)
    require(1 <= session_index <= 3, "session index must be 1..3")
    selected = [row for row in rows(root / "scenarios.jsonl") if row["id"] == scenario]
    require(len(selected) == 1, "unknown/duplicate scenario")
    story = selected[0]
    session = story["sessions"][session_index - 1]
    return {"scenario_id": story["id"], "scope": session["probe"]["scope"], "session": session}


def write_new(path, payload):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def unblind_observations(predictions, mapping, input_sha256, mapping_sha256):
    """Restore only transport IDs; never change response text or judge evidence."""
    reverse_targets = {blind: original for original, blind in mapping["targets"].items()}
    reverse_events = {blind: original for original, blind in mapping["events"].items()}
    normalized = []
    seen = set()
    for row in predictions:
        identifier = row.get("id")
        require(identifier in reverse_targets and identifier not in seen, "unknown/duplicate blind target")
        seen.add(identifier)
        restored = {**row, "id": reverse_targets[identifier]}
        artifacts = dict(row.get("artifacts", {}))
        if "episode_sources" in artifacts:
            sources = artifacts["episode_sources"]
            require(isinstance(sources, dict), "episode_sources must be object")
            require(all(event in reverse_events for event in sources), "unknown blind source event")
            artifacts["episode_sources"] = {reverse_events[event]: verdict for event, verdict in sources.items()}
        restored["artifacts"] = artifacts
        require("normalization" not in row, "already normalized observation")
        restored["normalization"] = {"source_blind_id": identifier, "input_sha256": input_sha256,
                                     "mapping_sha256": mapping_sha256}
        normalized.append(restored)
    return normalized


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("verify")
    export = sub.add_parser("export-stage")
    export.add_argument("--scenario", required=True)
    export.add_argument("--session", type=int, required=True)
    export.add_argument("--output", type=Path)
    unblind = sub.add_parser("unblind-observations")
    unblind.add_argument("--input", type=Path, required=True)
    unblind.add_argument("--output", type=Path, required=True)
    sub.add_parser("seal")
    args = parser.parse_args()
    try:
        if args.command == "verify":
            result = validate(args.root)
        elif args.command == "export-stage":
            result = export_stage(args.root, args.scenario, args.session)
            if args.output:
                write_new(args.output, result)
                return 0
        elif args.command == "unblind-observations":
            validate(args.root)
            from scorer import read_jsonl, index_gold, index_predictions
            predictions, input_hash = read_jsonl(args.input)
            path = args.root / "private/blind_map.json"
            mapping = parse(path.read_text(encoding="utf-8"))
            restored = unblind_observations(predictions, mapping, input_hash, digest(path))
            index_predictions(restored, index_gold(rows(args.root / "gold.jsonl")))
            with args.output.open("x", encoding="utf-8") as output:
                for row in restored:
                    output.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            result = {"normalized_rows": len(restored), "input_sha256": input_hash,
                      "output_sha256": digest(args.output)}
        else:
            result = validate(args.root, check_manifest=False)
            paths = sorted(path for path in args.root.rglob("*") if path.is_file() and path.name != "manifest.json" and "__pycache__" not in path.parts and path.suffix in {".py", ".md", ".json", ".jsonl"})
            manifest = {"version": "0.1", "preregistration_commit": PREREG, "counts": result, "sha256": {str(path.relative_to(args.root)): digest(path) for path in paths}}
            write_new(args.root / "manifest.json", manifest)
            result = {"sealed": len(paths), **result}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"bundle error: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
