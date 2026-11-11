"""Actual CLI regression: forget removes values, but evidence IDs stay immutable."""
import asyncio
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

BASE = Path(__file__).resolve().parent


async def main():
    with tempfile.TemporaryDirectory(prefix="evidence-smoke-", dir=BASE / ".tmp") as temp:
        root = Path(temp)
        persona = root / "persona.json"
        persona.write_text(json.dumps({"schemaVersion": "lab.persona.v1", "id": "guide", "revision": 1,
                                       "name": "엘다", "role": "GUIDE_ANCHOR", "style": {"language": "ko", "tone": "calm", "verbosity": "brief"},
                                       "boundaries": ["Do not invent confirmed facts"]}))
        script = root / "script.json"
        script.write_text(json.dumps([{"message": {"role": "assistant", "content": "No remembered fact."}, "finishReason": "stop"}]))
        store = root / "memory.sqlite"

        async def launch():
            process = await asyncio.create_subprocess_exec(
                sys.executable, "-B", str(BASE / "cli.py"), "--store", str(store),
                "--principal", "alice", "--conversation", "c1", "--persona", str(persona),
                "--script", str(script), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            ready = json.loads(await asyncio.wait_for(process.stdout.readline(), 15))
            assert ready["t"] == "ready", ready
            return process

        async def command(process, data):
            process.stdin.write((json.dumps(data) + "\n").encode())
            events = []
            while True:
                raw = await asyncio.wait_for(process.stdout.readline(), 15)
                assert raw, (await process.stderr.read()).decode()
                event = json.loads(raw)
                events.append(event)
                if event["t"] == "approval":
                    process.stdin.write((json.dumps({"op": "approve", "approvalId": event["data"]["approvalId"], "allow": True}) + "\n").encode())
                if event["t"] == "idle":
                    return events

        async def close(process):
            process.stdin.close()
            await asyncio.wait_for(process.wait(), 10)
            assert process.returncode == 0, (await process.stderr.read()).decode()

        process = await launch()
        try:
            evidence_text = "RAW_TRANSCRIPT_MUST_NOT_PERSIST"
            await command(process, {"op": "observe", "turnId": "immutable-id", "text": evidence_text})
            events = await command(process, {"op": "remember", "memory": {
                "kind": "fact", "slot": "budget", "thing": "shop", "value": "FORGET_NATIVE_01",
                "polarity": "positive", "evidence_turn_id": "immutable-id", "observed_at": "2026-11-10T00:00:00Z"}})
            assert any(e["t"] == "memory_result" and e["data"]["ok"] for e in events)
            await command(process, {"op": "forget", "slot": "budget"})
        finally:
            await close(process)

        with sqlite3.connect(store) as connection:
            retained = str(connection.execute("SELECT memory FROM agno_lab_memories").fetchall())
        assert "FORGET_NATIVE_01" not in retained
        assert evidence_text not in retained
        assert "lab.evidence.v1" in retained

        process = await launch()
        try:
            events = await command(process, {"op": "observe", "turnId": "immutable-id", "text": "changed evidence"})
            assert any(e["t"] == "error" and e["data"]["code"] == "evidence_conflict" for e in events)
            events = await command(process, {"op": "recall"})
            assert next(e for e in events if e["t"] == "memories")["data"]["items"] == []
            events = await command(process, {"op": "prompt", "text": "What is recalled?"})
            contexts = [e["data"]["messages"] for e in events if e["t"] == "model_context"]
            assert contexts and "FORGET_NATIVE_01" not in json.dumps(contexts)
            assert "lab.evidence.v1" not in json.dumps(contexts)
        finally:
            await close(process)
        print(json.dumps({"framework": "agno", "version": "3.1.12", "passed": True,
                          "checks": ["approved native memory CRUD", "forget removes active values and revisions",
                                     "digest ledger has no transcript or tuple value", "conflicting evidence rejected after restart",
                                     "ledger excluded from recall and actual model context"]}))


if __name__ == "__main__":
    asyncio.run(main())
