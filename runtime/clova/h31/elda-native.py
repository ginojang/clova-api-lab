#!/usr/bin/env python3
"""H31 profile loader for the installed Elda CLI's unmodified native loop.

This file only validates a fixed comparison profile and delegates to the real
LoopAdapter + events.run. It contains no model/tool execution loop and does not
register agents or edit the installed CLI. stdout is the native JSONL stream.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

SOURCE_FILES = ("events.py", "adapters/loop.py", "providers/__init__.py",
                "providers/clova.py", "mcp_client.py")
PROFILE_KEYS = {"model", "system", "servers", "max_turns", "token_limit", "tools"}


def load_profile(path: Path, workspace: Path) -> dict:
    profile = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(profile, dict) or set(profile) - PROFILE_KEYS:
        raise ValueError("Profile must be an object containing only the documented H31 fields")
    if profile.get("model") not in ("clova:HCX-005", "clova:HCX-007"):
        raise ValueError("H31 native profile requires clova:HCX-005 or clova:HCX-007")
    system = profile.get("system")
    if not isinstance(system, str) or not system or system != system.strip():
        raise ValueError("system must be nonempty text without leading/trailing whitespace")
    for key in ("max_turns", "token_limit"):
        if type(profile.get(key)) is not int or profile[key] < 1:
            raise ValueError(f"{key} must be an explicit positive integer")
    if not workspace.is_dir():
        raise ValueError("workspace must already be a directory")
    servers = profile.get("servers")
    if not isinstance(servers, list) or len(servers) != 1 or not isinstance(servers[0], dict):
        raise ValueError("H31 requires exactly one explicit MCP server")
    server = servers[0]
    if server.get("name") != "clova" or server.get("instructions") is not False:
        raise ValueError("MCP server must be named clova with instructions:false")
    command = server.get("command")
    if not isinstance(command, list) or not command or not all(isinstance(v, str) and v for v in command):
        raise ValueError("MCP command must be an explicit nonempty string array")
    rules = profile.get("tools", {})
    if not isinstance(rules, dict) or any(not isinstance(k, str) or v != "ask" for k, v in rules.items()):
        raise ValueError("Comparison tool rules may contain only ask; all calls require explicit approval")
    profile["approve"] = "always"
    return profile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli-dir", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--validate-only", action="store_true", help="Validate and hash sources without importing the CLI or reading credentials")
    args = parser.parse_args()
    cli_dir = Path(args.cli_dir).resolve()
    workspace = Path(args.workspace).resolve()
    try:
        for name in SOURCE_FILES:
            if not (cli_dir / name).is_file():
                raise ValueError(f"Native Elda CLI source missing: {name}")
        profile = load_profile(Path(args.profile), workspace)
        max_tokens = int(os.environ.get("ELDA_CLOVA_MAX_TOKENS", "2048"))
        if not 1024 <= max_tokens <= 2048:
            raise ValueError("Tool comparison requires ELDA_CLOVA_MAX_TOKENS in 1024..2048")
        effort = os.environ.get("ELDA_EFFORT")
        if profile["model"] == "clova:HCX-005" and effort:
            raise ValueError("HCX-005 comparison requires ELDA_EFFORT unset")
        if profile["model"] == "clova:HCX-007" and effort not in (None, "", "none"):
            raise ValueError("HCX-007 tool comparison requires effort none")
    except (OSError, ValueError, TypeError):
        # Do not print arbitrary profile contents, environment values, or paths.
        parser.error("Invalid H31 profile, source directory, workspace, or generation settings; see README")
    if args.validate_only:
        print(json.dumps({"valid": True, "model": profile["model"],
                          "maxTurns": profile["max_turns"], "tokenLimit": profile["token_limit"],
                          "maxTokens": max_tokens, "temperature": 0, "approval": "ask",
                          "sourceHashes": {name: hashlib.sha256((cli_dir / name).read_bytes()).hexdigest()
                                           for name in SOURCE_FILES}}, ensure_ascii=False))
        return 0
    sys.path.insert(0, str(cli_dir))
    from adapters.loop import LoopAdapter
    import events

    adapter = LoopAdapter(profile)
    name = "h31-native"
    agents = {name: {"kind": "giant", "gate": "loop", "quota": False}}
    try:
        return events.run(name, agents, lambda _: adapter, [
            "--cwd", str(workspace), "--approve", "ask", "--model", profile["model"],
        ])
    finally:
        adapter.close()


if __name__ == "__main__":
    raise SystemExit(main())
