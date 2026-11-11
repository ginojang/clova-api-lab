# PydanticAI prototype — actual implementation and verification

Date: 2026-11-10. Scope: `runtime/harness-lab/pydantic/` only.

This is a real PydanticAI **2.66.0** `Agent` using `FunctionModel` and the SDK's native deferred tool approval. It is an experimental JSONL worker for mode ② comparisons. It is **not registered in Elda-CLI, deployed to the web, or connected to CLOVA or any paid model API**.

## Reproduce

From the project root, install only into the local environment:

```bash
bash runtime/harness-lab/pydantic/setup.sh
```

`requirements.txt` pins the selected SDK; `requirements.lock` pins every installed Python dependency. `setup.sh` installs the lock into `.venv.local`, with temporary and pip cache directories inside this folder. Python 3.12.3 and Node 24.15.0 were used. No global pip installation occurred.

Start the worker with a nonempty Brain Answer fixture inside this project:

```bash
runtime/harness-lab/pydantic/.venv.local/bin/python -B \
  runtime/harness-lab/pydantic/cli.py \
  --workspace /absolute/path/inside/clova-api-lab/workspace \
  --script /absolute/path/inside/clova-api-lab/answers.json \
  --max-turns 4 --timeout-ms 120000
```

Send the JSONL operations in [CONTRACT.md](../CONTRACT.md). For each `approval` event send its exact `approvalId` and a boolean `allow`. The worker never automatically approves. All four artifact tools require approval, including reads and listing.

Run the targeted post-effect cancellation regression:

```bash
runtime/harness-lab/pydantic/.venv.local/bin/python -B \
  runtime/harness-lab/pydantic/smoke.py
```

Run the common comparison suite, owned by the root integration task:

```bash
node runtime/harness-lab/run.mjs --frameworks pydantic \
  --output runtime/harness-lab/results/pydantic.json
```

## What is native and what is adapter code

- Native: `Agent` executes the model/tool loop; `FunctionModel` supplies deterministic responses; `Tool.requires_approval` blocks unapproved execution; `DeferredToolRequests`/`DeferredToolResults` pause and resume native agent execution; `RunUsage`/`UsageLimits` enforce the model request limit across approval resumes.
- Adapter: JSONL input/output, pending approval IDs, boolean and stale-ID checks, cancellation and poison policy, Brain Answer conversion, usage normalization, and stdio MCP transport.
- MCP transport is a minimal JSON-RPC client, **not PydanticAI's native MCP integration**. It initializes and discovers the actual existing `runtime/clova/mcp.ts` server, then forwards `tools/call`. No file tool was reimplemented here. Server-supplied schemas and descriptions become SDK tools with `clova__` prefixes.
- MCP's child environment is an allowlist: PATH, locale/timezone if present, the four allowed tool names, and a project-local TMPDIR. Model keys and proxy credentials are not forwarded.
- `models.ALLOW_MODEL_REQUESTS = False` is unconditional. Scripted mode does not instantiate a provider model or model gateway. No tracing exporter is configured. The SDK's startup banner is suppressed; stdout contains JSONL only.
- The system prompt comes from `runtime/clova/fixtures/comparison.json.systemPrompt`.

The outer resume loop only handles native deferred approval boundaries. It does not implement a substitute model/tool agent loop.

## Actual verification

- Initial direct smoke: native approval preceded the real MCP write, the file was absent before approval, its exact content was `first` afterwards, usage was two scripted model responses, and EOF exited with code 0.
- Root's first common run passed **12/12** scenarios: create/edit/undo/read, denial with no effect, stale/duplicate approval, two tool calls with separate approvals, interrupt and EOF while awaiting approval, path escape/tool failure, model round limit, new/reset, malformed input recovery, busy prompt rejection, and detecting text-only false completion through the shared file oracle. The final expanded suite passed **13/13**, adding delayed model cancellation. Evidence: [final common result](../results/mock.json).
- After adding the shared system prompt and conservative poison policy, `smoke.py` passed: approval-before-effect, a real completed write, interruption during the next delayed model response, `requiresRestart:true`, old MCP process terminated, both prompt and new rejected with `session_invalid`, and clean EOF exit. The completed file effect remains; cancellation is not rollback.
- These are scripted model/control-flow tests with a real SDK and real local MCP. They measure neither model quality nor real provider token usage. The root's expanded final suite is a separate execution; consult its generated result for the final count.

## Observed advantages

1. Native deferred approval makes the critical boundary explicit: an MCP function is never entered until the SDK has resolved its approval. The function also asserts `ctx.tool_call_approved` before dispatch.
2. FunctionModel can drive exact multi-turn and multi-tool responses with synthetic usage, without any real API key. The common file oracle verifies actual filesystem effects.
3. Supplying one `RunUsage` across approval resumes keeps the per-prompt limit consistent even though multiple `Agent.run` calls resume one user turn.
4. Python dependencies are isolated from the TypeScript project and existing production code.

## Limitations and comparison caveats

- Only scripted responses are implemented. No model URL, CLOVA custom Model, streaming provider transport, live usage validation, persistent checkpoint, or crash recovery is claimed.
- Startup in the initial shared run was approximately 1.35–1.45 seconds including Python/SDK import and the Node MCP startup. This is one local run, not a performance ranking.
- SDK deferred approvals are collected for a response before resuming it. For a multi-call response, effects wait until its pending decisions have all been collected; the timing differs from executing the first tool while still asking about the next.
- A denied call emits `tool_result.ok:false` and performs zero MCP calls; the model can still finish normally, so denial alone does not force `turn_end.ok:false`. An MCP `isError` does force `turn_end.ok:false` even if a later scripted response says “done”. The shared file oracle is still required for task success.
- An interrupt before any MCP dispatch leaves the worker reusable. An interrupt/timeout or exception after an MCP dispatch poisons the session, closes MCP, and reports `requiresRestart:true`. **Both prompt and new remain blocked; start a fresh worker and workspace.** Known model round-limit termination is not poisoned.
- Normal `new` resets conversation history, session ID, and script position. It keeps the same MCP server, files, and MCP undo history, matching the comparison's process-level tool state. It is not a filesystem reset.
- An already-dispatched tool can complete before cancellation arrives. This prototype cannot roll back or prove the status of an arbitrary external operation after a transport failure; poison prevents blind reuse.
- In-process history only. Interrupted partial SDK histories are not committed. The fixture response index advances when a request starts, including a request cancelled during `delayMs`.
- Interrupt may omit `turn_end`. A result collector must not interpret absent turn counters as zero model requests. An approval implies the model has already produced a tool request.
- Input is UTF-8 JSONL with a 1 MiB reader limit. The minimal MCP client is sufficient for this fixed local server; it does not implement remote transports, OAuth, sampling, reconnect, or general MCP lifecycle coverage.

The practical next step is a custom model adapter to the existing Brain followed by separately recorded live tests, after the shared scripted checks pass. The framework's document support is not evidence of completed CLOVA or Elda integration.
