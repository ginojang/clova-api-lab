#!/usr/bin/env python3
"""Test-only profile bootstrap for the installed Elda CLI; no agent loop here.

The public CLI currently has no external profile loader. This injects a profile
into its existing LoopAdapter and delegates all events, approvals, history,
MCP calls, and model calls to the original Elda CLI modules. It does not install
or register a new Elda CLI agent.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cli-dir", required=True)
parser.add_argument("--profile", required=True)
parser.add_argument("--workspace", required=True)
parser.add_argument("--mode", choices=("2", "3"), required=True)
parser.add_argument("--token-file", required=True)
args = parser.parse_args()
cli_dir = Path(args.cli_dir).resolve()
for relative in ("events.py", "adapters/loop.py", "providers/openai_compat.py", "mcp_client.py"):
    if not (cli_dir / relative).is_file():
        parser.error(f"Elda CLI source is missing: {relative}")
token_path = Path(args.token_file)
if token_path.stat().st_mode & 0o777 != 0o600:
    parser.error("wrapper token file must have mode 600")
token = token_path.read_text(encoding="utf-8").strip()
if not token:
    parser.error("wrapper token file is empty")
# The current OpenAICompat provider accepts an environment value only. The
# integration launcher reads its dedicated token file; never use the CLOVA key.
os.environ["ELDA_API_KEY"] = token
sys.path.insert(0, str(cli_dir))
from adapters.loop import LoopAdapter  # noqa: E402
import events  # noqa: E402

profile = json.loads(Path(args.profile).read_text(encoding="utf-8"))
profile["approve"] = "always" if args.mode == "2" else "never"
adapter = LoopAdapter(profile)
# Existing events.run requires an approval-capable registry entry for --approve
# ask. The profile above causes LoopAdapter to invoke its real approve callback.
agents = {"clova-integration": {"kind": "giant", "gate": "engine"}}
sys.exit(events.run("clova-integration", agents, lambda _: adapter, [
    "--cwd", args.workspace,
    "--approve", "ask" if args.mode == "2" else "auto",
    "--model", profile["model"],
]))
