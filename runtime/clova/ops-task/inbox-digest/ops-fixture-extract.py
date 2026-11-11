#!/usr/bin/env python3
"""Extract declarative ops MCP metadata without importing/executing its source."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
import re


def extract(source: bytes) -> dict:
    wanted = {"TASK_HOST", "RESOURCE_TEMPLATES", "TOOLS"}
    assignments = {}
    for node in ast.parse(source.decode("utf-8")).body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in wanted:
                    if target.id in assignments:
                        raise ValueError(f"Repeated assignment: {target.id}")
                    assignments[target.id] = node.value
    if assignments.keys() != wanted:
        raise ValueError("Expected TASK_HOST, RESOURCE_TEMPLATES and TOOLS assignments")
    task_hosts = ast.literal_eval(assignments["TASK_HOST"])
    if not isinstance(task_hosts, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in task_hosts.items()):
        raise ValueError("TASK_HOST must be a string mapping")

    def data(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool, type(None))):
            return node.value
        if isinstance(node, ast.List):
            return [data(item) for item in node.elts]
        if isinstance(node, ast.Dict) and all(k is not None for k in node.keys):
            return {data(k): data(v) for k, v in zip(node.keys, node.values)}
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "sorted"
                and not node.keywords and len(node.args) == 1 and isinstance(node.args[0], ast.Name)
                and node.args[0].id == "TASK_HOST"):
            return sorted(task_hosts)
        raise ValueError(f"Unsupported metadata expression: {ast.dump(node, include_attributes=False)}")

    tools = data(assignments["TOOLS"])
    templates = data(assignments["RESOURCE_TEMPLATES"])
    if len(tools) != 5 or not all(t.get("annotations", {}).get("readOnlyHint") is True for t in tools):
        raise ValueError("Expected this source snapshot's five readonly tools")
    return {"TOOLS": tools, "TASK_HOST": task_hosts, "RESOURCE_TEMPLATES": templates}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-commit", required=True, help="Observed local Git HEAD; does not claim deployed version")
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("ops-fixture-tools-schema.json"))
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source_commit):
        raise ValueError("source-commit must be the full observed commit hash")
    source = args.source.read_bytes()
    metadata = extract(source)
    canonical = json.dumps(metadata, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    result = {
        "format": "isolated-ops-fixture-schema-v1",
        "source": {"path": str(args.source), "git_head": args.source_commit,
                   "sha256": hashlib.sha256(source).hexdigest(),
                   "version_scope": "local source snapshot; deployed 354c4b0 not inspected"},
        "extraction": {"method": "AST data only; literals plus sorted(TASK_HOST); no eval/import/exec/handler/network/subprocess",
                       "metadata_sha256": hashlib.sha256(canonical).hexdigest()},
        "metadata": metadata,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "tools": len(metadata["TOOLS"]),
                      "source_sha256": result["source"]["sha256"],
                      "metadata_sha256": result["extraction"]["metadata_sha256"]}))


if __name__ == "__main__":
    main()
