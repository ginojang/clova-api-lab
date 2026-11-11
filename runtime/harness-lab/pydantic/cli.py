#!/usr/bin/env python3
"""Experimental PydanticAI mode-2 JSONL worker. Not an Elda provider."""
from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
from pydantic_ai import Agent, DeferredToolRequests, DeferredToolResults, Tool, models
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.toolsets import FunctionToolset
from pydantic_ai.usage import RequestUsage, RunUsage, UsageLimits

ROOT = Path(__file__).resolve().parents[3]
LOCAL = Path(__file__).resolve().parent
NAMES = ("artifact_list", "artifact_read", "artifact_write", "artifact_undo")
models.ALLOW_MODEL_REQUESTS = False


class LabError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class MCP:
    """Small stdio JSON-RPC transport; file operations belong to mcp.ts only."""
    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.proc = None
        self.reader = None
        self.next_id = 0
        self.pending = {}

    async def start(self):
        env = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL", "TZ") if k in os.environ}
        env.update(CLOVA_MCP_ALLOWED_TOOLS=",".join(NAMES), NODE_NO_WARNINGS="1", TMPDIR=str(LOCAL / ".tmp"))
        node = shutil.which("node")
        if not node:
            raise LabError("configuration", "Node.js is required for the local MCP server")
        self.proc = await asyncio.create_subprocess_exec(
            node, str(ROOT / "runtime/clova/mcp.ts"), "mcp", "--workspace", str(self.workspace),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=env, cwd=str(ROOT),
        )
        self.reader = asyncio.create_task(self.read())
        await self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                          "clientInfo": {"name": "pydantic-harness-lab", "version": "0.1.0"}})
        self.proc.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        await self.proc.stdin.drain()
        result = await self.request("tools/list", {})
        tools = result.get("tools", [])
        if {t["name"] for t in tools} != set(NAMES):
            raise LabError("configuration", "MCP tool allowlist mismatch")
        return tools

    async def read(self):
        try:
            while line := await self.proc.stdout.readline():
                data = json.loads(line)
                future = self.pending.pop(data.get("id"), None)
                if future is None or future.done():
                    continue
                if "error" in data:
                    future.set_exception(LabError("mcp_error", "MCP returned a JSON-RPC error"))
                else:
                    future.set_result(data.get("result", {}))
        except (json.JSONDecodeError, ValueError):
            pass
        finally:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(LabError("mcp_closed", "MCP connection closed"))
            self.pending.clear()

    async def request(self, method, params):
        self.next_id += 1
        ident = self.next_id
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        try:
            self.proc.stdin.write((json.dumps({"jsonrpc": "2.0", "id": ident, "method": method, "params": params}) + "\n").encode())
            await self.proc.stdin.drain()
            return await asyncio.wait_for(future, 15)
        finally:
            self.pending.pop(ident, None)

    async def close(self):
        if self.proc:
            if self.proc.stdin:
                self.proc.stdin.close()
            try:
                await asyncio.wait_for(self.proc.wait(), 2)
            except TimeoutError:
                self.proc.terminate()
                try:
                    await asyncio.wait_for(self.proc.wait(), 2)
                except TimeoutError:
                    self.proc.kill()
                    await self.proc.wait()
        if self.reader:
            await self.reader


