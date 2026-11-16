#!/usr/bin/env python3
"""Validate, seal, export, or normalize the offline M3 v0.2 supplement."""
import argparse
import copy
import hashlib
import json
import math
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREREG = "c839d3036992a98dec5a951d73a5820035c088a2"
PLAN_HASH = "a5ac584f14e401301ac6642f53dd3e6c3dd79b64d8e0d478b911b23e607de0a0"
CONTRACT_HASH = "9948f6a0225aad00b075d47896d26e073bbdca46637442805f408c3de9536112"
TABLES = {"stories", "targets", "checkpoints", "events", "jobs", "conversations"}
REQUIRED = {"plan.json", "CONTRACT.md", "README.md", "scenarios.jsonl", "gold.jsonl",
            "blind/scenarios.jsonl", "blind/annotation_template.jsonl", "private/blind_map.json",
            "build_dataset.py", "bundle.py", "scorer.py", "_base_scorer.py",
            "test_scenarios.py", "test_bundle.py", "test_scorer.py", "registration.json"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def unique_object(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out, f"duplicate JSON key: {key}")
        out[key] = value
    return out


def parse(text):
    def reject(value):
        raise ValueError(f"nonfinite JSON: {value}")
    result = json.loads(text, object_pairs_hook=unique_object, parse_constant=reject)
    def finite(value):
        if isinstance(value, float):
            require(math.isfinite(value), "nonfinite JSON")
        elif isinstance(value, dict):
            for child in value.values(): finite(child)
        elif isinstance(value, list):
            for child in value: finite(child)
    finite(result)
    return result


def rows(path):
    return [parse(line) for line in Path(path).read_text(encoding="utf-8").split("\n") if line.strip()]


def remap(value, lookup):
    if isinstance(value, str): return lookup.get(value, value)
    if isinstance(value, list): return [remap(child, lookup) for child in value]
    if isinstance(value, dict): return {key: remap(child, lookup) for key, child in value.items()}
    return value


def no_gold(value, parent=None):
    if isinstance(value, dict):
        require(not {"answer_rubric", "checks", "expected", "gold", "judgment"}.intersection(value), "gold leaked into input")
        if "verdict" in value:
            require(parent == "s6" and value.get("source") == "synthetic_fixture"
                    and value["verdict"] in {"pass", "fix", "block", "unknown"}, "unmarked verdict in input")
        for key, child in value.items(): no_gold(child, key)
    elif isinstance(value, list):
        for child in value: no_gold(child)


def scope(value):
    require(type(value) is dict and set(value) == {"product", "principal_id", "persona_id"}, "scope triple")
    require(all(type(v) is str for v in value.values()), "scope values")


def validate(root=ROOT, check_manifest=True):
    root = Path(root)
    require(digest(root / "plan.json") == PLAN_HASH, "preregistered plan changed")
    require(digest(root / "CONTRACT.md") == CONTRACT_HASH, "preregistered contract changed")
    plan = parse((root / "plan.json").read_text(encoding="utf-8"))
    stories, gold = rows(root / "scenarios.jsonl"), rows(root / "gold.jsonl")
    blind, labels = rows(root / "blind/scenarios.jsonl"), rows(root / "blind/annotation_template.jsonl")
    mapping = parse((root / "private/blind_map.json").read_text(encoding="utf-8"))
    require(set(mapping) == TABLES and all(type(v) is dict for v in mapping.values()), "mapping tables")
    require(len(stories) == plan["counts"]["stories"], "story count")
    require(len(gold) == plan["counts"]["targets"], "target count")
    require(Counter((s["family"], s["domain"]) for s in stories)
            == Counter((f, d) for f in plan["families"] for d in plan["domains"]), "family/domain pairing")
    seen = {table: set() for table in TABLES}
    probes = {}
    for story in stories:
        no_gold(story)
        require(story["id"] not in seen["stories"], "duplicate story")
        seen["stories"].add(story["id"])
        scope(story["scope"])
        require(len(story["checkpoints"]) == plan["counts"]["checkpoints_per_story"], "checkpoint count")
        previous_events, turn_events, jobs, conversations, times = set(), set(), set(), set(), []
        fixture_clock = None
        for checkpoint in story["checkpoints"]:
            require(checkpoint["id"] not in seen["checkpoints"], "duplicate checkpoint")
            seen["checkpoints"].add(checkpoint["id"])
            cid = checkpoint["conversation_id"]
            require(type(cid) is str and bool(cid), "conversation ID")
            if cid not in conversations:
                require(cid not in seen["conversations"], "conversation crosses stories")
            conversations.add(cid); seen["conversations"].add(cid)
            stamp = datetime.fromisoformat(checkpoint["at"].replace("Z", "+00:00"))
            require(stamp.tzinfo is not None, "timezone required")
            require(fixture_clock is None or stamp >= fixture_clock, "checkpoint before fixture clock")
            fixture_clock = stamp
            times.append(stamp)
            require(type(checkpoint["events"]) is list and bool(checkpoint["events"]), "empty checkpoint")
            for event in checkpoint["events"]:
                require(event["id"] not in seen["events"], "duplicate event")
                seen["events"].add(event["id"])
                require(event["kind"] in {"turn", "control"}, "event kind")
                if "scope" in event: scope(event["scope"])
                if "conversation_id" in event:
                    event_cid = event["conversation_id"]
                    require(type(event_cid) is str and bool(event_cid), "event conversation ID")
                    if event_cid not in conversations:
                        require(event_cid not in seen["conversations"], "event conversation crosses stories")
                    conversations.add(event_cid); seen["conversations"].add(event_cid)
                if event["kind"] == "turn":
                    require(event["speaker"] in {"human", "assistant", "notification"}, "speaker")
                    require(type(event["text"]) is str and bool(event["text"].strip()), "empty turn")
                    require(type(event["origin"]) is dict and type(event["origin"].get("kind")) is str, "origin")
                    turn_events.add(event["id"])
                else:
                    action, params = event["action"], event["params"]
                    require(action in plan["controls"] and type(params) is dict, "unknown control")
                    if action in {"settle_turn", "attach_s6"}:
                        require("source_event_id" in params or (action == "settle_turn" and "through_event_id" in params), "control source required")
                    if action in {"finish_c", "queue_c", "forget", "pause", "resume", "restart_worker", "trim_context", "retry_turn"}:
                        require("conversation_id" in params, "control conversation required")
                    if action == "attempt_resume": require("closed_conversation_id" in params, "resume conversation required")
                    if action == "attach_s6":
                        require(type(params.get("s6")) is dict and params["s6"].get("source") == "synthetic_fixture", "synthetic S6 source required")
                    for key in ("source_event_id", "through_event_id"):
                        if key in params: require(params[key] in turn_events, "future/missing source turn")
                    if "source_event_ids" in params:
                        require(type(params["source_event_ids"]) is list and bool(params["source_event_ids"])
                                and all(e in turn_events for e in params["source_event_ids"]), "future/missing source turns")
                    if action == "queue_c":
                        require(params.get("job_id") and params["job_id"] not in seen["jobs"], "duplicate/missing job")
                        require(params.get("source_event_ids"), "job sources required")
                        jobs.add(params["job_id"]); seen["jobs"].add(params["job_id"])
                    if action == "release_c": require(params.get("job_id") in jobs, "future/missing job")
                    for key in ("conversation_id", "closed_conversation_id"):
                        if key in params: require(params[key] in conversations, "future/missing conversation")
                    if action == "advance_time":
                        target = datetime.fromisoformat(params["to"].replace("Z", "+00:00"))
                        require(target.tzinfo is not None and target >= fixture_clock, "backward fixture clock")
                        fixture_clock = target
                previous_events.add(event["id"])
            probe = checkpoint["probe"]
            require(probe["id"] not in seen["targets"], "duplicate target")
            require(type(probe["query"]) is str and bool(probe["query"].strip()), "probe query")
            scope(probe["scope"])
            seen["targets"].add(probe["id"]); probes[probe["id"]] = story
        require(times == sorted(times) and len(set(times)) == len(times), "checkpoint chronology")
    require(len({g["id"] for g in gold}) == len(gold) and {g["id"] for g in gold} == seen["targets"], "gold/probe bijection")
    for target in gold:
        story = probes[target["id"]]
        require(target["scenario_id"] == story["id"] and target["family"] == story["family"]
                and target["domain"] == story["domain"], "gold identity")
    from scorer import index_gold
    index_gold(gold)
    all_original, all_blind = set(), set()
    for table in sorted(TABLES):
        require(set(mapping[table]) == seen[table], f"mapping coverage {table}")
        for original, masked in mapping[table].items():
            require(type(original) is str and type(masked) is str and masked and original != masked, "mapping type")
            require(original not in all_original and masked not in all_blind, "mapping collision")
            all_original.add(original); all_blind.add(masked)
    require(not all_original.intersection(all_blind), "mapping original/blind collision")
    lookup = {k: v for table in mapping.values() for k, v in table.items()}
    expected = [remap({k: v for k, v in s.items() if k not in {"family", "domain"}}, lookup) for s in stories]
    require(blind == expected, "blind data/map mismatch")
    for story in blind: no_gold(story)
    require(len(labels) == len(gold) and {r["id"] for r in labels} == set(mapping["targets"].values()), "annotation coverage")
    for row in labels:
        require(all(v is None or v == "" for k, v in row.items() if k != "id"), "prefilled annotation")
    registration_path = root / "registration.json"
    if registration_path.is_file():
        registration = parse(registration_path.read_text(encoding="utf-8"))
        require(registration.get("name") == plan["name"] and registration.get("ver") == "0.2", "registration identity")
        require(registration.get("n_items") == len(gold)
                and registration.get("n_pos") == sum(g["positive"] for g in gold), "registration denominator")
        require(registration.get("use") == "eval" and registration.get("authored_by") == "other_llm"
                and registration.get("has_customer_text") is False, "registration provenance/use")
        require(registration.get("content_md5") == hashlib.md5((root / "gold.jsonl").read_bytes()).hexdigest(), "registration gold hash")
        require(registration.get("ref_repo") == "ginojang/clova-api-lab"
                and registration.get("ref_path") == "runtime/long-memory-research/eval-v1/gold.jsonl"
                and re.fullmatch(r"[0-9a-f]{40}", registration.get("ref_commit", "")), "registration committed reference")
        require(all(marker in registration.get("note", "") for marker in
                    ("registration_status=draft", "not_inserted", "evaluation_phase=pretest", "training_forbidden=true")), "registration draft boundary")
    if check_manifest:
        manifest = parse((root / "manifest.json").read_text(encoding="utf-8"))
        require(manifest.get("version") == "0.2" and manifest.get("preregistration_commit") == PREREG, "manifest preregistration")
        require(REQUIRED.issubset(manifest["sha256"]), "manifest missing required file")
        for relative, expected_hash in manifest["sha256"].items():
            path = (root / relative).resolve()
            require(path.is_relative_to(root.resolve()), "manifest path escape")
            require(path.is_file() and digest(path) == expected_hash, f"hash mismatch: {relative}")
    return {"stories": len(stories), "checkpoints": len(gold), "positive_targets": sum(g["positive"] for g in gold),
            "checks": sum(len(g["checks"]) for g in gold), "families": len(plan["families"]), "model_calls": 0}


def export_checkpoint(root, story_id, checkpoint_index):
    validate(root)
    require(type(checkpoint_index) is int and 1 <= checkpoint_index <= 3, "checkpoint index 1..3")
    mapping = parse((root / "private/blind_map.json").read_text(encoding="utf-8"))
    masked = mapping["stories"].get(story_id, story_id)
    selected = [s for s in rows(root / "blind/scenarios.jsonl") if s["id"] == masked]
    require(len(selected) == 1, "unknown story")
    checkpoint = selected[0]["checkpoints"][checkpoint_index - 1]
    return {"story_id": masked, "scope": checkpoint["probe"]["scope"], "checkpoint": checkpoint}


def unblind_observations(predictions, mapping, input_sha256, mapping_sha256):
    reverse = {table: {v: k for k, v in entries.items()} for table, entries in mapping.items()}
    declared = {"story_id": "stories", "checkpoint_id": "checkpoints", "conversation_id": "conversations",
                "source_event_id": "events", "source_event_ids": "events", "job_id": "jobs"}
    def transport(value):
        if isinstance(value, list): return [transport(v) for v in value]
        if not isinstance(value, dict): return value
        out = {}
        for key, child in value.items():
            if key in declared:
                table = reverse[declared[key]]
                if isinstance(child, list):
                    require(all(type(v) is str and v in table for v in child), "unknown blind transport list")
                    out[key] = [table[v] for v in child]
                else:
                    require(type(child) is str and child in table, "unknown blind transport ID")
                    out[key] = table[child]
            else: out[key] = transport(child)
        return out
    out, seen = [], set()
    for row in predictions:
        identifier = row.get("id")
        require(identifier in reverse["targets"] and identifier not in seen, "unknown/duplicate blind target")
        require("normalization" not in row, "already normalized")
        seen.add(identifier)
        restored = copy.deepcopy(row)
        restored["id"] = reverse["targets"][identifier]
        # Only the declared transport envelope is remapped. Never touch answer,
        # judgment, capture text, hashes, raw refs, or runtime-owned database IDs.
        if "transport" in restored: restored["transport"] = transport(restored["transport"])
        sources = restored.get("artifacts", {}).get("episode_sources")
        if sources is not None:
            require(type(sources) is dict and all(k in reverse["events"] for k in sources), "unknown blind episode source")
            restored["artifacts"]["episode_sources"] = {reverse["events"][k]: v for k, v in sources.items()}
        restored["normalization"] = {"source_blind_id": identifier, "input_sha256": input_sha256, "mapping_sha256": mapping_sha256}
        out.append(restored)
    return out


def write_new(path, payload):
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("verify")
    export = sub.add_parser("export-checkpoint")
    export.add_argument("--story", required=True); export.add_argument("--checkpoint", type=int, required=True)
    export.add_argument("--output", type=Path)
    normalize = sub.add_parser("unblind-observations")
    normalize.add_argument("--input", type=Path, required=True); normalize.add_argument("--output", type=Path, required=True)
    sub.add_parser("seal")
    args = parser.parse_args()
    try:
        if args.command == "verify": result = validate(args.root)
        elif args.command == "export-checkpoint":
            result = export_checkpoint(args.root, args.story, args.checkpoint)
            if args.output: write_new(args.output, result); return 0
        elif args.command == "unblind-observations":
            validate(args.root)
            from scorer import read_jsonl, index_gold, index_predictions
            predictions, input_hash = read_jsonl(args.input)
            mapping_path = args.root / "private/blind_map.json"
            mapping = parse(mapping_path.read_text(encoding="utf-8"))
            restored = unblind_observations(predictions, mapping, input_hash, digest(mapping_path))
            index_predictions(restored, index_gold(rows(args.root / "gold.jsonl")))
            with args.output.open("x", encoding="utf-8") as stream:
                for row in restored: stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
            result = {"normalized_rows": len(restored), "output_sha256": digest(args.output)}
        else:
            result = validate(args.root, check_manifest=False)
            require(all((args.root / path).is_file() for path in REQUIRED), "missing required files before seal")
            paths = sorted(REQUIRED)
            write_new(args.root / "manifest.json", {"version": "0.2", "preregistration_commit": PREREG,
                      "counts": result, "sha256": {path: digest(args.root / path) for path in paths}})
            result = {"sealed": len(paths), **result}
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.exit(2, f"bundle error: {error}\n")


if __name__ == "__main__": raise SystemExit(main())
