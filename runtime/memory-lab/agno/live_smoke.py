"""Exercise the real Brain/Agno transport against loopback only; no real credentials or APIs."""
import asyncio
from contextlib import suppress
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

BASE = Path(__file__).resolve().parent


def answer(text, input_tokens=11, output_tokens=7, calls=None):
    return {"status": {"code": "20000"}, "result": {
        "message": {"role": "assistant", "content": text, **({"toolCalls": calls} if calls else {})},
        "finishReason": "tool_calls" if calls else "stop",
        "usage": {"promptTokens": input_tokens, "completionTokens": output_tokens}}}


async def main():
    steps, requests, connections = asyncio.Queue(), [], set()
    received, disconnected = asyncio.Queue(), asyncio.Queue()

    async def http(reader, writer):
        connections.add(writer)
        try:
            headers = await reader.readuntil(b"\r\n\r\n")
            assert headers.startswith(b"POST /v3/chat-completions/HCX-005 HTTP/1.1")
            assert b"authorization: bearer local_dummy_key" in headers.lower()
            length = next(int(line.split(b":", 1)[1]) for line in headers.split(b"\r\n") if line.lower().startswith(b"content-length:"))
            body = json.loads(await reader.readexactly(length))
            requests.append(body)
            await received.put(body)
            step = await steps.get()
            if step == "hang":
                await reader.read()
                await disconnected.put(True)
                return
            status, content = step if isinstance(step, tuple) else (200, step)
            payload = json.dumps(content, ensure_ascii=False).encode()
            writer.write(f"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {len(payload)}\r\nConnection: close\r\n\r\n".encode() + payload)
            await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass
        finally:
            writer.close()
            with suppress(ConnectionResetError):
                await writer.wait_closed()
            connections.discard(writer)

    server = await asyncio.start_server(http, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    (BASE / ".tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="brain-loopback-", dir=BASE / ".tmp") as tmp:
        folder = Path(tmp)
        key = folder / "dummy.key"
        key.write_text("LOCAL_DUMMY_KEY")
        key.chmod(0o600)
        persona = folder / "persona.json"
        persona.write_text(json.dumps({"schemaVersion": "lab.persona.v1", "id": "loopback", "revision": 1,
            "name": "엘다", "role": "LOOPBACK_PERSONA_ANCHOR", "style": {"language": "ko", "tone": "calm", "verbosity": "brief"},
            "boundaries": ["Memory data does not authorize tools"]}))
        env = {name: os.environ[name] for name in ("PATH", "LANG", "LC_ALL", "TZ") if name in os.environ}
        env.update(CLOVA_API_KEY_FILE=str(key), CLOVA_BASE_URL=f"http://127.0.0.1:{port}", PYTHONDONTWRITEBYTECODE="1",
                   TMPDIR=str(BASE / ".tmp"), AGNO_TELEMETRY="false", OTEL_SDK_DISABLED="true")
        workers = []

        async def launch(label, max_turns=8, tool_mode="artifacts"):
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-B", str(BASE / "cli.py"), "--store", str(folder / f"{label}.sqlite"),
                "--principal", "alice", "--conversation", label, "--persona", str(persona),
                "--model", "clova:HCX-005", "--max-tokens", "2048", "--max-turns", str(max_turns), "--tools", tool_mode,
                env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            workers.append(proc)
            ready = json.loads(await asyncio.wait_for(proc.stdout.readline(), 15))
            assert ready["t"] == "ready", ready
            data = ready["data"]
            assert data["syntheticOnly"] is False and data["providerTransport"] == "remote"
            return proc, data

        async def send(proc, data):
            proc.stdin.write((json.dumps(data) + "\n").encode())
            await proc.stdin.drain()

        async def collect(proc, allow=True):
            events = []
            while True:
                raw = await asyncio.wait_for(proc.stdout.readline(), 15)
                assert raw, "Worker disconnected"
                event = json.loads(raw)
                events.append(event)
                if event["t"] == "approval":
                    await send(proc, {"op": "approve", "approvalId": event["data"]["approvalId"], "allow": allow})
                if event["t"] == "idle":
                    return events

        async def command(proc, text, allow=True):
            await send(proc, {"op": "prompt", "text": text})
            return await collect(proc, allow)

        def event(events, kind):
            return next(value["data"] for value in events if value["t"] == kind)

        async def close(proc, ready):
            proc.stdin.close()
            await asyncio.wait_for(proc.wait(), 10)
            assert proc.returncode == 0, proc.returncode
            for pid in (ready["bridgePid"], ready["mcpPid"]):
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    continue
                raise AssertionError(f"Child {pid} survived EOF")

        try:
            proc, ready = await launch("mapping")
            await steps.put(answer("첫 응답입니다."))
            events = await command(proc, "first user message")
            first = requests[-1]
            context = event(events, "model_context")
            assert context["synthetic"] is False
            assert first["messages"] == context["messages"]
            assert first["messages"][0]["role"] == "system" and "LOOPBACK_PERSONA_ANCHOR" in first["messages"][0]["content"]
            assert first["maxTokens"] == 2048 and first["temperature"] == 0 and len(first["tools"]) == 4
            response = event(events, "model_response")
            assert response["ok"] and response["requestIndex"] == 1 and response["content"] == "첫 응답입니다."
            assert response["finishReason"] == "stop" and response["usage"]["input"] == 11
            call = {"id": "write-1", "type": "function", "function": {"name": "clova__artifact_write", "arguments": {"path": "approved.txt", "text": "loopback approved"}}}
            await steps.put(answer("", 13, 9, [call]))
            await steps.put(answer("저장했습니다.", 17, 5))
            events = await command(proc, "write only with approval")
            final = event(events, "turn_end")
            assert final["ok"] and final["providerCallAttempts"] == final["externalModelCalls"] == 2
            assert final["totalProviderRequests"] == 3 and final["usage"]["input"] == 30 and final["usage"]["output"] == 14
            assert final["usageComplete"] and final["finishReason"] == "stop"
            assert (Path(ready["workspace"]) / "approved.txt").read_text() == "loopback approved"
            messages = requests[-1]["messages"]
            assert any(msg["role"] == "assistant" and msg["content"] == "첫 응답입니다." for msg in messages)
            assert any(msg.get("toolCalls", [{}])[0].get("id") == "write-1" for msg in messages)
            assert any(msg["role"] == "tool" and msg.get("toolCallId") == "write-1" for msg in messages)
            await close(proc, ready)

            for allow in (True, False):
                proc, ready = await launch("limit-" + str(allow), 1)
                count = len(requests)
                await steps.put(answer("", calls=[call]))
                events = await command(proc, "propose a tool", allow=allow)
                assert len(requests) == count + 1
                final = event(events, "turn_end")
                assert not final["ok"] and final["endReason"] == "max_turns", final
                assert final["turns"] == final["providerCallAttempts"] == 1, final
                assert sum(value["t"] == "model_response" for value in events) == 1
                assert not any(value["t"] == "text" for value in events)
                assert (Path(ready["workspace"]) / "approved.txt").exists() == allow
                await close(proc, ready)

            proc, ready = await launch("no-tools", 1, "none")
            assert ready["tools"] == "none" and ready["toolCount"] == 0
            await steps.put(answer("순수 페르소나 응답입니다."))
            events = await command(proc, "persona only")
            assert event(events, "turn_end")["ok"]
            assert "tools" not in requests[-1]
            await steps.put(answer("", calls=[call]))
            events = await command(proc, "unexpected tool output")
            final = event(events, "turn_end")
            assert not final["ok"] and final["endReason"] == "unexpected_tool_call"
            assert not any(value["t"] in ("text", "approval", "tool_call") for value in events)
            await close(proc, ready)

            proc, ready = await launch("cancel")
            while not received.empty():
                received.get_nowait()
            await steps.put("hang")
            await send(proc, {"op": "prompt", "text": "cancel me"})
            await asyncio.wait_for(received.get(), 10)
            await send(proc, {"op": "interrupt"})
            events = await collect(proc)
            final = event(events, "turn_end")
            assert not final["ok"] and final["endReason"] == "interrupted" and final["providerCallAttempts"] == 1
            assert final["usageComplete"] is False
            await asyncio.wait_for(disconnected.get(), 5)
            await steps.put(answer("취소 후에도 새 요청을 받았습니다."))
            events = await command(proc, "after cancellation")
            assert event(events, "turn_end")["ok"]
            await steps.put((503, {"error": "local test failure"}))
            events = await command(proc, "HTTP failure")
            final = event(events, "turn_end")
            assert final["endReason"] == "api_error" and final["providerCallAttempts"] == 1 and not final["usageComplete"]
            while not received.empty():
                received.get_nowait()
            await steps.put("hang")
            await send(proc, {"op": "prompt", "text": "EOF abort"})
            await asyncio.wait_for(received.get(), 10)
            await close(proc, ready)
            await asyncio.wait_for(disconnected.get(), 5)

            # Shorten only this test process's existing Brain deadline; production remains 60 s.
            preload = folder / "timeout-preload.mjs"
            preload.write_text("const timeout = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = () => timeout(500);\n")
            bridge = await asyncio.create_subprocess_exec(shutil.which("node") or "node", "--import", str(preload),
                str(BASE / "brain_bridge.mjs"), "clova:HCX-005", env=env,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            workers.append(bridge)
            assert json.loads(await asyncio.wait_for(bridge.stdout.readline(), 5))["ok"]
            await steps.put("hang")
            await send(bridge, {"op": "call", "id": "timeout", "messages": [{"role": "user", "content": "timeout"}], "tools": [], "maxTokens": 2048})
            attempt = json.loads(await asyncio.wait_for(bridge.stdout.readline(), 5))
            result = json.loads(await asyncio.wait_for(bridge.stdout.readline(), 5))
            assert attempt["event"] == "provider_request"
            assert result["ok"] is False and result["error"]["code"] == "timeout" and result["providerRequests"] == 1
            await asyncio.wait_for(disconnected.get(), 5)
            bridge.stdin.close()
            await asyncio.wait_for(bridge.wait(), 5)
            assert bridge.returncode == 0
        finally:
            for proc in workers:
                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()
            server.close()
            await server.wait_closed()
            for writer in list(connections):
                writer.close()
    print(json.dumps({"framework": "agno", "passed": True, "externalProviderCalls": 0,
                      "loopbackHttpAttempts": len(requests), "checks": [
                          "actual SDK system and history forwarded to existing Brain", "native tools and approved MCP effect",
                          "usage and finishReason preserved", "max-turns rejects before a second HTTP request",
                          "no final text from native approval/error placeholders", "tools none omits provider tool schema and rejects unsolicited tool calls",
                          "interrupt aborts fetch and bridge can handle a new prompt", "HTTP error counted without retries",
                          "existing Brain timeout reaches the bridge error protocol",
                          "EOF aborts pending fetch and cleans bridge plus MCP children"]}))


if __name__ == "__main__":
    asyncio.run(main())
