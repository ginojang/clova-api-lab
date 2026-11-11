#!/usr/bin/env python3
"""Reproduce digest boundaries with original code and subprocess-only fixtures.

No child process or network connection is allowed. Exit 0 means the observations
match this source snapshot; it does NOT mean the digest behavior is correct.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import contextlib
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
from unittest.mock import patch


DEFAULT_SOURCE = Path("/home/gino/WorkArea/Elda-Ops/inbox-digest/digest.py")
MEMBER = "bot-routine"
MESSAGE_ID = "a000000001"


def blocked(*args, **kwargs):
    raise AssertionError("Offline reproduction forbids network or real child processes")


def observe(module, case: str) -> dict:
    calls: list[dict] = []
    simulated_read_marks: list[str] = []
    stdout, stderr = io.StringIO(), io.StringIO()

    def fake_run(argv, **kwargs):
        # Only known synthetic input/output is retained. Never inspect/copy env.
        if argv[-2:] == ["ops", "--events"]:
            assert case == "read_then_model_failure"
            request = json.loads(kwargs["input"])
            assert request["op"] == "prompt"
            calls.append({"operation": "model_prompt", "simulated_reads_already_done": list(simulated_read_marks)})
            events = [
                {"t": "error", "data": {"code": "api_error", "message": "synthetic provider failure"}},
                {"t": "turn_end", "data": {"ok": False, "endReason": "api_error"}},
            ]
            return subprocess.CompletedProcess(argv, 1, "\n".join(json.dumps(e) for e in events) + "\n", "synthetic provider failure")

        assert argv == [module.NODE, module.COMMS_MCP], "Unexpected child command"
        messages = [json.loads(line) for line in kwargs["input"].splitlines()]
        tool_requests = [m for m in messages if m.get("method") == "tools/call"]
        assert len(tool_requests) == 1
        request = tool_requests[0]
        name = request["params"]["name"]
        arguments = request["params"]["arguments"]
        calls.append({"operation": name, "arguments": arguments})
        response = {"jsonrpc": "2.0", "id": request["id"]}
        if name == "comms_inbox":
            assert arguments == {}
            if case == "tool_is_error":
                response["result"] = {"isError": True, "content": [{"type": "text", "text": "synthetic inbox lookup failure"}]}
            elif case == "jsonrpc_error":
                response["error"] = {"code": -32603, "message": "synthetic inbox lookup failure"}
            else:
                content = f"합성 메시지 (id {MESSAGE_ID})" if case == "read_then_model_failure" else "안 읽은 메시지 없음"
                response["result"] = {"content": [{"type": "text", "text": content}]}
        elif name == "comms_read":
            assert case == "read_then_model_failure" and arguments == {"id": MESSAGE_ID}
            # Simulate server-side state only in this Python list; no actual inbox.
            simulated_read_marks.append(MESSAGE_ID)
            response["result"] = {"content": [{"type": "text", "text": "[합성 인프라] pluto 점검 결과를 확인해 주세요."}]}
        else:
            raise AssertionError(f"Unexpected fixture tool: {name}")
        return subprocess.CompletedProcess(argv, 0, json.dumps(response, ensure_ascii=False) + "\n", "")

    with (
        patch.object(module.subprocess, "run", side_effect=fake_run),
        patch.object(subprocess, "Popen", side_effect=blocked),
        patch.object(socket, "socket", side_effect=blocked),
        patch.object(socket, "create_connection", side_effect=blocked),
        patch.object(sys, "argv", [str(DEFAULT_SOURCE), "--members", MEMBER]),
        contextlib.redirect_stdout(stdout),
        contextlib.redirect_stderr(stderr),
    ):
        exit_code = module.main()

    output = stdout.getvalue()
    result = {
        "case": case,
        "member": MEMBER,
        "main_exit_code": exit_code,
        "stdout": output,
        "stderr": stderr.getvalue(),
        "calls": calls,
        "real_child_process_count": 0,
        "real_model_request_count": 0,
        "real_unread_state_touched": False,
        "simulated_read_marks_after_return": simulated_read_marks,
    }
    if case == "empty_inbox_control":
        expected = exit_code == 0 and "(새 글 없음)" in output and len(calls) == 1
        result.update(behavior_contract="pass", observation="정상 빈 목록은 모델 호출 없이 새 글 없음, 종료 0")
    elif case in {"tool_is_error", "jsonrpc_error"}:
        expected = exit_code == 0 and "(새 글 없음)" in output and len(calls) == 1
        result.update(
            behavior_contract="fail",
            observation="조회 실패가 정상 빈 목록으로 오인됨: 새 글 없음, 종료 0",
            required_behavior="조회 실패를 명시하고 비정상 종료로 보고",
        )
    else:
        expected = (
            exit_code == 2
            and [c["operation"] for c in calls] == ["comms_inbox", "comms_read", "model_prompt"]
            and calls[-1]["simulated_reads_already_done"] == [MESSAGE_ID]
            and simulated_read_marks == [MESSAGE_ID]
        )
        result.update(
            behavior_contract="failure_window_exposed",
            observation="읽기 완료 후 모델이 실패함. 종료 2는 정상 오류 보고지만 읽음 복구 호출은 없음",
            limitation="읽음은 가짜 MCP의 메모리 목록으로만 모사했다. 실제 Comms 저장소·상태는 확인하거나 변경하지 않았다",
        )
    result["snapshot_observation_reproduced"] = expected
    if not expected:
        result["behavior_contract"] = "changed_requires_review"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_suffix(".json"))
    args = parser.parse_args()
    source_bytes = args.source.read_bytes()
    spec = importlib.util.spec_from_file_location("inbox_digest_offline_source", args.source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load digest source")
    module = importlib.util.module_from_spec(spec)
    # Import the actual source; bytecode writes and all external execution are blocked.
    with (
        patch.object(subprocess, "run", side_effect=blocked),
        patch.object(subprocess, "Popen", side_effect=blocked),
        patch.object(socket, "socket", side_effect=blocked),
        patch.object(socket, "create_connection", side_effect=blocked),
    ):
        spec.loader.exec_module(module)
    results = [observe(module, case) for case in (
        "empty_inbox_control", "tool_is_error", "jsonrpc_error", "read_then_model_failure"
    )]
    false_empty_count = sum(r["behavior_contract"] == "fail" for r in results)
    report = {
        "schema": "inbox-digest-offline-boundary-v1",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "source_path": str(args.source),
        "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "source_scope": "local source only; deployed Task state not verified",
        "reproduction_completed": all(r["snapshot_observation_reproduced"] for r in results),
        "digest_behavior_contract": (
            f"failed; {false_empty_count} lookup errors falsely reported as an empty successful inbox"
            if false_empty_count else "changed_requires_review; earlier false-empty failures not reproduced"
        ),
        "paid_quality_cases_run": 0,
        "results": results,
        "note": "Exit 0 confirms these observations only, not correct application behavior. No credentials/environment values are captured.",
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(args.output), "reproduction_completed": report["reproduction_completed"],
                      "digest_behavior_contract": report["digest_behavior_contract"],
                      "real_model_requests": 0, "real_unread_state_touched": False}, ensure_ascii=False))
    return 0 if report["reproduction_completed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
