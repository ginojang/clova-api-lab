"""Real native Claude TUI + installed Elda attach; the parent supplies a local model fixture."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time


def run(opts):
    root = Path(tempfile.mkdtemp(prefix="clova-native-attach-"))
    workspace, config = root / "workspace", root / "config"
    workspace.mkdir(); config.mkdir()
    socket = str(root / "tmux.sock")
    target = "clova-isolated"
    token = Path(opts.token_file).read_text().strip()
    fixture = json.loads(Path(opts.fixture).read_text())
    model = fixture["model"]
    tools = fixture["tools"]
    mcp = root / "mcp.json"
    mcp.write_text(json.dumps({"mcpServers": {"clova": {"command": opts.node,
        "args": [opts.mcp, "mcp", "--workspace", str(workspace)],
        "env": {"CLOVA_MCP_ALLOWED_TOOLS": ",".join(tools)}}}}))
    mcp.chmod(0o600)
    # This is a new test-only preferences file. API-key approval is deliberately left to the TUI.
    preferences = config / ".claude.json"
    preferences.write_text(json.dumps({"hasCompletedOnboarding": True, "theme": "dark",
        "projects": {str(workspace): {"hasTrustDialogAccepted": True}}}))
    preferences.chmod(0o600)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "USER", "LOGNAME", "SHELL") if key in os.environ}
    env.update({"LANG": "C.UTF-8", "TERM": "xterm-256color", "CLAUDE_CONFIG_DIR": str(config),
        "ANTHROPIC_BASE_URL": opts.base_url, "ANTHROPIC_API_KEY": token,
        "ANTHROPIC_MODEL": model, "ANTHROPIC_DEFAULT_HAIKU_MODEL": model,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": model, "ANTHROPIC_DEFAULT_OPUS_MODEL": model,
        "CLAUDE_CODE_SUBAGENT_MODEL": model, "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "2048",
        "MAX_THINKING_TOKENS": "0", "CLAUDE_CODE_EFFORT_LEVEL": "unset", "DISABLE_PROMPT_CACHING": "1",
        "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS": "1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "NODE_NO_WARNINGS": "1", "PYTHONDONTWRITEBYTECODE": "1",
        "ELDA_USAGE_DIR": str(root / "usage"), "ELDA_USAGE_CLAUDE": str(root / "usage.json"),
        "ELDA_LIVE_POLL": "0.1", "ELDA_TMUX_SOCKET": socket})
    started_all = time.monotonic()
    report = {"harness": "Claude Code interactive", "inference": opts.inference, "pass": False,
        "nativeBinary": str(Path(opts.claude).resolve()), "observerBinary": str(Path(opts.elda).resolve()),
        "events": [], "turns": [], "checks": {"privateTmux": False, "interactiveNativeDiscovered": False,
        "apiApprovalViaTty": False, "eldaReady": False, "privateTmuxStopped": False, "noTestProcessesRemain": False}}
    observer = None
    tmux = lambda *args: subprocess.run(["tmux", "-S", socket, *args], env=env, capture_output=True, text=True, timeout=5)
    screen = lambda: tmux("capture-pane", "-p", "-t", target, "-S", "-80").stdout
    def safe(text):
        return text.replace(token, "***").replace(token[-20:], "***")
    try:
        args = [opts.claude, "--bare", "--model", model, "--setting-sources", "",
            "--strict-mcp-config", "--mcp-config", str(mcp), "--tools", "",
            "--allowedTools", ",".join("mcp__clova__" + tool for tool in tools),
            "--disallowedTools", "mcp__clova__clova_chat,mcp__clova__batch,mcp__clova__api_version",
            "--permission-mode", "dontAsk",
            "--system-prompt", fixture.get("systemPrompt", "Use only the artifact tools. Preserve requested file content exactly. After tool success, answer briefly.")]
        created = tmux("-f", "/dev/null", "new-session", "-d", "-s", target, "-x", "160", "-y", "45", "-c", str(workspace), *args)
        if created.returncode: raise RuntimeError("private tmux start failed: " + safe(created.stderr))
        report["checks"]["privateTmux"] = True
        deadline, approved = time.monotonic() + 35, False
        while time.monotonic() < deadline:
            current = screen()
            if "Do you want to use this API key" in current and not approved:
                tmux("send-keys", "-t", target, "Up", "Enter")
                approved = True; report["checks"]["apiApprovalViaTty"] = True
                time.sleep(0.4)
            rows = subprocess.run([opts.claude, "agents", "--json", "--cwd", str(workspace)], env=env,
                capture_output=True, text=True, timeout=5)
            try: sessions = json.loads(rows.stdout or "[]")
            except ValueError: sessions = []
            native = [s for s in sessions if s.get("kind") == "interactive" and s.get("sessionId")]
            if len(native) == 1:
                report["checks"]["interactiveNativeDiscovered"] = True
                report["sessionId"] = native[0]["sessionId"]
                break
            time.sleep(0.2)
        if not report["checks"]["interactiveNativeDiscovered"]:
            raise RuntimeError("native interactive Claude did not register within 35 seconds")
        observer = subprocess.Popen([opts.elda, "claude", "--events", "--attach", target,
            "--tmux-socket", socket, "--cwd", str(workspace)], cwd=workspace, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        observed = queue.Queue()
        def read():
            for line in observer.stdout:
                try: event = json.loads(line)
                except ValueError: continue
                report["events"].append(event); observed.put(event)
        threading.Thread(target=read, daemon=True).start()
        def wait(kind, timeout=35):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                try: event = observed.get(timeout=0.1)
                except queue.Empty:
                    if observer.poll() is not None: raise RuntimeError("Elda attach exited before " + kind)
                    continue
                if event["t"] == "error": raise RuntimeError("Elda attach error: " + str(event["data"]))
                if event["t"] == kind: return event
            raise RuntimeError("Elda attach timed out waiting for " + kind)
        wait("ready"); report["checks"]["eldaReady"] = True
        wait("live")
        for step in fixture["steps"]:
            mark = len(report["events"]); started = time.monotonic()
            observer.stdin.write(json.dumps({"op": "prompt", "text": step["prompt"]}, ensure_ascii=False) + "\n")
            observer.stdin.flush()
            wait("turn_end", opts.turn_timeout); wait("idle", 5)
            events = report["events"][mark:]
            artifact = workspace / fixture["file"]
            text = artifact.read_text() if artifact.exists() else None
            calls = [e["data"] for e in events if e["t"] == "tool_call"]
            results = [e["data"] for e in events if e["t"] == "tool_result"]
            checks = {"artifactExact": text == step["expectedText"], "observedTools": len(calls) > 0,
                "observedToolResults": len(results) == len(calls),
                "toolsSucceeded": all(result.get("ok") for result in results),
                "observedTurnEnd": any(e["t"] == "turn_end" and e["data"].get("ok") for e in events)}
            names = [call.get("tool") for call in calls]
            if step.get("requiredTool"):
                checks["requiredToolOnce"] = names.count("mcp__clova__" + step["requiredTool"]) == 1
            if step.get("alsoRequiredTool"):
                checks["alsoRequiredTool"] = "mcp__clova__" + step["alsoRequiredTool"] in names
            if step.get("requiredTool") == "artifact_undo":
                checks["undoWithoutRewrite"] = "mcp__clova__artifact_write" not in names
            report["turns"].append({"id": step["id"], "pass": all(checks.values()), "checks": checks,
                "durationMs": round((time.monotonic() - started) * 1000), "artifactText": text,
                "toolCalls": calls, "toolResults": results,
                "usage": next((e["data"].get("usage") for e in events if e["t"] == "turn_end"), None)})
        report["checks"]["observerEofLeavesEngineAlive"] = False
        observer.stdin.close(); observer.wait(timeout=5)
        report["checks"]["observerEofLeavesEngineAlive"] = tmux("has-session", "-t", target).returncode == 0
    except Exception as error:
        report["error"] = safe(str(error))
        report["screen"] = safe(screen())
    finally:
        if observer is not None and observer.poll() is None:
            observer.terminate()
            try: observer.wait(timeout=3)
            except subprocess.TimeoutExpired: observer.kill(); observer.wait()
        tmux("kill-server")
        report["checks"]["privateTmuxStopped"] = tmux("has-session", "-t", target).returncode != 0
        def leftovers():
            found = []
            for entry in Path("/proc").iterdir():
                if entry.name.isdigit() and int(entry.name) != os.getpid():
                    try:
                        command = (entry / "cmdline").read_bytes()
                        if str(root).encode() in command: found.append(int(entry.name))
                    except (FileNotFoundError, PermissionError, ProcessLookupError): pass
            return found
        deadline = time.monotonic() + 3
        while leftovers() and time.monotonic() < deadline: time.sleep(0.05)
        remaining = leftovers()
        for pid in remaining:
            try: os.kill(pid, 15)
            except ProcessLookupError: pass
        if remaining: time.sleep(0.3)
        for pid in leftovers():
            try: os.kill(pid, 9)
            except ProcessLookupError: pass
        report["leftoverPids"] = leftovers()
        report["checks"]["noTestProcessesRemain"] = not report["leftoverPids"]
        shutil.rmtree(root)
        report["durationMs"] = round((time.monotonic() - started_all) * 1000)
        report["pass"] = not report.get("error") and len(report["turns"]) == len(fixture["steps"]) and all(t["pass"] for t in report["turns"]) and all(report["checks"].values())
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("base-url", "token-file", "fixture", "node", "mcp", "claude", "elda"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--inference", choices=("mock", "live"), default="mock")
    parser.add_argument("--turn-timeout", type=int, default=35)
    report = run(parser.parse_args())
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0 if report["pass"] else 1)
