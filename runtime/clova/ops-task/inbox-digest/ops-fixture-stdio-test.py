#!/usr/bin/env python3
"""Run only the local fixture process over real stdio; no CLI/model/API invocation."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parent
    server = root / "ops-fixture-mcp.py"
    manifest = json.loads((root / "ops-fixture-tools-schema.json").read_text())
    requests = [
        {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 2, "method": "resources/templates/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "resources/list"},
        {"jsonrpc": "2.0", "id": 4, "method": "ping"},
    ]
    arguments = [{}, {"source": "synthetic", "limit": 1}, {"uri": "elda://feed/synthetic/latest"},
                 {"net": "pluto"}, {"task": "host-watch-pluto", "limit": 1}]
    for request_id, (tool, args) in enumerate(zip(manifest["metadata"]["TOOLS"], arguments), 5):
        requests.append({"jsonrpc": "2.0", "id": request_id, "method": "tools/call",
                         "params": {"name": tool["name"], "arguments": args}})
    requests.append({"jsonrpc": "2.0", "id": 10, "method": "resources/read",
                     "params": {"uri": "elda://feed/synthetic/latest"}})
    process = subprocess.run([sys.executable, "-B", str(server)],
                             input="\n".join(json.dumps(r) for r in requests) + "\n", text=True,
                             capture_output=True, timeout=10,
                             env={"PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"})
    responses = [json.loads(line) for line in process.stdout.splitlines()]
    by_id = {response["id"]: response for response in responses}
    audit = [json.loads(line) for line in process.stderr.splitlines()]
    checks = {
        "fixture_exit_zero": process.returncode == 0,
        "one_reply_per_request_no_notification_reply": len(responses) == 11 and set(by_id) == set(range(11)),
        "initialize_protocol_and_capabilities": by_id[0]["result"]["protocolVersion"] == "2025-06-18"
        and by_id[0]["result"]["capabilities"] == {"tools": {}, "resources": {}},
        "five_tools_exact_metadata": by_id[1]["result"]["tools"] == manifest["metadata"]["TOOLS"]
        and len(by_id[1]["result"]["tools"]) == 5,
        "resource_templates_exact_metadata": by_id[2]["result"]["resourceTemplates"] == manifest["metadata"]["RESOURCE_TEMPLATES"],
        "resources_list_empty": by_id[3]["result"] == {"resources": []},
        "ping_ok": by_id[4]["result"] == {},
        "all_tool_calls_are_deterministic_errors": all(by_id[i]["result"] == {
            "content": [{"type": "text", "text": "isolated fixture: tool call not executed"}], "isError": True
        } for i in range(5, 10)),
        "resource_read_is_error": by_id[10]["error"] == {"code": -32002, "message": "isolated fixture: resource read not executed"},
        "stderr_records_name_args_no_execution": len(audit) == 6
        and all(event["executed"] is False for event in audit)
        and [(event.get("name"), event.get("arguments")) for event in audit[:5]]
        == [(tool["name"], args) for tool, args in zip(manifest["metadata"]["TOOLS"], arguments)],
    }
    result = {"format": "isolated-ops-fixture-stdio-v1", "passed": all(checks.values()), "checks": checks,
              "source": manifest["source"], "metadata_sha256": manifest["extraction"]["metadata_sha256"],
              "fixture_sha256": hashlib.sha256(server.read_bytes()).hexdigest(),
              "scope": "local fixture subprocess only; no model, production MCP, API, SSH or inbox calls",
              "production_task_verified": False, "real_model_requests": 0,
              "requests": requests, "responses": responses, "stderr_audit": audit,
              "fixture_exit_code": process.returncode}
    output = root / "ops-fixture-stdio-result.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": result["passed"], "checks": checks, "output": str(output)}, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