class Worker:
    def __init__(self, args):
        self.args = args
        self.script = json.loads(Path(args.script).read_text())
        if not isinstance(self.script, list) or not self.script:
            raise LabError("configuration", "Script must be a nonempty answer array")
        self.index = 0
        self.seq = 0
        self.session = str(uuid.uuid4())
        self.history = []
        self.pending = {}
        self.active = None
        self.mcp = MCP(Path(args.workspace))
        self.turns = 0
        self.calls = 0
        self.usage = {}
        self.had_tool_error = False
        self.closing = False
        self.poisoned = False

    def emit(self, kind, **data):
        self.seq += 1
        print(json.dumps({"v": 1, "seq": self.seq, "ts": datetime.now(timezone.utc).isoformat(),
                          "t": kind, "data": data}, ensure_ascii=False), flush=True)

    async def model(self, messages, info):
        # Actual SDK FunctionModel executes this callback at every native Agent model step.
        if self.turns >= self.args.max_turns:
            raise LabError("max_turns", "Maximum model requests reached")
        self.turns += 1
        if self.index >= len(self.script):
            raise LabError("script_exhausted", "Scripted model has no response remaining")
        answer = self.script[self.index]
        self.index += 1
        if answer.get("delayMs"):
            await asyncio.sleep(answer["delayMs"] / 1000)
        usage = answer.get("usage", {})
        for field in self.usage:
            self.usage[field] += usage.get(field, 0)
        message = answer["message"]
        parts = []
        if message.get("content"):
            parts.append(TextPart(message["content"]))
        for call in message.get("toolCalls", []):
            function = call["function"]
            arguments = function.get("arguments", {})
            part = ToolCallPart(function["name"], arguments, call["id"])
            parts.append(part)
            try:
                inputs = part.args_as_dict()
            except (ValueError, TypeError):
                inputs = arguments
            self.emit("tool_call", tool=part.tool_name, callId=part.tool_call_id, input=inputs)
            if part.tool_name not in self.names:
                self.had_tool_error = True
                self.emit("tool_result", tool=part.tool_name, callId=part.tool_call_id,
                          ok=False, output="Unknown tool; no MCP operation executed")
        if not parts:
            raise LabError("invalid_model_response", "Model returned neither text nor tool calls")
        return ModelResponse(parts, model_name="scripted-harness-lab",
                             usage=RequestUsage(input_tokens=usage.get("input", 0), output_tokens=usage.get("output", 0)),
                             finish_reason="tool_call" if message.get("toolCalls") else "stop")

    def make_tool(self, spec):
        async def execute(ctx, **arguments):
            # SDK checks deferred approval before it invokes this function.
            if not ctx.tool_call_approved:
                raise LabError("approval_invariant", "SDK dispatched an unapproved tool")
            self.calls += 1
            result = await self.mcp.request("tools/call", {"name": spec["name"], "arguments": arguments})
            ok = not result.get("isError", False)
            output = "\n".join(part.get("text", "") for part in result.get("content", []) if part.get("type") == "text")
            self.had_tool_error |= not ok
            self.emit("tool_result", tool=ctx.tool_name, callId=ctx.tool_call_id, ok=ok, output=output)
            return {"ok": ok, "output": output}

        tool = Tool.from_schema(execute, name="clova__" + spec["name"], description=spec["description"],
                                json_schema=spec["inputSchema"], takes_ctx=True, sequential=True)
        tool.requires_approval = True
        return tool

    async def start(self):
        specs = await self.mcp.start()
        self.names = ["clova__" + spec["name"] for spec in specs]
        self.agent = Agent(FunctionModel(self.model, model_name="scripted-harness-lab"),
                           output_type=[str, DeferredToolRequests],
                           system_prompt=json.loads((ROOT / "runtime/clova/fixtures/comparison.json").read_text())["systemPrompt"],
                           toolsets=[FunctionToolset([self.make_tool(spec) for spec in specs])],
                           retries=0, name="elda_pydantic_lab")
        self.emit("ready", framework="pydantic-ai", version=importlib.metadata.version("pydantic-ai-slim"),
                  model="scripted", tools=self.names, mcpPid=self.mcp.proc.pid)

    async def turn(self, text):
        self.turns = self.calls = 0
        self.usage = {k: 0 for k in ("input", "output", "cacheRead", "cacheWrite")}
        self.had_tool_error = False
        started = time.monotonic()
        self.emit("turn_start", sessionId=self.session)
        try:
            async with asyncio.timeout(self.args.timeout_ms / 1000):
                history = self.history
                deferred = None
                sdk_usage = RunUsage()
                while True:
                    # This loop only resumes native approval interruptions. Agent owns all model/tool steps.
                    result = await self.agent.run(text, message_history=history, deferred_tool_results=deferred,
                                                  usage=sdk_usage, usage_limits=UsageLimits(request_limit=self.args.max_turns),
                                                  conversation_id=self.session)
                    history = result.all_messages()
                    if not isinstance(result.output, DeferredToolRequests):
                        self.history = history
                        if result.output:
                            self.emit("text", text=result.output)
                        self.emit("turn_end", ok=not self.had_tool_error,
                                  endReason="tool_error" if self.had_tool_error else "stop",
                                  turns=self.turns, toolCalls=self.calls, usage=self.usage,
                                  durationMs=round((time.monotonic() - started) * 1000), sessionId=self.session)
                        break
                    approvals = {}
                    futures = []
                    for call in result.output.approvals:
                        approval_id = str(uuid.uuid4())
                        future = asyncio.get_running_loop().create_future()
                        self.pending[approval_id] = (future, call)
                        self.emit("approval", tool=call.tool_name, callId=call.tool_call_id,
                                  input=call.args_as_dict(), approvalId=approval_id)
                        futures.append((approval_id, future, call))
                    if not futures or result.output.calls:
                        raise LabError("unsupported_deferred", "Unexpected external deferred tool request")
                    for approval_id, future, call in futures:
                        allow = await future
                        self.pending.pop(approval_id, None)
                        approvals[call.tool_call_id] = allow
                        if not allow:
                            self.emit("tool_result", tool=call.tool_name, callId=call.tool_call_id,
                                      ok=False, output="Tool call denied by user; no MCP operation executed")
                    deferred = DeferredToolResults(approvals=approvals)
                    text = None
        except asyncio.CancelledError:
            self.poisoned |= self.calls > 0
            self.emit("error", code="interrupted", message="Turn cancelled; pending approvals invalidated")
        except TimeoutError:
            self.poisoned |= self.calls > 0
            self.emit("error", code="interrupted", message="Turn deadline exceeded")
        except (LabError, UsageLimitExceeded) as exc:
            code = exc.code if isinstance(exc, LabError) else "max_turns"
            self.poisoned |= self.calls > 0 and code != "max_turns"
            self.emit("error", code=code, message=str(exc))
            self.emit("turn_end", ok=False, endReason=code, turns=self.turns, toolCalls=self.calls,
                      usage=self.usage, durationMs=round((time.monotonic() - started) * 1000), sessionId=self.session)
        except Exception as exc:
            self.poisoned |= self.calls > 0
            # Never print provider payloads or environment contents.
            self.emit("error", code="engine", message=f"Agent execution failed ({type(exc).__name__})")
            self.emit("turn_end", ok=False, endReason="engine", turns=self.turns, toolCalls=self.calls,
                      usage=self.usage, durationMs=round((time.monotonic() - started) * 1000), sessionId=self.session)
        finally:
            for future, _ in self.pending.values():
                if not future.done():
                    future.cancel()
            self.pending.clear()
            if self.poisoned:
                await self.mcp.close()
            self.emit("idle", sessionId=self.session, requiresRestart=self.poisoned)

    async def interrupt(self):
        if self.active and not self.active.done():
            self.active.cancel()
            await self.active

    async def command(self, raw):
        try:
            obj = json.loads(raw)
            if not isinstance(obj, dict) or not isinstance(obj.get("op"), str):
                raise ValueError()
        except (ValueError, UnicodeDecodeError):
            self.emit("error", code="invalid_input", message="Expected a JSON object with an op")
            return
        op = obj["op"]
        if op == "approve":
            approval_id = obj.get("approvalId")
            if not isinstance(approval_id, str) or type(obj.get("allow")) is not bool:
                self.emit("error", code="invalid_input", message="Approval needs a string ID and boolean allow")
            elif approval_id not in self.pending or self.pending[approval_id][0].done():
                self.emit("error", code="no_such_approval", message="Unknown, stale, or already resolved approval ID")
            else:
                self.pending[approval_id][0].set_result(obj["allow"])
        elif op == "interrupt":
            await self.interrupt()
        elif op in ("prompt", "new"):
            if self.active and not self.active.done():
                self.emit("error", code="busy", message="Wait for idle before another prompt or reset")
            elif self.poisoned:
                self.emit("error", code="session_invalid", message="Tool outcome may be uncertain; start a fresh worker and workspace")
            elif op == "new":
                self.history = []
                self.index = 0
                self.session = str(uuid.uuid4())
                self.emit("notice", message="Conversation and scripted model reset", sessionId=self.session, mcpPid=self.mcp.proc.pid)
                self.emit("idle", sessionId=self.session, requiresRestart=False)
            elif not isinstance(obj.get("text"), str) or not obj["text"].strip():
                self.emit("error", code="invalid_input", message="Prompt needs nonempty text")
            else:
                self.active = asyncio.create_task(self.turn(obj["text"]))
        else:
            self.emit("error", code="invalid_input", message="Unknown operation")

    async def serve(self):
        try:
            await self.start()
            reader = asyncio.StreamReader(limit=1024 * 1024)
            protocol = asyncio.StreamReaderProtocol(reader)
            transport, _ = await asyncio.get_running_loop().connect_read_pipe(lambda: protocol, sys.stdin.buffer)
            try:
                while raw := await reader.readline():
                    await self.command(raw)
            finally:
                transport.close()
        finally:
            self.closing = True
            await self.interrupt()
            await self.mcp.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--script", required=True)
    parser.add_argument("--max-turns", type=int, default=4)
    parser.add_argument("--timeout-ms", type=int, default=120000)
    args = parser.parse_args()
    for field in ("workspace", "script"):
        value = Path(getattr(args, field)).resolve()
        if not value.is_relative_to(ROOT):
            parser.error(f"--{field} must stay inside this project")
        setattr(args, field, str(value))
    if args.max_turns < 1 or args.timeout_ms < 1:
        parser.error("Limits must be positive")
    Path(args.workspace).mkdir(parents=True, exist_ok=True)
    (LOCAL / ".tmp").mkdir(exist_ok=True)
    try:
        asyncio.run(Worker(args).serve())
    except Exception as exc:
        print(f"Pydantic worker startup failed ({type(exc).__name__})", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
