#!/usr/bin/env python3
"""Verify committed synthetic M3 observations offline. Never runs the adapter.

Requires the pinned GanpanAI Git objects already fetched into this repository.
Reads only measurement JSON/JSONL and named source files; no logs or services.
Prints a JSON audit to stdout. Scores and sealed evaluation files are untouched.
"""
import collections
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
REF = "9ad23dde4a4164f6da0a83f4854d58b42036905b"
BASE = "elda-orchestrator/measurements/eldacore/m3v02_20261117/"
ADAPTER = "elda-orchestrator/src/tools/m3v02Run.ts"


def blob(ref, path):
    return subprocess.check_output(["git", "show", f"{ref}:{path}"], cwd=ROOT)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(name):
    return json.loads(blob(REF, BASE + name))


def main():
    meta = read_json("run_meta.json")
    mapping = read_json("mapping.json")
    predictions = [json.loads(line) for line in blob(REF, BASE + "predictions.jsonl").splitlines() if line]
    blind_raw = blob(REF, BASE + "blind_predictions.jsonl")
    blind = [json.loads(line) for line in blind_raw.splitlines() if line]
    eval_dir = ROOT / "runtime/long-memory-research/eval-v1"
    manifest = json.loads((eval_dir / "manifest.json").read_bytes())
    for name in ("bundle.py", "private/blind_map.json"):
        if sha((eval_dir / name).read_bytes()) != manifest["sha256"][name]:
            raise ValueError("sealed file differs: " + name)
    mapping_raw = (eval_dir / "private/blind_map.json").read_bytes()
    blind_map = json.loads(mapping_raw)
    spec = importlib.util.spec_from_file_location("m3_provenance_bundle", eval_dir / "bundle.py")
    bundle_tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bundle_tool)
    unblind_equal = bundle_tool.unblind_observations(blind, blind_map, sha(blind_raw), sha(mapping_raw)) == predictions
    events = [json.loads(line) for line in blob(REF, BASE + "run_events.jsonl").splitlines() if line]
    paths = set(subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", REF, BASE + "raw"], cwd=ROOT
    ).decode().splitlines())
    checks = collections.Counter()
    failures = []
    used = set()
    for row in predictions:
        target = row["id"]
        ev = row["evidence"]
        ctx = row["artifacts"]["context"]
        contents = {}
        for kind, ref_key, hash_key, source in (
            ("evidence", "source_ref", "source_sha256", ev),
            ("capture", "capture_ref", "capture_sha256", ctx),
        ):
            # Resolve the sender's absolute path ONLY to the committed raw file.
            # Never open an absolute path supplied by a measurement artifact.
            filename = source[ref_key].rsplit("/", 1)[-1]
            path = BASE + "raw/" + filename
            if path not in paths:
                failures.append({"id": target, "check": f"{kind}_committed_path"})
                continue
            data = blob(REF, path)
            contents[kind] = json.loads(data)
            used.add(path)
            checks[f"{kind}_files"] += 1
            if sha(data) == source[hash_key]:
                checks[f"{kind}_hash_matches"] += 1
            else:
                failures.append({"id": target, "check": f"{kind}_hash"})
        raw = contents.get("evidence", {})
        capture = contents.get("capture")
        for name, ok in (
            ("capture_embedded_in_raw", capture is not None and raw.get("request") == capture),
            ("answer_matches_raw", raw.get("answer") == row["answer"]),
            ("run_matches_meta", raw.get("run_id") == row["run_id"] == meta["run_id"]),
            ("capture_marked_complete", ctx.get("capture_complete") is True),
            ("raw_probe_matches_blind_id", raw.get("probe") == blind_map["targets"].get(target)),
        ):
            if ok:
                checks[name] += 1
            else:
                failures.append({"id": target, "check": name})

    runtime = meta["runtime_ref"].split("@", 1)[1]
    bundle = meta["bundle_ref"].split("@", 1)[1]
    adapter_checks = {}
    for name, ref in (("runtime", runtime), ("report_commit", REF)):
        actual = sha(blob(ref, ADAPTER))
        adapter_checks[name] = {"sha256": actual, "matches_run_meta": actual == meta["adapter_sha256"]}
    prompts = {}
    for prompt, expected in meta["prompts"].items():
        actual = sha(blob(runtime, "elda-orchestrator/src/prompts/" + prompt + ".md"))
        prompts[prompt] = {"sha256": actual, "prefix_matches_run_meta": actual.startswith(expected)}
    scopes = collections.defaultdict(list)
    for synthetic, real in mapping["scope"].items():
        scopes[real].append(synthetic)
    result = {
        "source_commit": REF,
        "source_directory": BASE,
        "run_id": meta["run_id"],
        "predictions": len(predictions),
        "unblind_exact_json_equality": unblind_equal,
        "checks": dict(checks),
        "failures": failures,
        "unreferenced_raw_files": sorted(paths - used),
        "adapter": adapter_checks,
        "prompts": prompts,
        "bundle_head_string_sha_matches": sha(bundle.encode()) == meta["bundle_head_sha"],
        "mapping": {
            "synthetic_scopes": len(mapping["scope"]),
            "distinct_real_scopes": len(scopes),
            "collision_group_sizes": sorted(len(xs) for xs in scopes.values() if len(xs) > 1),
        },
        "run_event_counts": dict(collections.Counter(e["ev"] for e in events)),
        "limits": [
            "File integrity and projection consistency do not authenticate runtime execution.",
            "Capture files contain adapter model messages, not an Elda CLI process capture.",
            "dist_sha256 is reported, not independently rebuilt or matched to deployed binaries.",
            "bundle_head_sha hashes the commit string, not the sealed bundle file manifest.",
            "No model API, database, gateway, production log, or runtime adapter was executed/read.",
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return int(not unblind_equal or bool(failures) or any(not x["matches_run_meta"] for x in adapter_checks.values())
               or any(not x["prefix_matches_run_meta"] for x in prompts.values()))


if __name__ == "__main__":
    raise SystemExit(main())
