#!/usr/bin/env python3
"""Static source/artifact audit only; never imports or runs the TypeScript adapter."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
NEW = "847c482038c80fef77b44c20d897de9adf42e711"
C_RAW = "dfd7c92fdfe4cba28c6c4a95353ffd642f7db2c5"
RUNTIME = "a315c32c008694e52b0fcfc11651ae986340a7ad"
OLD_ADAPTER = "41df84e975c390b6255f7100479164f55bc0f1d8"
RESULT = "ec3c9b262a14ffe07958b09f77d8b6e2b3de2481"
BUNDLE = "7b9b9443d8b885742f66aa40d4308018ec46303a"
ADAPTER = "elda-orchestrator/src/tools/m3v02Run.ts"
TURN = "elda-orchestrator/src/core/eldacore/s6memory.ts"
CHAT = "elda-orchestrator/src/core/eldacore/s6chatEnd.ts"
BASE = "elda-orchestrator/measurements/eldacore/m3v02_20261117_r3/"
hashes = {}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def read(ref, path):
    if path.endswith((".gz", ".log")):
        raise ValueError("server logs forbidden")
    data = git("show", f"{ref}:{path}")
    hashes[f"{ref}:{path}"] = hashlib.sha256(data).hexdigest()
    return data.decode()


def between(text, left, right):
    return text.split(left, 1)[1].split(right, 1)[0]


def locations(text, needle):
    return [i for i, line in enumerate(text.splitlines(), 1) if needle in line]


adapter = read(NEW, ADAPTER)
turn = read(NEW, TURN)
chat = read(NEW, CHAT)
old_adapter = read(RUNTIME, ADAPTER)
old_adapter_commit = read(OLD_ADAPTER, ADAPTER)
old_chat = read(RUNTIME, CHAT)
raw_chat = read(C_RAW, CHAT)
wait = between(adapter, "async function waitT(", "const tFailed =")
settle = between(adapter, "case 'settle_turn':", "case 'finish_c':")
retry = between(adapter, "case 'retry_turn':", "case 'trim_context':")
final = between(adapter, "    } finally {\n        writeFileSync(join(OUT, 'mapping.json')", "    log({ ev: 'done'")
ops_line = next(line.strip() for line in turn.splitlines() if "ops_detail: res.ops.map" in line)
ops_fields = re.findall(r"\b([a-z_]+):", between(ops_line, "return {", " };"))
events = [json.loads(line) for line in read(RESULT, BASE + "run_events.jsonl").splitlines()]
receipts = [json.loads(line) for line in read(RESULT, BASE + "t_receipts.jsonl").splitlines()]
old_c_summaries = [event["sum"] for event in events if event["ev"] in ("finish_c", "release_c") and "sum" in event]
scenarios = [json.loads(line) for line in read(BUNDLE, "runtime/long-memory-research/eval-v1/scenarios.jsonl").splitlines()]
retries = []
for story in scenarios:
    for k, cp in enumerate(story["checkpoints"], 1):
        for i, event in enumerate(cp["events"]):
            if event.get("action") == "retry_turn":
                following = cp["events"][i + 1:]
                retries.append({"story": story["id"], "checkpoint": k, "id": event["id"],
                                "explicit_settle_after_retry": any(e.get("action") == "settle_turn" for e in following),
                                "probe": cp["probe"]["id"]})

checks = {
    "baseline_adapter_same_at_runtime_and_change_commit": old_adapter == old_adapter_commit,
    "new_wait_checks_false_only_when_key_present": "if (ti != null) { const line" in wait and "JSON.parse(line).ok === false" in wait,
    "new_wait_returns_true_after_marking_false": "tFailed.add(evId)" in wait and wait.rstrip().endswith("return true;\n}"),
    "settle_records_both_timeout_and_failed_taint": "settle_timeout:" in settle and "settle_t_failed:" in settle,
    "story_taint_regex_accepts_t_failed": "settle_timeout|settle_t_failed|" in adapter,
    "retry_wait_result_still_ignored": "await waitT(e.id);" in retry and "tFailed" not in retry and "notes.push(`settle" not in retry,
    "final_wait_still_count_only": "tServeCount(c) < n" in final and "waitT(" not in final and "tFailed" not in final,
    "raw_assignment_precedes_call_failure_return": chat.index("sum.raw = c.raw;") < chat.index("if (!c.ok || !c.j)"),
    "chat_source_unchanged_since_c_raw_commit": chat == raw_chat,
    "prior_runtime_did_not_put_raw_in_summary": "sum.raw = c.raw" not in old_chat,
    "m3_r3_artifact_tree_unchanged": not git("diff", "--name-only", RESULT, NEW, "--", BASE).strip(),
    "four_sealed_retries_lack_following_settle": len(retries) == 4 and all(not row["explicit_settle_after_retry"] for row in retries),
}
assert all(checks.values()), checks
assert ops_fields == ["op", "slot", "downgraded", "downgraded_why", "ce_turn", "ev_turn"], ops_fields

report = {
    "audit_kind": "source-only; static extraction and artifact arithmetic, no TypeScript execution or new measurement",
    "source_ref": NEW, "c_raw_ref": C_RAW, "prior_runtime_ref": RUNTIME,
    "prior_adapter_ref": OLD_ADAPTER, "prior_result_ref": RESULT, "bundle_ref": BUNDLE,
    "checks": checks,
    "ops_detail_fields": ops_fields,
    "sealed_retry_paths": retries,
    "preserved_r3": {
        "selected_receipts": len(receipts),
        "receipts_with_reason": sum("reason" in r["t_receipt"] for r in receipts),
        "receipts_with_ops_detail": sum("ops_detail" in r["t_receipt"] for r in receipts),
        "c_summary_events": len(old_c_summaries),
        "c_summary_events_with_raw": sum("raw" in row for row in old_c_summaries),
        "meaning": "The old r3 artifacts were not backfilled; new source support is not evidence of a new M3 run.",
    },
    "line_refs": {
        "adapter": {key: locations(adapter, needle) for key, needle in {
            "wait_function": "async function waitT(", "wait_false": "JSON.parse(line).ok === false",
            "settle_branch": "case 'settle_turn':", "retry_branch": "case 'retry_turn':",
            "retry_ignored_wait": "await waitT(e.id);", "taint_accumulation": "for (const n of notes)",
            "probe_raw": "c_runs: cRuns.filter", "probe_skip": "if (taint.length) { log",
            "final_count_wait": "tServeCount(c) < n", "export_first_key": "const byKey =",
            "export_extra_fields": "reason: r.reason ?? null",
        }.items()},
        "turn": {key: locations(turn, needle) for key, needle in {
            "ops_detail": "ops_detail: res.ops.map", "logger": "logger.info('memory_turn.serve'",
            "outer_exception": "logger.warn('memory_turn.serve_failed'", "db_apply_exception": "logger.warn('ltm_apply.failed'",
        }.items()},
        "chat": {key: locations(chat, needle) for key, needle in {
            "request": "content: JSON.stringify({ turns: inp.turns", "response_raw": "const raw = resp.json",
            "summary_raw": "sum.raw = c.raw;", "source_for_model": "const s6ForModel:",
            "promise_db_exception": "logger.warn('memory_chat_end.promise_failed'", "episode_db_exception": "logger.warn('memory_chat_end.episode_failed'",
            "episode_any_resolved_query_true": ".then(() => { episode = true; })", "summary_final": "Object.assign(sum, { ran: true",
            "background_timer": "void runChatEnd(a)",
        }.items()},
    },
    "static_conclusions": [
        "Explicit settle_turn with a valid matching key now propagates ok=false to persistent story taint and suppresses subsequent predictions, while raw probes may still be executed/exported.",
        "Missing-key count fallback never inspects ok=false; retry ignores wait return/tFailed; finalization only waits by count. This is not comprehensive failure propagation.",
        "A missing/wrong key normally times out in explicit settle, but inferred wrong existing keys and first duplicate keys remain unverified; outer serve_failed is not a keyed normal receipt.",
        "ok is runMemoryTurn result, not each DB apply result; caught DB failures can coexist with ok=true and held counts.",
        "ops_detail is post-guard retained ops only and lacks exact evidence/CE text, offsets/n, target linkage and per-operation DB outcome; turn numbers identify candidate source turns, not exact model-quoted spans.",
        "C raw is model content text copied before the failure return; parse failures preserve it, transport failures/no-call paths may keep null. It is not the C request or full provider response.",
        "Explicit finish/release summaries flow to c_runs/events; unreleased/lost jobs and background C calls are not automatically covered by those exports.",
        "C raw permits inspection of model candidates but lacks exact gathered turns/model-visible s6/today/system request and item-level persistence receipts; episode=true can also mean ON CONFLICT DO NOTHING resolved.",
        "No production deployment/restart or new M3 execution has been independently verified. Existing r3 conclusions and scores remain unchanged.",
    ],
    "input_sha256": hashes,
}
(OUT / "execution_followup.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"checks": checks, "preserved_r3": report["preserved_r3"], "ops_detail_fields": ops_fields}, ensure_ascii=False))
