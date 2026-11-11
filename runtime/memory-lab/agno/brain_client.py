"""Private asyncio JSONL transport for the existing Node Brain; no provider implementation."""
from __future__ import annotations
import asyncio
from contextlib import suppress
import json
import os
import shutil
import uuid
from mcp_client import LabError, LOCAL, ROOT


class BrainClient:
    def __init__(self, model, on_attempt):
        self.model, self.on_attempt = model, on_attempt
        self.proc = self.reader_task = self.ready = None
        self.pending = {}

    async def start(self):
        env = {name: os.environ[name] for name in ("PATH", "LANG", "LC_ALL", "TZ", "CLOVA_API_KEY_FILE", "CLOVA_BASE_URL")
               if name in os.environ}
        env.update(NODE_NO_WARNINGS="1", TMPDIR=str(LOCAL / ".tmp"))
        self.ready = asyncio.get_running_loop().create_future()
        self.proc = await asyncio.create_subprocess_exec(
            shutil.which("node") or "node", str(LOCAL / "brain_bridge.mjs"), self.model,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            cwd=ROOT, env=env, limit=2 * 1024 * 1024)
        self.reader_task = asyncio.create_task(self.read())
        try:
            response = await asyncio.wait_for(asyncio.shield(self.ready), 10)
            if not response.get("ok"):
                err = response.get("error", {})
                raise LabError(err.get("code", "configuration"), err.get("message", "Brain initialization failed"))
        except BaseException:
            await self.close()
            raise

    async def read(self):
        try:
            while raw := await self.proc.stdout.readline():
                response = json.loads(raw)
                if response.get("event") == "ready":
                    if not self.ready.done():
                        self.ready.set_result(response)
                    continue
                future = self.pending.get(response.get("id"))
                if future is None or future.done():
                    continue
                if response.get("event") == "provider_request":
                    self.on_attempt(response["id"])
                else:
                    future.set_result(response)
        except (ValueError, TypeError, KeyError, asyncio.LimitOverrunError):
            pass
        finally:
            for future in [self.ready, *self.pending.values()]:
                if future is not None and not future.done():
                    future.set_exception(LabError("bridge_closed", "Brain bridge disconnected"))

    async def send(self, request):
        if self.proc is None or self.proc.returncode is not None:
            raise LabError("bridge_closed", "Brain bridge is unavailable; start a fresh worker")
        self.proc.stdin.write((json.dumps(request, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
        await self.proc.stdin.drain()

    async def cancel(self, ident, future):
        try:
            await self.send({"op": "cancel", "id": ident})
            # Brain's AbortSignal reaches fetch. A failed cancellation closes the transport.
            await asyncio.wait_for(asyncio.shield(future), 2)
        except Exception:
            await self.close()

    async def call(self, messages, tools, max_tokens):
        ident = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        try:
            await self.send({"op": "call", "id": ident, "messages": messages, "tools": tools, "maxTokens": max_tokens})
            try:
                response = await asyncio.wait_for(asyncio.shield(future), 65)
            except asyncio.CancelledError:
                await self.cancel(ident, future)
                raise
            except TimeoutError:
                await self.cancel(ident, future)
                raise LabError("timeout", "Brain bridge exceeded its response deadline")
            if not response.get("ok"):
                error = response.get("error", {})
                fault = LabError(error.get("code", "api_error"), error.get("message", "Brain request failed"))
                fault.usage = error.get("usage")
                raise fault
            return response["answer"]
        finally:
            self.pending.pop(ident, None)
            if future.done() and not future.cancelled():
                future.exception()  # Consume transport errors even when cancellation won the race.
            elif not future.done():
                future.cancel()

    async def close(self):
        if self.proc is not None and self.proc.returncode is None:
            with suppress(BrokenPipeError, ConnectionResetError):
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
        if self.reader_task is not None:
            await self.reader_task
        if self.ready is not None and self.ready.done() and not self.ready.cancelled():
            self.ready.exception()
