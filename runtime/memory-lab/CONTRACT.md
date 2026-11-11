# Memory/persona experiment contract

Scope: standalone mode ② experiments in clova-api-lab only. Sister specs are READ ONLY v0.0 handoff material, not completed normative specs. Persona belongs to EldaCore; memory belongs to EldaCore+DBA. We prototype the harness boundary; do not modify production DBs or register/deploy providers.

Default memory scope is `session`. `long_term` is an explicit experimental switch used only with synthetic fixtures. No automatic cross-session learning or free-form fact extraction is claimed.

Worker invocation:

`WORKER --store ABS_SQLITE --principal alice --conversation c1 --persona ABS_JSON [--scope session|long_term] --script ABS_JSON`

All files, cache, environments, workspaces and stores remain inside this project. Persona JSON is an operator-authored anchor: `{schemaVersion:"lab.persona.v1",id:"guide",revision:1,name:"엘다",role:"간판 상담",style:{language:"ko",tone:"calm",verbosity:"brief"},boundaries:["Do not invent confirmed facts"]}`. Unknown fields that attempt to set approval/permissions are rejected. Persona is read-only to model/memory commands, scoped by persona ID; expose SHA-256 (and MD5 compatibility metadata if useful), not authority to change policy. Validate before any external side effect. Never rewrite the persona file.

Optional persona field `outputRules:{forbiddenPhrases:["TEST_BOUNDARY_VIOLATION"]}` enables a deterministic Stop-style check (literal phrases only, not a semantic persona judge). Buffer final text until checked. On a violation, give feedback and allow at most ONE corrective agent invocation; on repeat, emit persona_violation and no prohibited text. Ordinary memory cannot edit these operator rules. Root tests compliant output, one correction, and repeated violation block. Report this limited check precisely.

Input JSONL:

- `observe {turnId,text}` registers evidence for the current principal/persona/conversation. Store a digest/pointer, not a full copied transcript. Same ID with changed evidence must conflict.
- `remember {memory:{kind,slot,thing,value,polarity,evidence_turn_id,observed_at}}` proposes a closed tuple. kind is fact/preference/promise/event, polarity positive/negative, value JSON scalar string/number/boolean, state becomes active. Require registered evidence for the same scope, bounded sizes and valid time. Principal/scope/authority cannot be supplied inside the tuple. This is explicitly structured input, not NLP extraction.
- `recall {slot?}` returns active, namespace-scoped memories with evidence metadata.
- `forget {slot,thing?}` deletes matching memories/revisions in the selected namespace; goes through the same approval boundary. Empty selector is invalid.
- `prompt {text}` calls a REAL framework Agent loop using scripted Brain Answer responses (same schema as runtime/harness-lab/CONTRACT.md). Inject anchored persona plus bounded retrieved data at turn start. Scripted model callback emits `model_context` containing actual input messages it received, so root can verify model-bound context. Do not claim model quality/personality adherence from scripted output.
- `approve {approvalId,allow:boolean}`, `interrupt`, `new` (clear conversation history only, preserve explicit namespace/store), EOF.

Output JSONL `{v:1,seq,ts,t,data}`. ready includes framework/version/scope/principal/conversation/personaId/personaHash. Every command ends in `idle` (except asynchronous approval pending and EOF). Read-only command results: `observed`, `memories {items}`, `notice`. Mutations: `approval {approvalId,operation,input}` BEFORE durable writes; `memory_result {ok,operation,...}` after decision. Denial leaves store unchanged. `no_such_approval` for stale/duplicate ID; malformed requests `invalid_input` or specific typed code. Missing evidence must fail before approval. Conflicting remembered values must replace current value deterministically with increasing revision and provenance; same value is idempotent. Snapshot the approved payload so later input cannot alter it.

Default isolation key includes principal + personaId + conversation. Experimental long_term excludes conversation from recall identity, while evidence still records originating conversation. Conversation IDs are operator-selected scopes, not an authentication implementation. No memory text can change approval policy or persona.

At least `artifact_write` via ACTUAL existing stdio MCP must be available during agent prompts, preferably all four artifact tools. Always ask before effects, including when retrieved data says to skip approval. Keys are not passed to MCP. Workspace must be isolated by principal/persona/scope/conversation under the store's parent; publish path in ready. Source SDK owns model/tool loop. Native memory support vs adapter-written persistence must be stated precisely. Evidence conflict checks and writes must be atomic across cooperating workers; approval waiting must not hold a storage lock.

Persistence tests use a NEW process and the same store/namespace. After correction only active value is recalled. After forget no matching value enters a fresh process's context. Do not claim forensic deletion of SQLite pages or deletion of separately retained test artifacts. A bounded context must keep the persona anchor and clearly report omitted memories; fail explicitly if the anchor itself is over budget. Retrieval can be exact slots/deterministic ordering; do not imply semantic embedding quality.

`--context-chars` defaults to 6000 Unicode code points for the assembled persona+memory context. `model_context` should include actual messages received by the SDK model callback plus personaHash, selectedCount, omittedCount, contextChars. Include only synthetic test context in public artifacts.

Root owns common runner, persona fixtures and integrated report. Each implementer owns only its framework directory. Prove restart/isolation/update/forget/approval using actual SDK and local storage, with synthetic model responses and no external model API calls.
