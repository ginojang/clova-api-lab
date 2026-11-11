#!/usr/bin/env python3
"""Synthetic-input-only stdio MCP: expose exact schemas, execute no operations."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys


TOOL_ERROR = "isolated fixture: tool call not executed"
RESOURCE_ERROR = "isolated fixture: resource read not executed"


def reply(request_id, *, result=None, error=None):
    message = {"jsonrpc": "2.0", "id": request_id}
    message["error" if error is not None else "result"] = error if error is not None else result
    print(json.dumps(message, ensure_ascii=False), flush=True)


def main():
    manifest = json.loads(Path(__file__).with_name("ops-fixture-tools-schema.json").read_text(encoding="utf-8"))
    metadata = manifest["metadata"]
    canonical = json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if hashlib.sha256(canonical).hexdigest() != manifest["extraction"]["metadata_sha256"]:
        raise ValueError("Fixture metadata hash mismatch")
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except ValueError:
            reply(None, error={"code": -32700, "message": "parse error"})
            continue
        if not isinstance(request, dict):
            reply(None, error={"code": -32600, "message": "invalid request"})
            continue
        if "id" not in request:
            continue
        request_id, method, params = request["id"], request.get("method"), request.get("params", {})
        if not isinstance(params, dict):
            reply(request_id, error={"code": -32602, "message": "params must be an object"})
            continue
        if method == "initialize":
            reply(request_id, result={"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                                     "capabilities": {"tools": {}, "resources": {}},
                                     "serverInfo": {"name": "isolated-ops-fixture", "version": "1.0.0"}})
        elif method == "tools/list":
            reply(request_id, result={"tools": metadata["TOOLS"]})
        elif method == "tools/call":
            print(json.dumps({"event": "isolated_fixture_tool_call", "name": params.get("name"),
                              "arguments": params.get("arguments", {}), "executed": False}, ensure_ascii=False),
                  file=sys.stderr, flush=True)
            reply(request_id, result={"content": [{"type": "text", "text": TOOL_ERROR}], "isError": True})
        elif method == "resources/templates/list":
            reply(request_id, result={"resourceTemplates": metadata["RESOURCE_TEMPLATES"]})
        elif method == "resources/list":
            reply(request_id, result={"resources": []})
        elif method == "resources/read":
            print(json.dumps({"event": "isolated_fixture_resource_read", "uri": params.get("uri"),
                              "executed": False}, ensure_ascii=False), file=sys.stderr, flush=True)
            reply(request_id, error={"code": -32002, "message": RESOURCE_ERROR})
        elif method == "ping":
            reply(request_id, result={})
        else:
            reply(request_id, error={"code": -32601, "message": "method not found"})


if __name__ == "__main__":
    main()
