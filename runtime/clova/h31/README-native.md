# H31 native Elda CLI bootstrap

`elda-native.py` loads a fixed JSON profile into the installed Elda CLI's genuine `LoopAdapter` and `events.run`. It does not register an agent or implement an alternate loop. Use a current CLI directory containing `providers/clova.py`, not an older `elda` executable found on PATH. Python bytecode writes are disabled, including in MCP child environments.

```bash
python3 runtime/clova/h31/elda-native.py \
  --cli-dir /home/gino/apps/elda-cli \
  --profile /absolute/path/to/profile.json \
  --workspace /absolute/path/to/existing/workspace
```

The profile has these fields only:

```json
{
  "model": "clova:HCX-005",
  "system": "Use only the supplied tools and report observed results.",
  "max_turns": 6,
  "token_limit": 20000,
  "tools": {},
  "servers": [{
    "name": "clova",
    "command": ["/absolute/path/to/node", "/absolute/path/to/clova-api-lab/runtime/clova/mcp.ts", "mcp", "--workspace", "/absolute/path/to/existing/workspace"],
    "instructions": false
  }]
}
```

The example is a profile shape, not the final common H31 system prompt. The comparison coordinator supplies exactly the same system text to all three harnesses. Native Elda strips the joined system; this bootstrap rejects leading/trailing whitespace so the provided string survives unchanged. `instructions:false` prevents appending MCP initialization instructions. One explicitly configured MCP server is used; the `ops()` profile is never loaded, so no Comms or Notion servers are attached. Tool policy entries may only be `ask`, and explicit `--approve ask` is passed through the genuine loop gate so read-only tools also ask. Do not add explicit `allow` rules: they have higher precedence in Elda's runtime policy.

Environment used by native CLOVA:

| Variable | Contract |
| --- | --- |
| `CLOVA_API_KEY_FILE` | Raw key file path, mode0600. The bootstrap never reads it itself; genuine native provider authentication does. For live work the parent must supply the already authorized credential privately. |
| `CLOVA_BASE_URL` | Official HTTPS endpoint or loopback HTTP mock/recording proxy. Native requests use `/v3/chat-completions/HCX-005` or `/HCX-007`. |
| `ELDA_CLOVA_MAX_TOKENS` | Set explicitly to2048 for the common profile. The native provider supports1..2048, but tools require at least1024; this bootstrap enforces1024..2048. |
| `ELDA_EFFORT` | Unset for005. For007 tool comparison, unset/empty/none means native thinking none; other values are rejected. |
| `ELDA_HISTORY` | Optional1 adds history to turn_end; it does not change the model request. |
| `ELDA_APPROVAL_WAIT` / `ELDA_WAIT_HEARTBEAT` | Native approval timeout/heartbeat, defaults1800/60 seconds. Set by the parent if testing timing. |
| `ELDA_EVENTS_EOF_WAIT` | Native completion wait when stdin closes; the parent should keep stdin open through idle and enforce its own process deadline. |

Model generation is fixed temperature0. HCX005 sends `maxTokens`; HCX007 sends `maxCompletionTokens` and `thinking:{effort:"none"}`. There is no topP or seed field in this native provider. `max_turns` and `token_limit` are explicit positive integers in the profile and take precedence over ambient environment defaults.

stdin accepts the genuine `{"op":"prompt","text":"..."}` and `{"op":"approve","approvalId":"...","allow":true}` messages. stdout is unchanged Elda JSONL; do not infer taskSucceeded from ok. `--validate-only` checks the profile and emits source hashes without importing the CLI, reading credentials, starting MCP, or calling a model.

Wire comparison limits: Elda retains raw MCP tool names (only duplicate names get a server prefix); it trims tool descriptions and passes schemas unchanged. It sends MCP text content as model tool result text. Graph/Pi must use matching raw names and system settings; differences in later tool result rendering must be recorded, not hidden by claiming byte-identical conversation history. Elda's native H20/empty-response retries remain active; count actual proxy requests against the shared hard cap.
