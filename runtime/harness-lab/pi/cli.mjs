#!/usr/bin/env node
// Real Pi Agent loop; this adapter supplies a model stream, MCP tools and JSONL I/O.
import { Agent } from '@earendil-works/pi-agent-core';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Mcp } from '../../clova/client.ts';
import { Brain, normalizeToolCalls } from '../../clova/provider.ts';
import { Fault, clean, inside, usageZero } from '../../clova/common.ts';

const VERSION = '1.5.1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
let seq = 0;
const emit = (t, data = {}) => process.stdout.write(JSON.stringify(clean({ v: 1, seq: ++seq, ts: new Date().toISOString(), t, data })) + '\n');
const textContent = content => typeof content === 'string' ? content : (content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
const failure = (code, message) => ({ code, message });
function brainMessages(messages) {
  return messages.flatMap(message => {
    if (message.role === 'toolResult') return [{ role: 'tool', toolCallId: message.toolCallId, content: textContent(message.content) }];
    if (message.role === 'assistant') {
      const calls = message.content.filter(c => c.type === 'toolCall').map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }));
      return [{ role: 'assistant', content: textContent(message.content), ...(calls.length ? { toolCalls: calls } : {}) }];
    }
    if (['system', 'user'].includes(message.role)) return [{ role: message.role, content: textContent(message.content) }];
    return [];
  });
}
function piMessage(answer, model) {
  const usage = { ...usageZero(), ...answer.usage };
  return {
    role: 'assistant', api: 'openai-completions', provider: 'elda-lab', model,
    content: [
      ...(answer.message.content ? [{ type: 'text', text: answer.message.content }] : []),
      ...(answer.message.toolCalls ?? []).map(c => ({ type: 'toolCall', id: c.id, name: c.function.name, arguments: c.function.arguments })),
    ],
    usage: { ...usage, totalTokens: Object.values(usage).reduce((a, b) => a + b, 0), cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: answer.finishReason === 'tool_calls' ? 'toolUse' : answer.finishReason,
    timestamp: Date.now(),
  };
}
function validateAnswer(answer) {
  if (!answer || answer.message?.role !== 'assistant' || typeof answer.message.content !== 'string' || !['stop', 'length', 'tool_calls'].includes(answer.finishReason)) throw new Fault('invalid_script', 'invalid scripted Brain answer');
  if (answer.message.toolCalls !== undefined) answer.message.toolCalls = normalizeToolCalls(answer.message.toolCalls);
  if (answer.finishReason === 'tool_calls' && !answer.message.toolCalls?.length) throw new Fault('invalid_script', 'empty scripted tool call response');
  if (answer.delayMs !== undefined && (!Number.isFinite(answer.delayMs) || answer.delayMs < 0)) throw new Fault('invalid_script', 'invalid script delay');
  for (const value of Object.values(answer.usage ?? {})) if (!Number.isFinite(value) || value < 0) throw new Fault('invalid_script', 'invalid script usage');
  return answer;
}

async function main() {
  const workspaceArg = option('--workspace');
  const scriptPath = option('--script');
  const requestedModel = option('--model');
  if (!workspaceArg || (!scriptPath && !requestedModel) || (scriptPath && requestedModel)) throw new Fault('configuration', 'require --workspace and either --script FILE or --model clova:HCX-005');
  const maxTurns = Number(option('--max-turns') ?? 4);
  const timeoutMs = Number(option('--timeout-ms') ?? 120000);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Fault('configuration', 'invalid turn/time limit');
  const resolvedWorkspace = resolve(workspaceArg);
  const rel = relative(root, resolvedWorkspace);
  if (!rel || rel.startsWith('../') || isAbsolute(rel)) throw new Fault('configuration', 'workspace must be a subdirectory of clova-api-lab');
  inside(root, rel); // Check existing symlink ancestors before creating the workspace.
  mkdirSync(resolvedWorkspace, { recursive: true, mode: 0o700 });
  const workspace = realpathSync(resolvedWorkspace);
  const realRel = relative(realpathSync(root), workspace);
  if (!realRel || realRel.startsWith('../') || isAbsolute(realRel)) throw new Fault('configuration', 'workspace resolves outside clova-api-lab');
  const script = scriptPath ? JSON.parse(readFileSync(resolve(scriptPath), 'utf8')) : undefined;
  if (scriptPath && (!Array.isArray(script) || !script.length)) throw new Fault('configuration', 'script must be a nonempty response array');
  script?.forEach(validateAnswer);
  const model = script ? 'scripted' : requestedModel;
  const brain = script ? undefined : new Brain(requestedModel);
  let scriptIndex = 0;
  let sessionId = randomUUID();
  let job;
  let active;
  let closing = false;
  let poisoned = false;
  let mcpClose;
  const pending = new Map();
  const allowed = ['artifact_list', 'artifact_read', 'artifact_write', 'artifact_undo'];
  const mcp = new Mcp([process.execPath, resolve(root, 'runtime/clova/mcp.ts'), 'mcp', '--workspace', workspace], workspace, { CLOVA_MCP_ALLOWED_TOOLS: allowed.join(',') });
  const closeMcp = () => mcpClose ??= mcp.close();
  try {
    const init = await mcp.initialize();
    const available = init.tools.filter(t => allowed.includes(t.name));
    if (available.length !== allowed.length) throw new Fault('configuration', 'MCP artifact tool set incomplete');
    const brainTools = available.map(t => ({ ...t, name: `clova__${t.name}` }));
    const tools = available.map(tool => ({
      name: `clova__${tool.name}`, label: tool.name, description: tool.description, parameters: tool.inputSchema,
      async execute(callId, input, signal) {
        if (!active || signal?.aborted || closing) throw new Fault('interrupted', 'tool cancelled before dispatch');
        active.toolCalls++;
        active.inflight++;
        try {
          const output = await mcp.request('tools/call', { name: tool.name, arguments: input }, signal);
          let ok = !output.isError;
          for (const item of output.content ?? []) if (item.type === 'text') { try { if (JSON.parse(item.text).failed) ok = false; } catch {} }
          return { content: [{ type: 'text', text: JSON.stringify(output) }], details: { mcpOutput: output }, isError: !ok };
        } catch (error) {
          poisoned = true;
          active.failure ??= failure(signal?.aborted ? 'interrupted' : 'mcp_error', signal?.aborted ? 'turn interrupted' : 'MCP transport failed');
          await closeMcp();
          throw error;
        } finally { active.inflight--; }
      },
    }));
    const modelConfig = { id: model, name: model, api: 'openai-completions', provider: 'elda-lab', baseUrl: 'http://127.0.0.1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 2048 };
    const { systemPrompt } = JSON.parse(readFileSync(resolve(root, 'runtime/clova/fixtures/comparison.json'), 'utf8'));
    if (typeof systemPrompt !== 'string' || !systemPrompt) throw new Fault('configuration', 'comparison fixture systemPrompt missing');
    const agent = new Agent({
      initialState: { systemPrompt, model: modelConfig, tools, thinkingLevel: 'off' },
      toolExecution: 'sequential',
      streamFn(_model, context, options) {
        const stream = new AssistantMessageEventStream();
        void (async () => {
          let answer;
          try {
            options.signal?.throwIfAborted();
            if (active.turns >= maxTurns) throw new Fault('max_turns', 'model round trip limit reached');
            if (script && scriptIndex >= script.length) throw new Fault('script_exhausted', 'scripted responses exhausted');
            active.turns++;
            if (script) {
              answer = structuredClone(script[scriptIndex++]);
              if (answer.delayMs) await delay(answer.delayMs, undefined, { signal: options.signal });
            } else answer = await brain.call(brainMessages(context.messages), brainTools, options.signal);
            options.signal?.throwIfAborted();
            answer = validateAnswer(answer);
            for (const key of Object.keys(active.usage)) active.usage[key] += answer.usage?.[key] ?? 0;
            const result = piMessage(answer, model);
            if (answer.finishReason === 'length') {
              active.failure ??= failure('truncated', 'model response was truncated');
              result.stopReason = 'error'; result.errorMessage = 'model response was truncated';
              stream.push({ type: 'error', reason: 'error', error: result });
            } else stream.push({ type: 'done', reason: result.stopReason, message: result });
          } catch (error) {
            const aborted = options.signal?.aborted;
            active.failure ??= failure(aborted ? 'interrupted' : error instanceof Fault ? error.code : 'model_error', aborted ? 'turn interrupted' : error instanceof Fault ? error.message : 'model adapter failed');
            const result = piMessage({ message: { content: '' }, finishReason: aborted ? 'aborted' : 'error', usage: usageZero() }, model);
            result.errorMessage = active.failure.message;
            stream.push({ type: 'error', reason: result.stopReason, error: result });
          }
        })();
        return stream;
      },
      async beforeToolCall({ toolCall, args: input }, signal) {
        if (signal?.aborted || closing) return { block: true, reason: 'turn interrupted', terminate: true };
        const approvalId = randomUUID();
        const allow = await new Promise(resolveDecision => {
          const settle = value => {
            if (!pending.has(approvalId)) return;
            pending.delete(approvalId);
            signal?.removeEventListener('abort', abort);
            resolveDecision(value);
          };
          const abort = () => settle(false);
          pending.set(approvalId, { settle });
          signal?.addEventListener('abort', abort, { once: true });
          emit('approval', { tool: toolCall.name, callId: toolCall.id, input, approvalId });
          if (signal?.aborted || closing) settle(false);
        });
        if (signal?.aborted || closing) return { block: true, reason: 'turn interrupted', terminate: true };
        return allow ? undefined : { block: true, reason: 'denied: user rejected tool execution' };
      },
      finishTurn({ message, toolResults }, signal) {
        if (signal?.aborted) return { action: 'end' };
        if (active.turns >= maxTurns && toolResults.length && !['error', 'aborted'].includes(message.stopReason)) {
          active.failure ??= failure('max_turns', 'model round trip limit reached');
          return { action: 'end' };
        }
        return undefined;
      },
    });
    agent.subscribe(event => {
      if (event.type === 'tool_execution_start') emit('tool_call', { tool: event.toolName, callId: event.toolCallId, input: event.args });
      if (event.type === 'tool_execution_end') emit('tool_result', { tool: event.toolName, callId: event.toolCallId, ok: !event.isError, output: event.result.details?.mcpOutput ?? event.result });
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const text = textContent(event.message.content);
        if (text && !['error', 'aborted'].includes(event.message.stopReason)) emit('text', { text });
      }
    });
    const interrupt = reason => {
      if (!active) return;
      active.failure ??= failure('interrupted', reason);
      if (active.inflight) { poisoned = true; void closeMcp(); }
      agent.abort();
      for (const approval of pending.values()) approval.settle(false);
    };
    async function turn(text) {
      active = { turns: 0, toolCalls: 0, usage: usageZero(), inflight: 0, failure: undefined, started: Date.now() };
      emit('turn_start', { sessionId });
      const timer = setTimeout(() => interrupt('turn time limit reached'), timeoutMs);
      try {
        await agent.prompt(text);
        if (agent.state.errorMessage && !active.failure) active.failure = failure('agent_error', 'Pi agent run failed');
      } catch (error) {
        active.failure ??= failure(error instanceof Fault ? error.code : 'agent_error', error instanceof Fault ? error.message : 'Pi agent run failed');
      } finally {
        clearTimeout(timer);
        if (mcpClose) await mcpClose;
        if (active.failure) emit('error', active.failure);
        emit('turn_end', { ok: !active.failure, endReason: active.failure?.code ?? 'completed', turns: active.turns, toolCalls: active.toolCalls, usage: active.usage, durationMs: Date.now() - active.started, sessionId, messages: agent.state.messages.length });
        active = undefined;
        job = undefined;
        emit('idle', { sessionId, requiresRestart: poisoned });
      }
    }
    emit('ready', { framework: 'pi-agent-core', version: VERSION, model, tools: tools.map(t => t.name), mcpPid: mcp.proc.pid });
    const input = createInterface({ input: process.stdin });
    const shutdown = () => { closing = true; interrupt('input closed or worker stopped'); input.close(); };
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    input.on('line', line => {
      let op;
      try { op = JSON.parse(line); } catch { emit('error', failure('invalid_input', 'expected JSON object')); return; }
      if (!op || typeof op !== 'object' || Array.isArray(op)) { emit('error', failure('invalid_input', 'expected operation object')); return; }
      if (op.op === 'interrupt') { interrupt('turn interrupted'); return; }
      if (op.op === 'approve') {
        if (typeof op.approvalId !== 'string' || typeof op.allow !== 'boolean') { emit('error', failure('invalid_input', 'approve requires approvalId string and allow boolean')); return; }
        const approval = pending.get(op.approvalId);
        if (!approval) { emit('error', failure('no_such_approval', 'unknown or already settled approval')); return; }
        approval.settle(op.allow); return;
      }
      if (op.op === 'new') {
        if (job || active) { emit('error', failure('busy', 'wait for idle before reset')); return; }
        if (poisoned) { emit('error', failure('session_invalid', 'MCP transport uncertain; restart worker')); return; }
        agent.reset(); brain?.reset(); scriptIndex = 0; sessionId = randomUUID();
        emit('notice', { text: 'new conversation', sessionId }); return;
      }
      if (op.op !== 'prompt' || typeof op.text !== 'string' || !op.text.trim() || op.text.length > 100000) { emit('error', failure('invalid_input', 'expected prompt, approve, interrupt or new')); return; }
      if (job || active || closing || poisoned) { emit('error', failure(poisoned ? 'session_invalid' : 'busy', poisoned ? 'MCP transport uncertain; restart worker' : 'wait for idle')); return; }
      job = turn(op.text);
    });
    await new Promise(resolveClosed => input.once('close', () => { closing = true; interrupt('input closed'); resolveClosed(); }));
    await job;
    process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown);
  } finally { await closeMcp(); }
}
main().catch(error => { emit('error', failure(error instanceof Fault ? error.code : 'configuration', error instanceof Fault ? error.message : 'worker startup failed')); process.exitCode = 1; });
