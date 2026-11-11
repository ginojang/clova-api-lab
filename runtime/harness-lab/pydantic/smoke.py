"""Regression: interruption after an MCP effect poisons the old session."""
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile

BASE = Path(__file__).resolve().parent


async def main():
    with tempfile.TemporaryDirectory(prefix="poison-smoke-", dir=BASE / ".tmp") as root:
        root = Path(root)
        workspace = root / "workspace"
        workspace.mkdir()
        script = root / "script.json"
        usage = {"input": 11, "output": 5, "cacheRead": 0, "cacheWrite": 0}
        script.write_text(json.dumps([
            {"message": {"role": "assistant", "content": "", "toolCalls": [
                {"id": "write1", "type": "function", "function": {
                    "name": "clova__artifact_write", "arguments": {"path": "a.txt", "text": "first"}}}]},
             "finishReason": "tool_calls", "usage": usage},
            {"message": {"role": "assistant", "content": "done"}, "finishReason": "stop",
             "usage": usage, "delayMs": 10000},
        ]))
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-B", str(BASE / "cli.py"), "--workspace", str(workspace),
            "--script", str(script), stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )

        def send(value):
            process.stdin.write((json.dumps(value) + "\n").encode())

        async def wait(kind):
            while True:
                line = await asyncio.wait_for(process.stdout.readline(), 15)
                assert line, (await process.stderr.read()).decode()
                event = json.loads(line)
                if event["t"] == kind:
                    return event["data"]

        def exited(pid):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return True
            return False

        try:
            ready = await wait("ready")
            send({"op": "prompt", "text": "write"})
            await wait("turn_start")
            approval = await wait("approval")
            assert not (workspace / "a.txt").exists()
            send({"op": "approve", "approvalId": approval["approvalId"], "allow": True})
            assert (await wait("tool_result"))["ok"] is True
            await asyncio.sleep(0.05)
            send({"op": "interrupt"})
            assert (await wait("error"))["code"] == "interrupted"
            assert (await wait("idle"))["requiresRestart"] is True
            assert (workspace / "a.txt").read_text() == "first"
            assert exited(ready["mcpPid"])
            send({"op": "prompt", "text": "must not replay"})
            assert (await wait("error"))["code"] == "session_invalid"
            send({"op": "new"})
            assert (await wait("error"))["code"] == "session_invalid"
            process.stdin.close()
            await asyncio.wait_for(process.wait(), 10)
            assert process.returncode == 0
            assert exited(ready["mcpPid"])
            assert (workspace / "a.txt").read_text() == "first"
            print(json.dumps({"framework": "pydantic-ai", "version": "2.66.0", "passed": True,
                              "checks": ["approval before effect", "post-effect interrupt poison", "MCP cleanup",
                                         "prompt and new blocked", "EOF cleanup", "completed effect is not rolled back"]}))
        finally:
            if process.returncode is None:
                process.stdin.close()
                await asyncio.wait_for(process.wait(), 10)


if __name__ == "__main__":
    asyncio.run(main())
