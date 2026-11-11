# H31 recovery follow-up: prospective protocol

Frozen before fresh preflight and live calls on 2026-11-11. Previous H31 run/confirm results and their verdicts are unchanged. This follow-up tests the corrected current runtime separately.

## Question and scope

Can each real mode-2 loop (native Elda, LangGraph, Pi) read a missing file, recover through write/read, and emit a usable final answer while retaining `toolFailed:true`? This is an execution/output check, not a new persona benchmark or an operational deployment.

One fresh workspace per harness. Same system, user prompt, four artifact tools, CLOVA `HCX-005`, temperature0, maxTokens2048, maxTurns6, tokenLimit20000, 120s outer deadline. Test operator approves each requested artifact operation. No batch tool, external service tools, memory migration, or deployment effects.

## Gates fixed before measurement

1. The runner requires a new output filename. Live requires the exact matching successful mock preflight: source hashes, native CLI hashes, three runs, wire parity, completion and artifact gates.
2. `verdict-r2.mjs` requires missing read → exact `RECOVERED` write → successful final read(s), one result per tool call, exact workspace contents, clean worker exit, and no malformed JSONL.
3. `recovery-next-verdict.mjs` additionally requires a nonempty public `text`, exactly one `turn_end` with `ok:true`, `runCompleted:true`, `toolFailed:true`, `policyRejected:false`, `endReason:completed`, no invented `taskSucceeded`, and no terminal error event.
4. Mock first and second wire requests must match native Elda. Live first wire requests must match; later real model outputs remain unconstrained and are retained in raw evidence. No rewriting responses or retroactively relaxing gates.
5. Source hashes are checked again at completion. Changes invalidate the result.

## Budget and evidence

Expected12 and maximum18 actual requests across all three harnesses, with at least6seconds between actual request starts. Max6 provider requests per worker; excess blocked before forwarding. API errors are preserved, no extra retry round is authorized by this protocol. Report known usage and missing usage separately; money cost remains unknown.

Fresh preflight, live JSON, raw execution logs and source snapshots use `h31-recovery-next-*` names. Existing credential helper privately reads the already authorized deployment key and removes the local0600 copy in `finally`; secrets are excluded from reports. All writes remain under this repository.

## Separate comparisons

Malformed argument and official kit results are local mock/real-process experiments, not paid CLOVA evidence. Official kit version0.805 differs from current SPEC0.808; warnings and unsupported surface areas must remain visible.
