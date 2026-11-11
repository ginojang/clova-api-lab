"""Fixed-server stdio transport copied from the earlier harness prototype."""
import asyncio
import json
import os
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[3]
LOCAL = Path(__file__).resolve().parent
NAMES = ("artifact_list", "artifact_read", "artifact_write", "artifact_undo")
class LabError(Exception):
    def __init__(self, code, message):
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
