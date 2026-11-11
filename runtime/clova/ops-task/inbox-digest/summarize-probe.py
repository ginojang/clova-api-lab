#!/usr/bin/env python3
"""Call only digest.summarize on three frozen synthetic inputs. Offline by default."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
POpen = subprocess.Popen
BLOCK_EXTERNAL = True


def audit(event, args):
    if BLOCK_EXTERNAL and (event.startswith("subprocess.") or event.startswith("socket.")
                           or event in {"os.system", "os.exec", "os.posix_spawn", "os.fork", "os.forkpty"}):
        raise RuntimeError("probe blocked external activity: " + event)


sys.addaudithook(audit)


def sha(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode("utf-8")).hexdigest()


def fingerprint(path):
    return {"path": str(path), "sha256": sha(path.read_bytes())}


def reject(*args, **kwargs):
    raise RuntimeError("main/mcp_calls are forbidden in this summarize-only probe")


@contextmanager
def environment(values):
    old = {k: os.environ.get(k) for k in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def load_module(path, name):
    # The audit guard denies subprocess/network events throughout import and ops().
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load source")
    module = importlib.util.module_from_spec(spec)
    with patch.object(subprocess, "run", reject), patch.object(subprocess, "Popen", reject):
        spec.loader.exec_module(module)
    return module


class ArtifactWriter:
    """Do not copy parent environment or secret values into evidence."""
    def __init__(self, root):
        self.root = root
        self.redactions = 0
        # Never open key files. Only retain values already present in process memory.
        self.secrets = sorted({v for k, v in os.environ.items()
                               if re.search(r"(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)", k, re.I)
                               and not re.search(r"(?:FILE|PATH|DIR|LIMIT|MAX_TOKENS)$", k)
                               and len(v) >= 8}, key=len, reverse=True)

    def clean(self, value):
        for secret in self.secrets:
            count = value.count(secret)
            if count:
                self.redactions += count
                value = value.replace(secret, "[REDACTED_SECRET]")
        value, n = re.subn(r"(?i)(Bearer\s+)[A-Za-z0-9_./+=:-]+", r"\1[REDACTED_SECRET]", value)
        self.redactions += n
        return value

    def text(self, path, value):
        safe = self.clean(value)
        target = self.root / path
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open("x", encoding="utf-8") as stream:
            os.chmod(target, 0o600)
            stream.write(safe)
        return {"path": path, "sha256": sha(safe), "bytes": len(safe.encode("utf-8"))}

    def json(self, path, value):
        return self.text(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def events_from(stdout):
    events, bad = [], []
    for index, line in enumerate(stdout.splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except ValueError:
            bad.append(index)
            continue
        if isinstance(event, dict):
            events.append(event)
        else:
            bad.append(index)
    selected = lambda kind: [e for e in events if e.get("t") == kind]
    ends = selected("turn_end")
    end = ends[-1].get("data", {}) if ends else {}
    return {"ready": selected("ready"), "turnStart": selected("turn_start"),
            "turnEnd": ends, "toolCall": selected("tool_call"), "toolResult": selected("tool_result"),
            "retryEvents": selected("retry"), "errorEvents": selected("error"),
            "nonJsonLines": bad, "usage": end.get("usage"), "usageUnreported": end.get("usageUnreported"),
            "diag": end.get("diag"), "turns": end.get("turns"), "endReason": end.get("endReason"),
            "ok": end.get("ok"), "cost": end.get("cost"), "costBasis": end.get("costBasis")}


def run_child(argv, wire, env, cwd, record):
    global BLOCK_EXTERNAL
    start = time.monotonic()
    record.update(timeoutSeconds=90, timedOut=False, processGroupCleanup="not started")
    BLOCK_EXTERNAL = False
    try:
        child = POpen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                      text=True, encoding="utf-8", errors="replace", env=env, cwd=cwd, start_new_session=True)
    finally:
        BLOCK_EXTERNAL = True
    record["cliProcessesStarted"] = 1
    try:
        stdout, stderr = child.communicate(wire, timeout=90)
    except subprocess.TimeoutExpired:
        record["timedOut"] = True
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = child.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = child.communicate(timeout=3)
    finally:
        # CLI may leave its MCP descendants alive after the leader exits.
        try:
            os.killpg(child.pid, signal.SIGKILL)
            record["processGroupCleanup"] = "SIGKILL sent to remaining process group"
        except ProcessLookupError:
            record["processGroupCleanup"] = "process group absent"
        record["elapsedSeconds"] = round(time.monotonic() - start, 3)
    return subprocess.CompletedProcess(argv, child.returncode, stdout, stderr)


def mock_result(argv):
    rows = [
        {"t": "ready", "data": {"synthetic": True, "agent": "ops", "model": "clova:HCX-005"}},
        {"t": "turn_start", "data": {"synthetic": True}},
        {"t": "text", "data": {"text": "OFFLINE MOCK: transport/parser sentinel; not a model answer."}},
        {"t": "turn_end", "data": {"synthetic": True, "ok": True, "endReason": "completed",
                                   "turns": 0, "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                                   "diag": {"retries": 0, "emptyRetries": 0}}},
    ]
    return subprocess.CompletedProcess(argv, 0, "\n".join(json.dumps(r) for r in rows) + "\n", "")


def validate_inputs(packet):
    if packet.get("synthetic") is not True or packet.get("memberFixture") != "bot-routine":
        raise RuntimeError("expected synthetic bot-routine fixture")
    cases = packet["cases"]
    if [c["id"] for c in cases] != ["INBOX-COPY-A", "INBOX-COPY-B", "INBOX-COPY-C"]:
        raise RuntimeError("expected exactly three frozen cases in A/B/C order")
    for case in cases:
        if sha(case["originalSummarizePrompt"]) != case["promptSha256"]:
            raise RuntimeError("frozen prompt hash mismatch: " + case["id"])
        for message in case["messages"]:
            if message.get("synthetic") is not True:
                raise RuntimeError("non-synthetic message")
    return cases


def profile_snapshot(cli, agents, forced, writer, live):
    profiles = load_module(cli.parent / "profiles.py", "inbox_probe_profiles")
    with environment(forced):
        profile = profiles.ops()
    expected_servers = [{"name": "ops", "command": profile["servers"][0]["command"]}]
    if profile["servers"] != expected_servers or Path(expected_servers[0]["command"][-1]).resolve() != HERE / "ops-fixture-mcp.py":
        raise RuntimeError("profile must expose only the isolated ops fixture")
    if profile.get("model") != "clova:HCX-005":
        raise RuntimeError("unexpected profile model")
    if profile.get("max_turns") is not None or profile.get("token_limit") is not None:
        raise RuntimeError("profile overrides requested environment limits")
    agent = agents / "bot-routine.md"
    actual = agent.read_text(encoding="utf-8") if agent.is_file() else None
    used_agent = actual is not None and bool(actual.strip())
    if live and not used_agent:
        raise RuntimeError("live requires actual nonempty bot-routine.md; no OPS_SYSTEM fallback")
    expected_system = actual.strip() if used_agent else profiles.OPS_SYSTEM
    if profile.get("system") != expected_system:
        raise RuntimeError("profile system does not match actual agent/default")
    meta = {"profileSource": fingerprint(cli.parent / "profiles.py"), "source": "agent file" if used_agent else "OPS_SYSTEM fallback",
            "agentSource": fingerprint(agent) if agent.is_file() else None,
            "systemArtifact": writer.text("system-effective.txt", expected_system),
            "servers": profile["servers"], "model": profile["model"], "toolsPolicy": profile.get("tools"),
            "notes": profile.get("notes"), "profileCalledOffline": True, "mcpStartedDuringProfileCheck": 0}
    if actual is not None:
        meta["agentRawArtifact"] = writer.text("agent-bot-routine.md", actual)
    return meta


def execute_case(case, module, cli, forced, output, writer, live):
    cid = case["id"]
    report = {"id": cid, "synthetic": True, "mode": "live" if live else "offline-mock",
              "subprocessRunCalls": 0, "cliProcessesStarted": 0, "failure": None, "summary": None}
    function_stderr = io.StringIO()
    function_stdout = io.StringIO()
    frozen = case["originalSummarizePrompt"]
    expected_wire = json.dumps({"op": "prompt", "text": frozen}, ensure_ascii=False) + "\n"
    report["promptArtifact"] = writer.text(cid + "/prompt.txt", frozen)
    report["stdinArtifact"] = writer.text(cid + "/stdin.jsonl", expected_wire)

    def wrapped_run(argv, *args, **kwargs):
        report["subprocessRunCalls"] += 1
        if report["subprocessRunCalls"] != 1 or args:
            raise RuntimeError("only one subprocess.run per case is allowed")
        if not isinstance(argv, list) or len(argv) != 4 or argv[2:] != ["ops", "--events"] or Path(argv[1]).resolve() != cli:
            raise RuntimeError("unexpected subprocess command")
        expected_python = next((Path(p) for p in (str(Path.home() / ".local/bin/python3.12"),) if Path(p).exists()), Path(sys.executable))
        if Path(argv[0]).resolve() != expected_python.resolve():
            raise RuntimeError("unexpected Python interpreter")
        if kwargs.get("input") != expected_wire:
            raise RuntimeError("original summarize prompt differs from frozen input")
        if kwargs.get("capture_output") is not True or kwargs.get("text") is not True:
            raise RuntimeError("unexpected subprocess stream contract")
        if set(kwargs) != {"input", "capture_output", "text", "timeout", "env"}:
            raise RuntimeError("unexpected subprocess option")
        child_env = dict(kwargs["env"])
        child_env.update(forced)
        if any(Path(child_env[k]).exists() for k in ("ELDA_OPS_COMMS_MCP", "ELDA_OPS_NOTION_MCP")):
            raise RuntimeError("disabled MCP path unexpectedly exists")
        report.update(promptMatched=True, promptSha256=sha(frozen), command=argv,
                      originalRequestedTimeoutSeconds=kwargs["timeout"], effectiveEnvironment=forced)
        result = run_child(argv, expected_wire, child_env, output, report) if live else mock_result(argv)
        report["returncode"] = result.returncode
        report["stdoutArtifact"] = writer.text(cid + "/stdout.jsonl", result.stdout)
        report["stderrArtifact"] = writer.text(cid + "/stderr.txt", result.stderr)
        report["events"] = events_from(result.stdout)
        if report.get("timedOut"):
            report["failure"] = "CLI timed out after 90 seconds"
        elif result.returncode != 0:
            report["failure"] = "CLI nonzero exit status"
        elif any(len(report["events"][key]) != 1 for key in ("ready", "turnStart", "turnEnd")):
            report["failure"] = "expected exactly one ready, turn_start and turn_end"
        elif report["events"]["ok"] is not True:
            report["failure"] = "CLI turn_end not ok"
        return result

    try:
        with environment(forced), patch.object(module.subprocess, "run", wrapped_run), redirect_stderr(function_stderr), redirect_stdout(function_stdout):
            report["summary"] = module.summarize("bot-routine", [m["fullCommsReadText"] for m in case["messages"]])
        if report["subprocessRunCalls"] != 1:
            raise RuntimeError("summarize did not call subprocess exactly once")
        if not isinstance(report["summary"], str) or not report["summary"].strip():
            raise RuntimeError("summary is empty")
    except Exception as exc:
        report["failure"] = report["failure"] or type(exc).__name__ + ": " + str(exc)
    report["functionStderrArtifact"] = writer.text(cid + "/function-stderr.txt", function_stderr.getvalue())
    report["functionStdoutArtifact"] = writer.text(cid + "/function-stdout.txt", function_stdout.getvalue())
    if report["summary"] is not None:
        report["summaryArtifact"] = writer.text(cid + "/summary.txt", report["summary"])
    writer.json(cid + "/result.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--agents", type=Path, default=Path.home() / "apps/elda-ops/agents")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    source, cli, agents, output = (p.expanduser().resolve() for p in (args.source, args.cli, args.agents, args.output))
    if not output.is_relative_to(REPO):
        parser.error("output must be a new directory within this checkout")
    if output.exists():
        parser.error("output already exists; choose a new directory")
    output.mkdir(parents=True, mode=0o700)
    writer = ArtifactWriter(output)
    forced = {"ELDA_OPS_MCP": str(HERE / "ops-fixture-mcp.py"),
              "ELDA_OPS_COMMS_MCP": str(output / "disabled-comms-mcp.missing"),
              "ELDA_OPS_NOTION_MCP": str(output / "disabled-notion-mcp.missing"),
              "ELDA_OPS_AGENTS": str(agents), "ELDA_MEMBER": "bot-routine", "ELDA_MODEL": "clova:HCX-005",
              "ELDA_MAX_TURNS": "1", "ELDA_TOKEN_LIMIT": "6000", "ELDA_CLOVA_MAX_TOKENS": "1024",
              "PYTHONDONTWRITEBYTECODE": "1"}
    report = {"format": "inbox-summarize-probe-v1", "createdAt": datetime.now(timezone.utc).isoformat(),
              "syntheticInputs": True, "mode": "live" if args.live else "offline-mock", "failure": None,
              "scope": "only original summarize(); main/mcp_calls never called; not production Task end-to-end",
              "actualCommsCalls": 0, "readMarksChanged": 0, "semanticQualityEvaluated": False,
              "mockIsNotModelEvidence": not args.live, "cases": [], "effectiveEnvironment": forced,
              "limits": {"cliProcesses": 3, "cliSecondsEach": 90, "modelTurnsEach": 1, "h20RetriesEach": 1,
                         "outputTokensEach": 1024, "tokenLimit": 6000,
                         "tokenLimitMeaning": "cumulative usage checked before next turn; not a first-request cost cap",
                         "sourceBasedFullRunModelRequests": {"usual": 3, "maximum": 6},
                         "wireRequestsMeasured": False},
              "logs": "CLI stdout/stderr retained with secret redaction if needed; fixture stderr is not forwarded by mcp_client; inspect tool events"}
    try:
        case_path = HERE / "CASES-2026-11-11.json"
        packet = json.loads(case_path.read_text(encoding="utf-8"))
        cases = validate_inputs(packet)
        report["source"] = fingerprint(source)
        report["casesSource"] = fingerprint(case_path)
        report["runner"] = fingerprint(Path(__file__).resolve())
        report["cliSources"] = [fingerprint(cli.parent / p) for p in
                                (cli.name, "profiles.py", "events.py", "adapters/loop.py", "providers/clova.py", "mcp_client.py")]
        manifest_path = HERE / "PROBE-SOURCES.json"
        frozen_sources = json.loads(manifest_path.read_text(encoding="utf-8"))
        source_differences = []
        if report["source"]["sha256"] != frozen_sources["digestSha256"]:
            source_differences.append("digest.py")
        for relative, expected in frozen_sources["cliSha256"].items():
            if sha((cli.parent / relative).read_bytes()) != expected:
                source_differences.append("CLI/" + relative)
        report["sourceContract"] = {"manifest": fingerprint(manifest_path), "enforced": args.live,
                                    "differences": source_differences,
                                    "cliGitRevisionVerifiedByParent": frozen_sources["cliGitRevisionVerifiedByParent"]}
        if args.live and source_differences:
            raise RuntimeError("live source contract changed; stop before CLI/model and review a new contract: " + ", ".join(source_differences))
        report["fixtureSources"] = [fingerprint(HERE / p) for p in ("ops-fixture-mcp.py", "ops-fixture-tools-schema.json")]
        manifest = json.loads((HERE / "ops-fixture-tools-schema.json").read_text(encoding="utf-8"))
        canonical = json.dumps(manifest["metadata"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if sha(canonical) != manifest["extraction"]["metadata_sha256"] or len(manifest["metadata"]["TOOLS"]) != 5:
            raise RuntimeError("fixture must retain the five frozen tools and metadata hash")
        report["fixtureToolNames"] = [t["name"] for t in manifest["metadata"]["TOOLS"]]
        report["profile"] = profile_snapshot(cli, agents, forced, writer, args.live)
        with environment(forced):
            module = load_module(source, "inbox_probe_digest")
        module.main = reject
        module.mcp_calls = reject
        module.ELDA = str(cli)
        for case in cases:
            item = execute_case(case, module, cli, forced, output, writer, args.live)
            report["cases"].append(item)
            if item["failure"]:
                report["failure"] = item["id"] + ": " + item["failure"]
                break
    except Exception as exc:
        report["failure"] = type(exc).__name__ + ": " + str(exc)
    report["completedCases"] = len(report["cases"])
    report["skippedCases"] = 3 - report["completedCases"]
    report["cliProcessesStarted"] = sum(c["cliProcessesStarted"] for c in report["cases"])
    report["actualCliCalls"] = report["cliProcessesStarted"]
    report["actualMcpCalls"] = None if args.live else 0
    report["actualModelRequests"] = None if args.live else 0
    report["sourceBasedAttemptUpperBoundForStartedCli"] = 2 * report["cliProcessesStarted"]
    # Clean report once before counting redactions; never persist parent environment.
    cleaned = writer.clean(json.dumps(report, ensure_ascii=False))
    report = json.loads(cleaned)
    report["secretRedactions"] = writer.redactions
    writer.json("report.json", report)
    print(json.dumps({"mode": report["mode"], "completedCases": report["completedCases"],
                      "cliProcessesStarted": report["cliProcessesStarted"], "failure": report["failure"],
                      "report": str(output / "report.json")}, ensure_ascii=False))
    return 1 if report["failure"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
