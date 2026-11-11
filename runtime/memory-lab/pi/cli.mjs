#!/usr/bin/env node
import { Agent } from '../../harness-lab/pi/node_modules/@earendil-works/pi-agent-core/dist/index.js';
import { AssistantMessageEventStream, createInitialSystemMessage } from '../../harness-lab/pi/node_modules/@earendil-works/pi-ai/dist/index.js';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { Mcp } from '../../clova/client.ts';
import { Fault, inside, usageZero, redact } from '../../clova/common.ts';
import { Brain, normalizeToolCalls } from '../../clova/provider.ts';
import { LabError, MemoryStore, loadPersona, buildContext, bounded, identifier, keys, object, digest } from './store.mjs';
import { brainRequest, transportForModel } from './provider-bridge.mjs';
import { compileContext, runtimeCapabilities } from '../policy/compiler.mjs';
import { inspectResponse, buildRepairPrompt } from '../policy/guard.mjs';
import { compileContextV2 } from '../policy/compiler-v2.mjs';
import { inspectResponseV2, buildRepairPromptV2 } from '../policy/guard-v2.mjs';
import { voiceRequest } from '../policy/voice.mjs';
import { addDemonstrations, compileDemonstratedContext } from '../policy/demonstrated.mjs';
import { composedContract, decodeComposedReply } from '../policy/composed.mjs';
import { enactedContract, decodeEnactedReply } from '../policy/enacted.mjs';
import { taskContract } from '../policy/focused.mjs';
import { responseContract, decodeStructuredReply, compileStructuredContext } from '../policy/structured.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const version = JSON.parse(readFileSync(resolve(folder, '../../harness-lab/pi/node_modules/@earendil-works/pi-agent-core/package.json'), 'utf8')).version;
if (version !== '1.5.1') throw new Error('This experiment requires pinned Pi agent-core 1.5.1');
let seq = 0;
const emit = (t, data = {}) => process.stdout.write(JSON.stringify({ v: 1, seq: ++seq, ts: new Date().toISOString(), t, data }) + '\n');
const textContent = content => typeof content === 'string' ? content : (content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
function localPath(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new LabError('configuration', `${label} must be an absolute project-local path`);
  const rel = relative(root, resolve(path));
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new LabError('configuration', `${label} must stay inside clova-api-lab`);
  return inside(root, rel);
}
function configure() {
  const names = ['--store', '--principal', '--conversation', '--persona', '--scope', '--script', '--model', '--tools', '--max-tokens', '--context-chars', '--max-turns', '--timeout-ms', '--policy', '--min-call-interval-ms'];
  const options = new Map();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new LabError('configuration', 'Invalid or duplicate command-line option');
    options.set(args[i], args[i + 1]);
  }
  const storePath = localPath(options.get('--store'), 'store');
  const personaPath = localPath(options.get('--persona'), 'persona');
  if (options.has('--script') === options.has('--model')) throw new LabError('configuration', 'Specify exactly one of --script or --model');
  const scriptPath = options.has('--script') ? localPath(options.get('--script'), 'script') : undefined;
  const modelName = options.get('--model') ?? 'scripted';
  if (!scriptPath && !/^(clova|groq|openrouter|zai):\S+$/.test(modelName)) throw new LabError('configuration', 'Use clova:<model> or an existing approved Brain provider model');
  const toolMode = options.get('--tools') ?? 'artifacts';
  if (!['none', 'artifacts'].includes(toolMode)) throw new LabError('configuration', 'tools must be none or artifacts');
  const principal = identifier(options.get('--principal'), 'principal');
  const conversation = identifier(options.get('--conversation'), 'conversation');
  const scope = options.get('--scope') ?? 'session';
  if (!['session', 'long_term'].includes(scope)) throw new LabError('configuration', 'scope must be session or long_term');
  const contextBudget = Number(options.get('--context-chars') ?? 6000);
  const maxTurns = Number(options.get('--max-turns') ?? 4);
  const timeoutMs = Number(options.get('--timeout-ms') ?? 120000);
  const maxTokens = Number(options.get('--max-tokens') ?? 2048);
  const policy = options.get('--policy') ?? 'baseline';
  const minCallIntervalMs = Number(options.get('--min-call-interval-ms') ?? 0);
  if (!['baseline', 'compiled', 'guarded', 'compiled-v2', 'guarded-v2', 'voiced-v3', 'structured-v5', 'structured-v6', 'structured-v7', 'composed-v8', 'enacted-v9'].includes(policy) || !Number.isInteger(minCallIntervalMs) || minCallIntervalMs < 0 || minCallIntervalMs > 60000) throw new LabError('configuration', 'Invalid policy or call interval');
  const capabilities = runtimeCapabilities(toolMode);
  const voiced = policy === 'voiced-v3';
  const composed = ['composed-v8', 'enacted-v9'].includes(policy);
  const structured = ['structured-v5', 'structured-v6', 'structured-v7'].includes(policy) || composed;
  const demonstrated = policy === 'structured-v7';
  const contract = policy === 'enacted-v9' ? enactedContract : composed ? composedContract : structured && policy !== 'structured-v5' ? taskContract : responseContract;
  const decode = policy === 'enacted-v9' ? decodeEnactedReply : composed ? decodeComposedReply : decodeStructuredReply;
  if (structured && (toolMode !== 'none' || (!scriptPath && modelName !== 'clova:HCX-007'))) throw new LabError('configuration', 'Structured policies require HCX-007 with tools none');
  const guarded = policy.startsWith('guarded') || voiced;
  const compile = demonstrated ? compileDemonstratedContext : structured ? compileStructuredContext : (policy.endsWith('-v2') || voiced) ? compileContextV2 : compileContext;
  const inspectPolicy = (policy.endsWith('-v2') || voiced || structured) ? inspectResponseV2 : inspectResponse;
  const repairPrompt = (policy.endsWith('-v2') || voiced) ? buildRepairPromptV2 : buildRepairPrompt;
  if (!Number.isInteger(contextBudget) || contextBudget < 64 || contextBudget > 100000 || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new LabError('configuration', 'Invalid context/turn/time limit');
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048 || (modelName.startsWith('clova:') && toolMode === 'artifacts' && maxTokens < 1024)) throw new LabError('configuration', 'max-tokens must be 1..2048; CLOVA with artifact tools requires at least 1024');
  const { persona, personaHash } = loadPersona(personaPath);
  // Validate the immutable anchor before creating databases, directories or MCP processes.
  if (policy === 'baseline') buildContext(persona, personaHash, [], contextBudget);
  else compile(persona, personaHash, [], contextBudget, capabilities);
  const script = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : undefined;
  if (scriptPath && (!Array.isArray(script) || !script.length)) throw new LabError('configuration', 'script must be a nonempty Answer array');
  for (const answer of script ?? []) {
    if (answer?.message?.role !== 'assistant' || typeof answer.message.content !== 'string' || !['stop', 'length', 'tool_calls'].includes(answer.finishReason)) throw new LabError('configuration', 'Invalid scripted Answer');
    if (answer.message.toolCalls !== undefined) answer.message.toolCalls = normalizeToolCalls(answer.message.toolCalls);
    if (answer.finishReason === 'tool_calls' && !answer.message.toolCalls?.length) throw new LabError('configuration', 'Empty tool_calls response');
    if (answer.delayMs !== undefined && (!Number.isInteger(answer.delayMs) || answer.delayMs < 0)) throw new LabError('configuration', 'Invalid script delay');
    for (const value of Object.values(answer.usage ?? {})) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new LabError('configuration', 'Invalid synthetic usage');
  }
  const workspace = resolve(dirname(storePath), 'workspaces', digest(JSON.stringify([principal, persona.id, scope, conversation])).slice(0, 20));
  localPath(workspace, 'workspace');
  return { policy, decode, composed, demonstrated, contract, structured, voiced, guarded, compile, inspectPolicy, repairPrompt, minCallIntervalMs, capabilities, storePath, personaPath, persona, personaHash, principal, conversation, scope, script, modelName, toolMode, providerTransport: transportForModel(modelName), maxTokens, contextBudget, maxTurns, timeoutMs, workspace };
}
function piMessage(answer, modelName = 'scripted') {
  const usage = { ...usageZero(), ...answer.usage };
  return {
    role: 'assistant', api: 'openai-completions', provider: modelName === 'scripted' ? 'memory-lab' : 'elda-brain', model: modelName,
    content: [...(answer.message.content ? [{ type: 'text', text: answer.message.content }] : []), ...(answer.message.toolCalls ?? []).map(call => ({ type: 'toolCall', id: call.id, name: call.function.name, arguments: call.function.arguments }))],
    usage: { ...usage, totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    ...(answer.message.providerReasoning ? { providerReasoning: structuredClone(answer.message.providerReasoning) } : {}),
    stopReason: answer.finishReason === 'tool_calls' ? 'toolUse' : answer.finishReason,
    timestamp: Date.now(),
  };
}

async function main() {
  const config = configure();
  // Validate credentials/provider configuration before DB or MCP side effects.
  const brain = config.script ? undefined : new Brain(config.modelName);
  const namespace = { principal: config.principal, personaId: config.persona.id, conversation: config.conversation, scope: config.scope };
  const store = new MemoryStore(config.storePath, namespace);
  let mcp;
  let mcpClosing;
  let active;
  let task;
  let agent;
  let pending;
  let closing = false;
  let poisoned = false;
  let scriptIndex = 0;
  let modelRequestIndex = 0;
  let lastModelStarted = 0;
  let history = [];
  // `idle` is a completion boundary, never a status update during an active
  // operation. Invalid/stale approvals must not look like a completed commit.
  const idle = () => {
    if (active || pending) return;
    emit('idle', { ...namespace, busy: false, requiresRestart: poisoned });
  };
  const errorEvent = error => emit('error', { code: error instanceof LabError ? error.code : 'engine', message: error instanceof LabError ? error.message : 'Memory experiment operation failed' });
  const closeMcp = () => mcpClosing ??= mcp?.close() ?? Promise.resolve();
  function approve(operation, input, signal, extra = {}) {
    if (pending) throw new LabError('busy', 'Another approval is pending');
    if (closing || signal?.aborted) return Promise.resolve(false);
    const approvalId = randomUUID();
    const snapshot = structuredClone(input);
    return new Promise(resolveApproval => {
      const settle = allow => {
        if (pending?.approvalId !== approvalId) return;
        pending = undefined;
        signal?.removeEventListener('abort', abort);
        resolveApproval(allow);
      };
      const abort = () => settle(false);
      pending = { approvalId, settle };
      signal?.addEventListener('abort', abort, { once: true });
      emit('approval', { approvalId, operation, input: snapshot, ...extra });
      if (closing || signal?.aborted) settle(false);
    });
  }
  function interrupt() {
    if (active) {
      active.cancelled = true;
      active.failure ??= new LabError('interrupted', 'Operation interrupted');
      if (active.inFlight) { poisoned = true; void closeMcp(); }
      agent?.abort();
    }
    pending?.settle(false);
  }
  async function mutate(operation, approvedInput, perform) {
    const state = { kind: 'memory', cancelled: false };
    active = state;
    try {
      const allow = await approve(operation, approvedInput);
      if (!allow || state.cancelled || closing) {
        emit('memory_result', { ok: false, operation, reason: state.cancelled ? 'interrupted' : 'denied' });
        if (state.failure) errorEvent(state.failure);
        return;
      }
      const result = perform();
      // Avoid retaining recalled/superseded content in a previous model transcript.
      if (operation === 'forget' || !result.idempotent) history = [];
      emit('memory_result', { ok: true, operation, ...result });
    } catch (error) { errorEvent(error); emit('memory_result', { ok: false, operation }); }
    finally { active = undefined; idle(); }
  }
  try {
    mkdirSync(config.workspace, { recursive: true, mode: 0o700 });
    const allowed = ['artifact_list', 'artifact_read', 'artifact_write', 'artifact_undo'];
    mcp = new Mcp([process.execPath, resolve(root, 'runtime/clova/mcp.ts'), 'mcp', '--workspace', config.workspace], root, { CLOVA_MCP_ALLOWED_TOOLS: allowed.join(',') });
    const init = await mcp.initialize();
    if (init.tools.length !== 4 || init.tools.some(tool => !allowed.includes(tool.name))) throw new LabError('configuration', 'MCP tool list differs from the four artifact tools');
    const tools = (config.toolMode === 'none' ? [] : init.tools).map(def => ({
      name: `clova__${def.name}`, label: def.name, description: def.description, parameters: def.inputSchema,
      async execute(callId, input, signal) {
        signal?.throwIfAborted();
        const state = active;
        if (!state || state.kind !== 'prompt' || state.cancelled || closing || poisoned) throw new LabError('interrupted', 'Tool cannot execute outside an active approved prompt');
        state.toolCalls++; state.inFlight++;
        try {
          const output = await mcp.request('tools/call', { name: def.name, arguments: input }, signal);
          signal?.throwIfAborted();
          return { content: [{ type: 'text', text: JSON.stringify(output) }], details: { output }, isError: output.isError === true };
        } catch (error) {
          poisoned = true;
          state.failure ??= new LabError(signal?.aborted ? 'interrupted' : 'mcp_error', 'MCP effect is uncertain; restart worker before another prompt');
          agent.abort(); await closeMcp(); throw error;
        } finally { state.inFlight--; }
      },
    }));
    const model = { id: config.modelName, name: config.modelName, api: 'openai-completions', provider: config.script ? 'memory-lab' : 'elda-brain', baseUrl: 'http://127.0.0.1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: config.maxTokens };
    async function prompt(text) {
      const memories = store.recall();
      const assembled = config.policy === 'baseline' ? buildContext(config.persona, config.personaHash, memories, config.contextBudget) : config.compile(config.persona, config.personaHash, memories, config.contextBudget, config.capabilities);
      const state = { kind: 'prompt', cancelled: false, correctionModelCalls: 0, turns: 0, toolCalls: 0, inFlight: 0, providerCallAttempts: 0, externalModelCalls: 0, modelResponses: 0, usageComplete: true, finishReason: undefined, usage: usageZero(), failure: undefined, finalText: '', phase: 'initial', started: Date.now() };
      active = state;
      emit('turn_start', { ...namespace, personaHash: config.personaHash, model: config.modelName, synthetic: Boolean(config.script), providerTransport: config.providerTransport });
      agent = new Agent({
        initialState: { systemPrompt: assembled.text, model, tools, messages: history, thinkingLevel: 'off' },
        toolExecution: 'sequential',
        streamFn(_model, context, options) {
          const stream = new AssistantMessageEventStream();
          void (async () => {
            try {
              options.signal?.throwIfAborted();
              if (state.turns >= config.maxTurns) throw new LabError('max_turns', 'Maximum model requests reached');
              let answer;
              if (config.script) {
                answer = config.script[scriptIndex++];
                if (!answer) throw new LabError('script_exhausted', 'Scripted response array exhausted');
              }
              let request = brainRequest(context.messages);
              if (config.demonstrated) request = addDemonstrations(request, config.persona, config.capabilities);
              const waitMs = Math.max(0, lastModelStarted + config.minCallIntervalMs - Date.now());
              if (waitMs) await delay(waitMs, undefined, { signal: options.signal });
              options.signal?.throwIfAborted();
              lastModelStarted = Date.now();
              state.turns++;
              if (state.phase !== 'initial') state.correctionModelCalls++;
              const requestIndex = ++modelRequestIndex;
              emit('model_context', { providerMessages: structuredClone(request.messages), demonstrationCount: request.demonstrationCount ?? 0, demonstrationChars: request.demonstrationChars ?? 0, policy: config.policy, responseFormat: config.structured ? config.contract(config.persona, config.capabilities, text) : null, actualSystemChars: [...request.systemPrompt].length, contextAccounting: state.phase === 'voice' ? 'selection statistics describe initial compiled context; writer system is separate and selected memories are quoted in its user input' : 'initial compiled system and memory; conversation excluded from character budget', callStartedAt: new Date(lastModelStarted).toISOString(), messages: structuredClone(context.messages), systemPrompt: request.systemPrompt, toolNames: request.tools.map(tool => tool.name), personaHash: config.personaHash, selectedCount: assembled.selectedCount, omittedCount: assembled.omittedCount, contextChars: assembled.contextChars, contextBudget: assembled.contextBudget, unit: assembled.unit, phase: state.phase, synthetic: Boolean(config.script), model: config.modelName, requestIndex, providerTransport: config.providerTransport });
              if (config.script) {
                if (answer.delayMs) await delay(answer.delayMs, undefined, { signal: options.signal });
              } else {
                state.providerCallAttempts++;
                if (config.providerTransport === 'remote') state.externalModelCalls++;
                try {
                  answer = await brain.call(request.messages, request.tools, options.signal, { maxTokens: config.maxTokens, ...(config.structured ? { responseFormat: config.contract(config.persona, config.capabilities, text) } : {}) });
                  state.modelResponses++;
                } catch (error) {
                  if (error instanceof Fault && error.usage) {
                    for (const key of Object.keys(state.usage)) state.usage[key] += error.usage[key] ?? 0;
                  } else state.usageComplete = false;
                  emit('model_response', { model: config.modelName, requestIndex, phase: state.phase, synthetic: false, providerTransport: config.providerTransport, ok: false, finishReason: null, usage: error instanceof Fault ? error.usage ?? null : null, error: error instanceof Fault ? error.code : 'model_error' });
                  throw error;
                }
                state.finishReason = answer.finishReason;
                emit('model_response', { model: config.modelName, requestIndex, phase: state.phase, synthetic: false, providerTransport: config.providerTransport, ok: true, content: answer.message.content, toolCalls: answer.message.toolCalls ?? [], finishReason: answer.finishReason, usage: answer.usage });
              }
              for (const key of Object.keys(state.usage)) state.usage[key] += answer.usage?.[key] ?? 0;
              options.signal?.throwIfAborted();
              state.finishReason = answer.finishReason;
              const message = piMessage(structuredClone(answer), config.modelName);
              if (answer.finishReason === 'length') throw new LabError('truncated', 'Model response was truncated');
              stream.push({ type: 'done', reason: message.stopReason, message });
            } catch (error) {
              state.failure ??= options.signal?.aborted ? new LabError('interrupted', 'Prompt interrupted') : error instanceof LabError ? error : error instanceof Fault ? new LabError(error.code, redact(error.message)) : new LabError('model_error', 'Model provider failed');
              const message = piMessage({ message: { content: '' }, finishReason: options.signal?.aborted ? 'aborted' : 'error', usage: usageZero() }, config.modelName);
              message.errorMessage = state.failure.message;
              stream.push({ type: 'error', reason: message.stopReason, error: message });
            }
          })();
          return stream;
        },
        async beforeToolCall({ toolCall, args }, signal) {
          const allow = await approve(toolCall.name, args, signal, { tool: toolCall.name, callId: toolCall.id });
          if (signal?.aborted || state.cancelled || closing) return { block: true, reason: 'Operation interrupted', terminate: true };
          if (!allow) state.failure ??= new LabError('denied', 'Tool execution was denied');
          return allow ? undefined : { block: true, reason: 'denied: explicit user approval was not granted' };
        },
        finishTurn({ message, toolResults }, signal) {
          if (signal?.aborted) return { action: 'end' };
          if (state.turns >= config.maxTurns && toolResults.length && !['error', 'aborted'].includes(message.stopReason)) { state.failure ??= new LabError('max_turns', 'Maximum model requests reached'); return { action: 'end' }; }
        },
      });
      agent.subscribe(event => {
        if (event.type === 'tool_execution_start') emit('tool_call', { tool: event.toolName, callId: event.toolCallId, input: event.args });
        if (event.type === 'tool_execution_end') {
          if (event.isError) state.failure ??= new LabError('tool_error', 'A tool failed or was denied');
          emit('tool_result', { tool: event.toolName, callId: event.toolCallId, ok: !event.isError, output: event.result.details?.output ?? event.result });
        }
        if (event.type === 'message_end' && event.message.role === 'assistant' && !['error', 'aborted'].includes(event.message.stopReason)) state.finalText = textContent(event.message.content);
      });
      const timer = setTimeout(() => { state.failure ??= new LabError('timeout', 'Prompt deadline exceeded'); interrupt(); }, config.timeoutMs);
      try {
        await agent.prompt(text);
        if (!state.failure && config.structured) {
          let decoded;
          try { decoded = config.decode(state.finalText, config.persona, config.capabilities); }
          catch (error) { emit('structured_reply_invalid', { rawContent: state.finalText, code: error.code ?? 'structured_invalid' }); throw error; }
          emit('structured_reply', { ...decoded, rawContent: state.finalText });
          state.finalText = decoded.text;
          const last = agent.state.messages.findLastIndex(message => message.role === 'assistant');
          if (last < 0) throw new LabError('agent_error', 'Missing structured assistant response');
          agent.state.messages = agent.state.messages.map((message, index) => index === last ? { ...message, content: [{ type: 'text', text: decoded.text }] } : message);
        }
        const phrases = config.persona.outputRules?.forbiddenPhrases ?? [];
        const violates = value => phrases.some(phrase => value.includes(phrase));
        const inspect = value => config.inspectPolicy({ text: value, prompt: text, persona: config.persona, memories: assembled.selectedItems ?? memories, capabilities: config.capabilities });
        let inspection;
        let initialMessages;
        if (!state.failure && (config.guarded || config.structured)) {
          inspection = inspect(state.finalText);
          emit('policy_check', { enforcement: config.structured ? 'observe-only; schema/configuration validation is separate' : 'bounded-repair', phase: 'initial', text: state.finalText, ...inspection });
        }
        if (!state.failure && config.structured && violates(state.finalText)) state.failure = new LabError('persona_violation', 'Literal output rule violated in structured reply');
        if (!state.failure && !config.structured && (config.voiced || violates(state.finalText) || inspection?.repairNeeded)) {
          initialMessages = [...agent.state.messages];
          const rawDraft = state.finalText;
          state.phase = config.voiced ? 'voice' : 'correction'; state.finalText = '';
          emit('notice', { code: config.voiced ? 'persona_voice' : 'persona_correction', attempt: 1, policy: config.voiced ? 'fresh-context-writer' : inspection?.repairNeeded ? 'external-rule-feedback' : 'literal-forbidden-phrases' });
          agent.state.tools = []; // Repair never executes a second tool effect.
          const feedback = inspection?.repairNeeded
            ? config.repairPrompt({ inspection, persona: config.persona, memories: assembled.selectedItems ?? memories, capabilities: config.capabilities })
            : 'Your final response violated the immutable operator literal output rules. Return one corrected final response that contains none of the forbidden phrases. Do not call tools. This is the only corrective attempt.';
          if (config.voiced) {
            const voice = voiceRequest({ persona: config.persona, prompt: text, draft: rawDraft, memories: assembled.selectedItems ?? memories, capabilities: config.capabilities });
            agent.state.messages = [createInitialSystemMessage(voice.system, [])];
            await agent.prompt(voice.user);
          } else await agent.prompt(feedback);
          if (!state.failure && config.guarded) {
            inspection = inspect(state.finalText);
            emit('policy_check', { phase: state.phase, text: state.finalText, ...inspection });
          }
          if (!state.failure && (violates(state.finalText) || inspection?.repairNeeded)) state.failure = new LabError('persona_violation', 'Policy violation remains after one repair; final response blocked');
          if (!state.failure && config.guarded) {
            // Rejected drafts and the internal repair instruction are not conversational memory.
            const accepted = agent.state.messages.findLast(message => message.role === 'assistant');
            const index = initialMessages.findLastIndex(message => message.role === 'assistant');
            if (!accepted || index < 0) throw new LabError('agent_error', 'Missing accepted assistant response');
            initialMessages[index] = accepted;
            agent.state.messages = initialMessages;
          }
        }
        if (!state.failure && !state.finalText.trim()) state.failure = new LabError('empty_response', 'Model returned no usable response text');
        if (agent.state.errorMessage && !state.failure) state.failure = new LabError('agent_error', 'Pi agent ended with an error');
        if (!state.failure && state.finalText) emit('text', { text: state.finalText });
        history = state.failure ? [] : agent.state.messages.filter(message => message.role !== 'system');
      } catch (error) { state.failure ??= error instanceof LabError ? error : new LabError('agent_error', 'Pi agent invocation failed'); history = []; }
      finally {
        clearTimeout(timer);
        if (mcpClosing) await mcpClosing;
        if (state.failure) errorEvent(state.failure);
        emit('turn_end', { policy: config.policy, ok: !state.failure, endReason: state.failure?.code ?? 'completed', finishReason: state.finishReason ?? null, model: config.modelName, synthetic: Boolean(config.script), providerTransport: config.providerTransport, turns: state.turns, providerCallAttempts: state.providerCallAttempts, externalModelCalls: state.externalModelCalls, modelResponses: state.modelResponses, toolCalls: state.toolCalls, usage: state.usage, usageComplete: state.usageComplete, costStatus: 'not_calculated', durationMs: Date.now() - state.started, rewritingStrategy: config.composed ? 'model parts joined with two newlines; no semantic repair' : config.structured ? 'parse-only; no semantic repair' : config.voiced ? 'fresh-context-always' : 'same-history-if-violation', correctionAttempts: state.phase !== 'initial' ? 1 : 0, correctionModelCalls: state.correctionModelCalls });
        active = undefined; agent = undefined; idle();
      }
    }
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    const shutdown = () => { closing = true; interrupt(); input.close(); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    input.on('line', line => {
      if (closing) return;
      try {
        const command = object(JSON.parse(line));
        if (command.op === 'approve') {
          keys(command, ['op', 'approvalId', 'allow']);
          if (typeof command.approvalId !== 'string' || typeof command.allow !== 'boolean') throw new LabError('invalid_input', 'approve requires approvalId string and allow boolean');
          if (!pending || pending.approvalId !== command.approvalId) throw new LabError('no_such_approval', 'Unknown or previously resolved approval');
          pending.settle(command.allow); return;
        }
        if (command.op === 'interrupt') { keys(command, ['op']); interrupt(); if (!active) idle(); return; }
        if (command.op === 'recall') { keys(command, ['op', 'slot'], ['op']); emit('memories', { items: store.recall(command.slot), ...namespace }); idle(); return; }
        if (command.op === 'observe') { keys(command, ['op', 'turnId', 'text']); emit('observed', store.observe(command.turnId, command.text)); idle(); return; }
        if (active || pending) throw new LabError('busy', 'Wait for the active operation or approval');
        if (command.op === 'new') { keys(command, ['op']); history = []; emit('notice', { text: 'Conversation transcript cleared; namespace, memory and scripted cursor preserved', ...namespace }); idle(); return; }
        if (command.op === 'remember') {
          keys(command, ['op', 'memory']);
          const proposal = store.proposal(command.memory);
          task = mutate('remember', proposal.tuple, () => store.remember(proposal)); return;
        }
        if (command.op === 'forget') {
          keys(command, ['op', 'slot', 'thing'], ['op', 'slot']); bounded(command.slot, 'slot'); if (command.thing !== undefined) bounded(command.thing, 'thing');
          const selector = Object.freeze({ slot: command.slot, ...(command.thing === undefined ? {} : { thing: command.thing }) });
          task = mutate('forget', selector, () => store.forget(selector)); return;
        }
        if (command.op === 'prompt') {
          keys(command, ['op', 'text']); bounded(command.text, 'prompt', 10000);
          if (poisoned) throw new LabError('requires_restart', 'MCP effect is uncertain; restart worker');
          task = prompt(command.text).catch(error => { errorEvent(error); active = undefined; idle(); }); return;
        }
        throw new LabError('invalid_input', 'Unknown operation');
      } catch (error) { errorEvent(error instanceof SyntaxError ? new LabError('invalid_input', 'Expected JSON object') : error); idle(); }
    });
    emit('ready', { policy: config.policy, minCallIntervalMs: config.minCallIntervalMs, capabilities: config.capabilities, framework: 'pi-agent-core+node:sqlite', version, ...namespace, personaHash: config.personaHash, personaRevision: config.persona.revision, model: config.modelName, syntheticOnly: Boolean(config.script), providerTransport: config.providerTransport, toolMode: config.toolMode, maxTokens: config.maxTokens, workspace: config.workspace, store: config.storePath, mcpPid: mcp.proc.pid, contextBudget: config.contextBudget });
    await new Promise(resolveClosed => input.once('close', () => { closing = true; interrupt(); resolveClosed(); }));
    await task;
    process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown);
  } finally { await closeMcp(); store.close(); }
}
main().catch(error => { emit('error', { code: error instanceof LabError || error instanceof Fault ? error.code : 'configuration', message: error instanceof LabError || error instanceof Fault ? redact(error.message) : 'Memory worker startup failed' }); process.exitCode = 1; });
