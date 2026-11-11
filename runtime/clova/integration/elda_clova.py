"""Elda CLI adapter for the external CLOVA LangGraph engine.

Install this file as adapters/clova.py and apply elda-cli-register.patch in a
reviewed Elda CLI checkout. ELDA_CLOVA_ENTRY points to langgraph.mjs (or .ts with
Node 24+). This adapter only transports JSONL; the child owns the model/tool
graph, state, approval waits and usage accounting. No provider loop lives here.
"""
from __future__ import annotations

import atexit
import json
import os
from pathlib import Path
import queue
import shutil
import signal
import subprocess
import threading
import time

from . import Adapter, Decision, Event


class ClovaAdapter(Adapter):
    id = "clova"
    title = "CLOVA · LangGraph"
    desc = "CLOVA LangGraph engine through its Elda JSONL interface"

    def __init__(self) -> None:
        self._proc = None
        self._queue = queue.Queue()
        self._signature = None
        self._session_id = None
        self._has_turn = False
        self._active = False
        self._invalid = False
        self._interrupted = threading.Event()
        self._write_lock = threading.Lock()
        atexit.register(self.close)

    @property
    def session_id(self):
        return self._session_id

    def available(self) -> tuple[bool, str]:
        entry = os.environ.get("ELDA_CLOVA_ENTRY", "")
        node = os.environ.get("ELDA_CLOVA_NODE") or shutil.which("node")
        if not node or not Path(node).is_file():
            return False, "Set ELDA_CLOVA_NODE to the Node.js executable"
        if not entry or not Path(entry).is_file():
            return False, "Set ELDA_CLOVA_ENTRY to the CLOVA langgraph.mjs or langgraph.ts entry"
        for name in ("ELDA_CLOVA_CONFIG",):
            if os.environ.get(name) and not Path(os.environ[name]).is_file():
                return False, f"{name} is not a file"
        return True, "CLOVA LangGraph child (model connection checked on the first turn)"

    def _send(self, operation: dict) -> None:
        with self._write_lock:
            if self._proc is None or self._proc.poll() is not None:
                raise RuntimeError("CLOVA engine is not running")
            self._proc.stdin.write(json.dumps(operation, ensure_ascii=False) + "\n")
            self._proc.stdin.flush()

    def _next(self, timeout=330):
        try:
            event = self._queue.get(timeout=timeout)
        except queue.Empty:
            raise RuntimeError("CLOVA engine event timeout") from None
        if event is None:
            raise RuntimeError("CLOVA engine closed its event stream")
        return event

    def _start(self, cwd: str, model: str, approval: str) -> None:
        if self._invalid:
            raise RuntimeError("CLOVA session is invalid; restart Elda CLI with a fresh workspace")
        signature = (cwd, model, approval, os.environ.get("ELDA_CLOVA_CONFIG"))
        if self._proc is not None and self._proc.poll() is None and self._signature == signature:
            return
        self.close()
        ok, why = self.available()
        if not ok:
            raise RuntimeError(why)
        command = [os.environ.get("ELDA_CLOVA_NODE") or shutil.which("node"),
                   str(Path(os.environ["ELDA_CLOVA_ENTRY"]).resolve()),
                   "--events", "--workspace", cwd, "--model", model, "--approve", approval]
        if os.environ.get("ELDA_CLOVA_CONFIG"):
            command += ["--config", str(Path(os.environ["ELDA_CLOVA_CONFIG"]).resolve())]
        if os.environ.get("ELDA_CLOVA_RECORDS"):
            command += ["--records", str(Path(os.environ["ELDA_CLOVA_RECORDS"]).resolve())]
        # Pass credential FILE paths only. Do not propagate unrelated engine
        # credentials or tracing settings into this child or its MCP tools.
        allowed = ("PATH", "HOME", "LANG", "TMPDIR", "CLOVA_MAX_TURNS")
        prefix = {"clova": "CLOVA", "groq": "GROQ", "openrouter": "OPENROUTER", "zai": "ZAI"}.get(model.split(":", 1)[0])
        if prefix:
            allowed += (f"{prefix}_API_KEY_FILE", f"{prefix}_BASE_URL")
        env = {key: os.environ[key] for key in allowed if key in os.environ}
        self._queue = queue.Queue()
        self._proc = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, bufsize=1, start_new_session=True)
        self._signature = signature
        self._has_turn = False
        proc, events = self._proc, self._queue

        def read() -> None:
            try:
                for line in proc.stdout:
                    try:
                        event = json.loads(line)
                        if event.get("v") != 1 or not isinstance(event.get("data"), dict):
                            raise ValueError("invalid envelope")
                        events.put(event)
                    except (ValueError, AttributeError):
                        events.put({"t": "error", "data": {"code": "adapter", "message": "CLOVA engine emitted invalid JSONL"}})
            finally:
                events.put(None)

        def drain_stderr() -> None:
            # Child errors arrive through its redacted JSONL contract. Arbitrary
            # stderr is not copied into user events or transcripts.
            for _ in proc.stderr:
                pass

        threading.Thread(target=read, daemon=True).start()
        threading.Thread(target=drain_stderr, daemon=True).start()
        ready = self._next(30)
        if ready["t"] != "ready":
            self.close()
            detail = ready.get("data", {}).get("message", "startup failed")
            raise RuntimeError(f"CLOVA engine did not become ready: {detail}")
        self._session_id = ready["data"].get("sessionId")

    def run(self, prompt: str, *, cwd: str, approve, model=None, resume=None,
            auto_approve: bool = False, **_):
        model = model or os.environ.get("CLOVA_MODEL", "clova:HCX-005")
        got_idle = False
        self._interrupted.clear()
        try:
            self._start(cwd, model, "never" if auto_approve else "ask")
            if self._has_turn and resume != self._session_id:
                self._send({"op": "new"})
                notice = self._next(10)
                if notice["t"] != "notice":
                    raise RuntimeError("CLOVA engine could not start a new conversation")
                self._session_id = notice["data"].get("sessionId")
            self._has_turn = True
            self._active = True
            self._send({"op": "prompt", "text": prompt})
            end = None
            while True:
                event = self._next()
                kind, data = event["t"], event["data"]
                if kind == "idle":
                    got_idle = True
                    self._session_id = data.get("sessionId") or self._session_id
                    if data.get("requiresRestart"):
                        self._invalid = True
                    if end is not None and not self._interrupted.is_set():
                        yield Event("turn_end", end)
                    return
                if self._interrupted.is_set():
                    continue       # outer events.py emits interrupted + idle
                if kind == "turn_end":
                    end = data
                    self._session_id = data.get("sessionId") or self._session_id
                elif kind == "approval":
                    decision = approve(Event("approval", data))
                    # events.py releases its approval waiter just before it
                    # calls adapter.interrupt(). Avoid racing a deny response
                    # against cancellation and starting another model request.
                    if self._interrupted.is_set() or decision.reason == "턴 중단":
                        self.interrupt()
                        continue
                    self._send({"op": "approve", "approvalId": data["approvalId"],
                                "allow": decision.allow, "reason": decision.reason})
                elif kind not in ("ready", "text_delta"):
                    # Keep the complete text block; forwarding its delta too
                    # would make the outer Elda event packer duplicate it.
                    yield Event(kind, data)
        except (RuntimeError, OSError, ValueError, KeyError) as error:
            if not self._interrupted.is_set():
                yield Event("error", {"code": "adapter", "message": str(error)})
        finally:
            self._active = False
            if not got_idle and self._proc is not None and self._proc.poll() is None:
                try:
                    self._send({"op": "interrupt"})
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        if self._next(max(0.01, deadline-time.monotonic()))["t"] == "idle":
                            break
                    else:
                        self.close()
                except (RuntimeError, OSError):
                    self.close()

    def interrupt(self) -> None:
        self._interrupted.set()
        if self._proc is not None and self._proc.poll() is None:
            try:
                self._send({"op": "interrupt"})
            except (RuntimeError, OSError):
                pass

    def close(self) -> None:
        proc, self._proc = self._proc, None
        self._signature = None
        self._session_id = None
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.stdin.close()
                proc.wait(timeout=5)
        except (subprocess.TimeoutExpired, BrokenPipeError, OSError):
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=2)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
        finally:
            for pipe in (proc.stdin, proc.stdout, proc.stderr):
                try:
                    pipe.close()
                except OSError:
                    pass
