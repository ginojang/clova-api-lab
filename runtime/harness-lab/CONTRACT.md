# Harness lab prototype contract

Experimental mode ② adapters, not registered Elda-CLI providers. All files, environments, caches and test workspaces stay under this repository. Root production dependencies and existing runtime behavior are not changed.

Each worker is a real framework agent loop (not a hand-written loop masquerading as a framework):

`WORKER --workspace ABS_DIR --script ABS_JSON --max-turns 4 --timeout-ms 120000`

`--script` is a nonempty array of existing Brain `Answer` objects: `{message:{role:"assistant",content:"",toolCalls:[{id,type:"function",function:{name:"clova__artifact_write",arguments:{path:"a.txt",text:"first"}}}]},finishReason:"tool_calls",usage:{input:11,output:5,cacheRead:0,cacheWrite:0}}`. Terminal answer has text, no toolCalls, finishReason stop. Consume responses globally across prompts; reset on new; exhaustion must fail explicitly. Optional `delayMs` on a scripted answer supports abort testing. Never call paid/cloud models in scripted mode.

Use the actual local `runtime/clova/mcp.ts` server via stdio with only artifact_list/read/write/undo enabled using CLOVA_MCP_ALLOWED_TOOLS. Framework tools use `clova__` names; map them to MCP names. Tool subprocess environment must not inherit model keys. Own MCP file effects only; no duplicate file tool implementations.

Input JSONL: `{op:"prompt",text:string}`, `{op:"approve",approvalId:string,allow:boolean}`, `{op:"interrupt"}`, `{op:"new"}`. One prompt at a time. Reject unknown/stale approval IDs and non-boolean decisions. EOF must deny/cancel pending approvals, await cleanup, and exit. No auto-approval.

Output stdout JSONL: `{v:1,seq:1,ts:ISO,t:string,data:object}`. Monotonic seq, diagnostics stderr only. Events:

- ready: `{framework,version,model:"scripted",tools:[names],mcpPid}`.
- turn_start: `{sessionId}`.
- tool_call: `{tool,callId,input}`.
- approval: `{tool,callId,input,approvalId}` BEFORE any MCP side effect. Approve all four tools, matching existing mode ②.
- tool_result: `{tool,callId,ok,output}`. Denial ok:false; no MCP call on denial.
- text optional: `{text}`.
- turn_end: `{ok,endReason,turns,toolCalls,usage,durationMs,sessionId}`. turns counts actual model requests; toolCalls counts actual MCP calls, not denied calls. Usage is synthetic for scripts.
- error: `{code,message}`; no secrets. interrupted/max_turns/no_such_approval/invalid_input/busy etc.
- idle: `{sessionId,requiresRestart:boolean}`; await idle before next prompt.
- notice on new/reset.

Interrupt may omit turn_end like current LangGraph, but must emit error interrupted and idle and prevent late effects. Default max 4 actual model calls per prompt, 120s deadline. State/history in process only; persistent restart is out of prototype scope. Use framework-native approvals where feasible; honestly document adapter-based policies and gaps. A tool error is not a successful side effect; preserve result for model. Tool failures/denials must not be reported as executed successful tools.

First shared scenarios: create/edit/undo/read, denial, stale and duplicate approval, multi-call response, interrupt waiting approval, EOF waiting approval, invalid path/tool error, max-model-rounds, new/reset, malformed input. Root builds comparison driver and reusable fixtures; each agent owns its framework folder/package environment and notes only.
