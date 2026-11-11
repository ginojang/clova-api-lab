#!/usr/bin/env python3
"""Exercise original digest code with fake MCP/CLI subprocess responses only.

Exit 1 means at least one behavior contract failed, even if fixture execution
completed. No operational inbox, child CLI, model, token file or network is used.
"""
from __future__ import annotations

import sys
sys.dont_write_bytecode = True

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import socket
import subprocess
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
REPO = DIRECTORY.parents[4]
IDS = {"bot-hostwatch": "a100000001", "bot-routine": "b200000001"}
SUMMARIES = {m: f"[합성 요약 {m}] 요청은 아직 미완료입니다." for m in IDS}
SCENARIOS = (
    "new_mcp_model_failure", "model_timeout", "empty_success",
    "first_success_second_failure", "old_mcp_ignores_keep_unread",
    "mark_read_error", "normal_success_two_members", "empty_inboxes", "second_member_mark_error",
    "nonzero_cli_with_ok_text", "second_member_mark_postapply_error",
)


def blocked(*args, **kwargs):
    raise AssertionError("This offline fixture forbids real processes and network")


@contextlib.contextmanager
def block_external():
    with (
        patch.object(subprocess, "Popen", side_effect=blocked),
        patch.object(socket, "socket", side_effect=blocked),
        patch.object(socket, "create_connection", side_effect=blocked),
        patch.object(os, "system", side_effect=blocked),
    ):
        yield


def tool_metadata(old):
    read_properties = {"id": {"type": "string"}}
    if not old:
        read_properties["keepUnread"] = {"type": "boolean"}
    result = [
        {"name": "comms_inbox", "inputSchema": {"type": "object", "properties": {}}},
        {"name": "comms_read", "inputSchema": {"type": "object", "properties": read_properties,
                                                 "required": ["id"]}},
        {"name": "comms_mark_read", "inputSchema": {"type": "object", "properties": {
            "ids": {"type": "array", "items": {"type": "string"}}}, "required": ["ids"]}},
    ]
    if not old:
        result.append({"name": "comms_peek", "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string"}}, "required": ["id"]}})
    return result


