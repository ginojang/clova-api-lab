#!/usr/bin/env python3
"""Independently verify 354c4b0 boundaries; retain the earlier failure reproduction."""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[4]
DIRECTORY = Path(__file__).resolve().parent
FIXED_COMMIT = "354c4b018d19ef0d6a11c64f344f04e0a5c95a1e"
MESSAGE_ID = "a000000001"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def blocked(*args, **kwargs):
    raise AssertionError("No external process or network during digest import/execution")


def observe(module, case):
    calls, simulated_reads = [], []
    stdout, stderr = io.StringIO(), io.StringIO()

    def fake_run(argv, **kwargs):
        if argv[-2:] == ["ops", "--events"]:
            assert case == "valid_inbox_then_model_failure"
            assert json.loads(kwargs["input"])["op"] == "prompt"
            end = {"t": "turn_end", "data": {"ok": False, "endReason": "api_error",
                                               "usage": {"input": 12, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                                               "usageUnreported": ["cacheRead", "cacheWrite"],
                                               "diag": {"retries": 1}}}
            calls.append({"operation": "model_prompt", "simulated_reads_already_done": list(simulated_reads),
                          "synthetic_turn_end": end})
            return subprocess.CompletedProcess(argv, 1, json.dumps(end) + "\n", "synthetic provider failure")
        assert argv == [module.NODE, module.COMMS_MCP]
        messages = [json.loads(line) for line in kwargs["input"].splitlines()]
        requests = [m for m in messages if m.get("method") == "tools/call"]
        assert len(requests) == 1
        request = requests[0]
        name, arguments = request["params"]["name"], request["params"]["arguments"]
        calls.append({"operation": name, "arguments": arguments})
        response = {"jsonrpc": "2.0", "id": request["id"]}
        if name == "comms_inbox":
            if case == "tool_is_error":
                response["result"] = {"isError": True, "content": [{"type": "text", "text": "synthetic lookup failure"}]}
            elif case == "jsonrpc_error":
                response["error"] = {"code": -32603, "message": "synthetic lookup failure"}
            else:
                text = {
                    "genuine_empty_inbox": "정기업무 받은편지함\n안 읽은 메시지 없음",
                    "malformed_inbox_count": f"정기업무 받은편지함(안 읽음 2)\n합성 메시지 (id {MESSAGE_ID})",
                    "valid_inbox_then_model_failure": f"정기업무 받은편지함(안 읽음 1)\n합성 메시지 (id {MESSAGE_ID})",
                }[case]
                response["result"] = {"content": [{"type": "text", "text": text}]}
        elif name == "comms_read":
            assert case == "valid_inbox_then_model_failure" and arguments == {"id": MESSAGE_ID}
            simulated_reads.append(MESSAGE_ID)
            response["result"] = {"content": [{"type": "text", "text": "[합성 인프라] pluto 점검 결과를 확인해 주세요."}]}
        else:
            raise AssertionError(f"Unexpected tool: {name}")
        return subprocess.CompletedProcess(argv, 0, json.dumps(response, ensure_ascii=False) + "\n", "")

    with (
        patch.object(module.subprocess, "run", side_effect=fake_run),
        patch.object(subprocess, "Popen", side_effect=blocked),
        patch.object(socket, "socket", side_effect=blocked),
        patch.object(socket, "create_connection", side_effect=blocked),
        patch.object(sys, "argv", ["digest.py", "--members", "bot-routine"]),
        contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr),
    ):
        code = module.main()
    output, errors = stdout.getvalue(), stderr.getvalue()
    if case == "genuine_empty_inbox":
        checks = {"success_exit": code == 0, "explicit_empty_output": "(새 글 없음)" in output,
                  "inbox_only": [c["operation"] for c in calls] == ["comms_inbox"]}
        outcome = "pass: explicit empty inbox remains successful"
    elif case == "valid_inbox_then_model_failure":
        checks = {"failure_exit": code == 2, "no_false_empty_output": "(새 글 없음)" not in output,
                  "valid_header_reaches_model": [c["operation"] for c in calls] == ["comms_inbox", "comms_read", "model_prompt"],
                  "read_before_model": calls[-1].get("simulated_reads_already_done") == [MESSAGE_ID],
                  "simulated_read_remains": simulated_reads == [MESSAGE_ID],
                  "new_stderr_usage_and_retry_log": "'input': 12" in errors and "retries 1" in errors,
                  "usage_unreported_flag_not_retained_in_stderr": "usageUnreported" not in errors}
        outcome = "failure window remains: read completes before model failure; fixture state is not restored"
    else:
        expected_error = {"tool_is_error": "comms MCP 도구 오류", "jsonrpc_error": "comms MCP 오류",
                          "malformed_inbox_count": "받은편지함 글을 알아보지 못했다"}[case]
        checks = {"failure_exit": code == 2, "no_false_empty_output": "(새 글 없음)" not in output,
                  "expected_error_reported": expected_error in output,
                  "no_read_or_model_after_failure": [c["operation"] for c in calls] == ["comms_inbox"]}
        outcome = "pass: lookup/format failure is reported instead of empty success"
    return {"case": case, "checks_verified": all(checks.values()), "checks": checks,
            "observation": outcome, "main_exit_code": code, "stdout": output, "stderr": errors,
            "calls": calls, "simulated_read_marks_after_return": simulated_reads,
            "real_model_requests": 0, "real_mcp_requests": 0, "real_unread_state_touched": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / ".local/inbox-digest-source-354c4b0.py")
    parser.add_argument("--git-dir", type=Path, default=ROOT / ".local/ops-review-source.git")
    args = parser.parse_args()
    # Read only the own-workspace bare mirror. No fetch/remote action is performed.
    git = ["git", f"--git-dir={args.git_dir}"]
    committed_digest = subprocess.check_output(git + ["show", f"{FIXED_COMMIT}:inbox-digest/digest.py"])
    committed_ops = subprocess.check_output(git + ["show", f"{FIXED_COMMIT}:mcp/ops_mcp.py"])
    source = args.source.read_bytes()
    if source != committed_digest:
        raise AssertionError("Source copy differs from fixed Git blob")
    baseline = DIRECTORY / "offline-boundary-repro.json"
    baseline_hash = sha256(baseline.read_bytes())
    manifest = json.loads((DIRECTORY / "ops-fixture-tools-schema.json").read_text())
    spec = importlib.util.spec_from_file_location("inbox_digest_fixed_offline_source", args.source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load source copy")
    module = importlib.util.module_from_spec(spec)
    with (
        patch.object(subprocess, "run", side_effect=blocked), patch.object(subprocess, "Popen", side_effect=blocked),
        patch.object(socket, "socket", side_effect=blocked), patch.object(socket, "create_connection", side_effect=blocked),
    ):
        spec.loader.exec_module(module)
    cases = [observe(module, case) for case in ("genuine_empty_inbox", "tool_is_error", "jsonrpc_error",
                                               "malformed_inbox_count", "valid_inbox_then_model_failure")]
    result = {
        "schema": "inbox-digest-fixed-boundary-v1", "source_commit": FIXED_COMMIT,
        "source_path": str(args.source), "source_sha256": sha256(source), "source_copy_matches_git_blob": True,
        "baseline_report_sha256": baseline_hash, "baseline_report_unchanged": sha256(baseline.read_bytes()) == baseline_hash,
        "ops_schema_comparison": {"commit": FIXED_COMMIT, "committed_source_sha256": sha256(committed_ops),
                                  "fixture_source_sha256": manifest["source"]["sha256"],
                                  "same_source_bytes_sha256": sha256(committed_ops) == manifest["source"]["sha256"]},
        "five_boundaries_verified": all(case["checks_verified"] for case in cases),
        "remaining_read_before_failure_window": True,
        "remaining_usage_unreported_log_gap": True,
        "scope": "source-copy verification with fake subprocess only; deployment itself not independently checked",
        "real_model_requests": 0, "real_mcp_requests": 0, "real_unread_state_touched": False, "cases": cases,
    }
    result["verification_completed"] = (result["five_boundaries_verified"] and result["baseline_report_unchanged"]
                                        and result["ops_schema_comparison"]["same_source_bytes_sha256"])
    output = DIRECTORY / "offline-fixed-boundary-result.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output), "verification_completed": result["verification_completed"],
                      "five_boundaries_verified": result["five_boundaries_verified"],
                      "remaining_read_before_failure_window": True, "real_model_requests": 0}, ensure_ascii=False))
    return 0 if result["verification_completed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