def observe(module, scenario):
    multi = scenario in {"first_success_second_failure", "normal_success_two_members", "empty_inboxes", "second_member_mark_error", "second_member_mark_postapply_error"}
    members = list(IDS) if multi else ["bot-routine"]
    old = scenario == "old_mcp_ignores_keep_unread"
    unread = {m: ([] if scenario == "empty_inboxes" else [IDS[m]]) for m in members}
    initial_unread = {m: list(ids) for m, ids in unread.items()}
    calls, model_successes, read_effects = [], [], []
    stdout, stderr = io.StringIO(), io.StringIO()

    def fake_run(argv, **kwargs):
        env = kwargs["env"]  # Only member identity is inspected; no environment is persisted.
        if argv[-2:] == ["ops", "--events"]:
            member = env["ELDA_MEMBER"]
            assert member in members
            prompt = json.loads(kwargs["input"])
            assert prompt["op"] == "prompt"
            calls.append({"operation": "model_prompt", "member": member})
            if scenario == "model_timeout":
                raise subprocess.TimeoutExpired(argv, kwargs["timeout"])
            fail = scenario in {"new_mcp_model_failure", "old_mcp_ignores_keep_unread"} or (
                scenario == "first_success_second_failure" and member == "bot-routine")
            text = "" if scenario == "empty_success" else SUMMARIES[member]
            rows = [] if fail or not text else [{"t": "text", "data": {"text": text}}]
            rows.append({"t": "turn_end", "data": {
                "ok": not fail, "endReason": "error" if fail else "completed",
                "usage": {"input": 12, "output": 0 if fail else 8, "cacheRead": 0, "cacheWrite": 0},
                "usageUnreported": ["cacheRead", "cacheWrite"], "diag": {"retries": 0},
            }})
            cli_returncode = 9 if scenario == "nonzero_cli_with_ok_text" else (1 if fail else 0)
            if not fail and text and cli_returncode == 0:
                model_successes.append(member)
            return subprocess.CompletedProcess(argv, cli_returncode,
                                               "\n".join(json.dumps(e, ensure_ascii=False) for e in rows) + "\n",
                                               "synthetic model error" if fail else "")

        assert argv == [module.NODE, module.COMMS_MCP], f"Unexpected subprocess: {argv!r}"
        member = env["ELDA_COMMS_MEMBER"]
        assert member in members
        requests = [json.loads(line) for line in kwargs["input"].splitlines() if line.strip()]
        responses = []
        for request in requests:
            method = request.get("method")
            if "id" not in request:
                continue
            response = {"jsonrpc": "2.0", "id": request["id"]}
            if method == "initialize":
                response["result"] = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                                      "serverInfo": {"name": "synthetic-comms", "version": "old" if old else "new"}}
            elif method == "tools/list":
                calls.append({"operation": "tools/list", "member": member,
                              "keepUnreadBooleanSupported": not old})
                response["result"] = {"tools": tool_metadata(old)}
            elif method == "ping":
                response["result"] = {}
            elif method == "tools/call":
                name = request["params"]["name"]
                args = request["params"].get("arguments", {})
                call = {"operation": name, "member": member, "arguments": args}
                calls.append(call)
                if name == "comms_inbox":
                    ids = unread[member]
                    text = (f"{member} 받은편지함(안 읽음 {len(ids)}):\n" +
                            "\n".join(f"합성 메시지 (id {mid})" for mid in ids)) if ids else "안 읽은 메시지 없음"
                elif name in {"comms_read", "comms_peek"}:
                    assert args["id"] == IDS[member]
                    if name == "comms_peek" and old:
                        call["unknownToolRejectedBeforeRead"] = True
                        response["error"] = {"code": -32602, "message": "알 수 없는 도구: comms_peek"}
                        responses.append(response)
                        continue
                    call["bodyFetched"] = True
                    marking = name == "comms_read" and (old or args.get("keepUnread") is not True)
                    if marking and IDS[member] in unread[member]:
                        unread[member].remove(IDS[member])
                        read_effects.append({"member": member, "id": IDS[member], "via": "comms_read"})
                    call["simulatedReadMarkApplied"] = marking
                    text = f"from: 합성-인프라\nid: {IDS[member]}\n본문: 합성 요청은 아직 미완료입니다."
                elif name == "comms_mark_read":
                    assert args["ids"] == [IDS[member]]
                    call["ownSummarySucceededBeforeAck"] = member in model_successes
                    call["allMemberSummariesSucceededBeforeAck"] = all(m in model_successes for m in members)
                    postapply_error = scenario == "second_member_mark_postapply_error" and member == "bot-routine"
                    if postapply_error:
                        for mid in args["ids"]:
                            if mid in unread[member]:
                                unread[member].remove(mid)
                                read_effects.append({"member": member, "id": mid, "via": "comms_mark_read_before_failed_response"})
                    if scenario == "mark_read_error" or (scenario == "second_member_mark_error" and member == "bot-routine") or postapply_error:
                        response["result"] = {"isError": True, "content": [{"type": "text", "text": "synthetic acknowledgement unavailable"}]}
                        responses.append(response)
                        continue
                    for mid in args["ids"]:
                        if mid in unread[member]:
                            unread[member].remove(mid)
                            read_effects.append({"member": member, "id": mid, "via": "comms_mark_read"})
                    text = f"읽음: {len(args['ids'])}"
                else:
                    raise AssertionError(f"Unexpected MCP tool: {name}")
                response["result"] = {"content": [{"type": "text", "text": text}]}
            else:
                raise AssertionError(f"Unexpected MCP method: {method}")
            responses.append(response)
        return subprocess.CompletedProcess(argv, 0, "\n".join(json.dumps(r, ensure_ascii=False) for r in responses) + "\n", "")

    fixture_error, exit_code = None, None
    with (block_external(), patch.object(module.subprocess, "run", side_effect=fake_run),
          patch.object(sys, "argv", ["digest.py", "--members", ",".join(members)]),
          contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr)):
        try:
            exit_code = module.main()
        except Exception as exc:
            fixture_error = type(exc).__name__ + ": " + str(exc)
    output, errors = stdout.getvalue(), stderr.getvalue()
    ops = [c["operation"] for c in calls]
    acks = [c for c in calls if c["operation"] == "comms_mark_read"]
    checks = {"fixture_execution_completed": fixture_error is None}
    if scenario in {"new_mcp_model_failure", "model_timeout", "empty_success", "nonzero_cli_with_ok_text"}:
        checks.update(failure_exit=exit_code == 2, unread_preserved=unread == initial_unread,
                      no_ack_attempts=not acks, failed_ids_in_stdout=IDS["bot-routine"] in output)
    elif scenario == "first_success_second_failure":
        checks.update(failure_exit=exit_code == 2, failed_member_unread=unread["bot-routine"] == initial_unread["bot-routine"],
                      failed_member_not_acked=not any(c["member"] == "bot-routine" for c in acks),
                      first_summary_preserved=SUMMARIES["bot-hostwatch"] in output,
                      failed_ids_in_stdout=IDS["bot-routine"] in output)
    elif scenario == "old_mcp_ignores_keep_unread":
        checks.update(failure_exit=exit_code == 2,
                      unsupported_capability_failed_closed="tools/list" in ops or any(c.get("unknownToolRejectedBeforeRead") for c in calls),
                      stopped_before_body_read=not any(c.get("bodyFetched") for c in calls), stopped_before_model="model_prompt" not in ops,
                      unread_preserved=unread == initial_unread, no_ack_attempts=not acks)
    elif scenario == "mark_read_error":
        checks.update(failure_exit=exit_code == 2, summary_preserved=SUMMARIES["bot-routine"] in output,
                      pending_ids_in_stdout=IDS["bot-routine"] in output,
                      unread_preserved_in_preapply_error_fixture=unread == initial_unread)
    elif scenario == "second_member_mark_error":
        checks.update(failure_exit=exit_code == 2,
                      both_summaries_preserved=all(s in output for s in SUMMARIES.values()),
                      both_ids_reported=all(mid in output for mid in IDS.values()),
                      first_ack_applied_second_preapply_error=unread["bot-hostwatch"] == [] and unread["bot-routine"] == initial_unread["bot-routine"],
                      no_false_unread_claim_for_acked_member=f"{module.NAMES['bot-hostwatch']} 안 읽은 채 남김" not in output)
    elif scenario == "normal_success_two_members":
        checks.update(success_exit=exit_code == 0, all_summaries_visible=all(s in output for s in SUMMARIES.values()),
                      both_acked=len(acks) == 2 and all(not ids for ids in unread.values()),
                      each_ack_after_own_success=all(c["ownSummarySucceededBeforeAck"] for c in acks),
                      all_target_summaries_before_every_ack=all(c["allMemberSummariesSucceededBeforeAck"] for c in acks),
                      body_reads_keep_unread=all(not c.get("simulatedReadMarkApplied") for c in calls if c["operation"] in {"comms_read", "comms_peek"}))
    elif scenario == "second_member_mark_postapply_error":
        failed_id_lines = [line for line in output.splitlines() if IDS["bot-routine"] in line]
        unknown_status = any(re.search(r"미확정|불명|미확인|실패|확인.*못|알\s*수\s*없", line) for line in failed_id_lines)
        definitely_unread = any("안읽은채남김" in re.sub(r"\s+", "", line) for line in failed_id_lines)
        checks.update(failure_exit=exit_code == 2,
                      both_summaries_preserved=all(s in output for s in SUMMARIES.values()),
                      both_ids_reported=all(mid in output for mid in IDS.values()),
                      fixture_applied_both_read_marks=all(not ids for ids in unread.values()),
                      failed_member_ack_status_unknown_or_failed=unknown_status,
                      no_false_definite_unread_claim_for_failed_member=not definitely_unread)
    else:
        checks.update(success_exit=exit_code == 0, empty_output="(새 글 없음)" in output,
                      no_body_model_or_ack=not any(op in ops for op in ("comms_read", "comms_peek", "model_prompt", "comms_mark_read")))
    return {
        "scenario": scenario, "members": members, "old_mcp_fixture": old, "checks": checks,
        "contract_passed": all(checks.values()), "fixture_execution_completed": fixture_error is None,
        "fixture_error": fixture_error, "exit_code": exit_code, "stdout": output, "stderr": errors,
        "calls": calls, "initial_unread": initial_unread, "remaining_unread": unread,
        "simulated_read_effects": read_effects,
        "all_target_summaries_before_every_ack": all(c["allMemberSummariesSucceededBeforeAck"] for c in acks) if acks else None,
        "all_target_order_required_in_normal_success_case": True,
        "mark_error_fixture_scope": ("state applied before error response; caller cannot know final state"
                                     if scenario == "second_member_mark_postapply_error"
                                     else "error before state mutation; an error after server mutation may be ambiguous"),
        "real_child_processes": 0, "real_model_requests": 0, "real_mcp_requests": 0,
        "real_unread_state_touched": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=REPO / ".local/inbox-digest-source-bcefdaa.py")
    parser.add_argument("--commit", default="bcefdaa48bfbcc7c2be7f9a72ac5b41422346fbe")
    parser.add_argument("--output", type=Path, default=DIRECTORY / "bcefdaa.json")
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(REPO) or output.exists():
        parser.error("output must be a new file inside this checkout")
    source = args.source.read_bytes()
    spec = importlib.util.spec_from_file_location("inbox_read_ack_regression_source", args.source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load source")
    module = importlib.util.module_from_spec(spec)
    with block_external(), patch.object(subprocess, "run", side_effect=blocked):
        spec.loader.exec_module(module)
    results = [observe(module, scenario) for scenario in SCENARIOS]
    report = {
        "format": "inbox-read-ack-offline-regression-v1", "source_commit": args.commit,
        "source_path": str(args.source.resolve()), "source_sha256": hashlib.sha256(source).hexdigest(),
        "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "fixture_execution_completed": all(r["fixture_execution_completed"] for r in results),
        "contract_passed": all(r["contract_passed"] for r in results),
        "passed_cases": sum(r["contract_passed"] for r in results), "total_cases": len(results),
        "scope": "Original main/summarize; subprocess responses and read state simulated. Not a deployed Task or actual MCP test.",
        "real_child_processes": 0, "real_model_requests": 0, "real_mcp_requests": 0,
        "real_unread_state_touched": False, "results": results,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(output), "fixture_execution_completed": report["fixture_execution_completed"],
                      "contract_passed": report["contract_passed"], "passed_cases": report["passed_cases"],
                      "total_cases": report["total_cases"], "failed": [r["scenario"] for r in results if not r["contract_passed"]],
                      "real_model_requests": 0}, ensure_ascii=False))
    return 0 if report["contract_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
