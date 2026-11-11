import { readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { ToolLoopAgent, isStepCount, tool, type ToolSet, type ModelMessage } from 'ai';
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4GenerateResult, LanguageModelV4Prompt } from '@ai-sdk/provider';
import { z } from 'zod';
import { Mcp } from '../../clova/client.ts';
import { Brain, normalizeToolCalls } from '../../clova/provider.ts';
import { Fault, clean, inside, usageZero, type Answer, type Message, type Tool, type Usage } from '../../clova/common.ts';

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, '../../..');
const sdkVersion = JSON.parse(readFileSync(resolve(folder, 'node_modules/ai/package.json'), 'utf8')).version as string;
const comparison = JSON.parse(readFileSync(resolve(root, 'runtime/clova/fixtures/comparison.json'), 'utf8')) as { systemPrompt: string };
const allowed = ['artifact_list', 'artifact_read', 'artifact_write', 'artifact_undo'];
type ScriptAnswer = Answer & { delayMs?: number };
type Run = {
  controller: AbortController; started: number; turns: number; toolCalls: number;
  usage: Usage; failures: string[]; seen: Set<string>; inFlight: number;
};
type Pending = { run: Run; decide: (allow: boolean) => void };

function configuration(args: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--workspace', '--script', '--model', '--max-turns', '--timeout-ms'].includes(args[i]) || !args[i + 1] || flags.has(args[i])) {
      throw new Fault('configuration', 'Expected --workspace DIR and either --script FILE or --model clova:HCX-005; optional --max-turns and --timeout-ms');
    }
    flags.set(args[i], args[i + 1]);
  }
  const workspaceArg = flags.get('--workspace');
  if (!workspaceArg || !isAbsolute(workspaceArg)) throw new Fault('configuration', '--workspace must be an absolute path inside this repository');
  const workspace = resolve(workspaceArg);
  const rel = relative(root, workspace);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Fault('configuration', 'workspace must be a subdirectory inside this repository');
  inside(root, rel); // Check existing ancestors before mkdir can follow a symlink.
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const physicalRel = relative(realpathSync(root), realpathSync(workspace));
  if (!physicalRel || physicalRel.startsWith('..') || isAbsolute(physicalRel)) throw new Fault('configuration', 'workspace symlink escapes this repository');
  const scriptFile = flags.get('--script');
  const model = flags.get('--model');
  if (Boolean(scriptFile) === Boolean(model)) throw new Fault('configuration', 'Specify exactly one of --script or --model');
  if (model && !/^clova:[A-Za-z0-9_-]+$/.test(model)) throw new Fault('configuration', 'live mode accepts only clova:<model>');
  const maxTurns = Number(flags.get('--max-turns') ?? 4);
  const timeoutMs = Number(flags.get('--timeout-ms') ?? 120000);
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new Fault('configuration', 'invalid max-turns or timeout-ms');
  let script: ScriptAnswer[] | undefined;
  if (scriptFile) {
    const parsed: unknown = JSON.parse(readFileSync(scriptFile, 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length) throw new Fault('configuration', 'script must be a nonempty response array');
    script = parsed as ScriptAnswer[];
    for (const answer of script) {
      if (!answer || answer.message?.role !== 'assistant' || typeof answer.message.content !== 'string' || !['stop', 'tool_calls', 'length'].includes(answer.finishReason)) throw new Fault('configuration', 'invalid scripted Answer');
      if (answer.message.toolCalls !== undefined) answer.message.toolCalls = normalizeToolCalls(answer.message.toolCalls);
      if (answer.finishReason === 'tool_calls' && !answer.message.toolCalls?.length) throw new Fault('configuration', 'tool_calls answer must contain calls');
      if (answer.delayMs !== undefined && (!Number.isInteger(answer.delayMs) || answer.delayMs < 0)) throw new Fault('configuration', 'delayMs must be a nonnegative integer');
      for (const value of Object.values(answer.usage ?? {})) if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Fault('configuration', 'invalid synthetic usage');
    }
  }
  return { workspace, script, model: model ?? 'scripted', maxTurns, timeoutMs };
}

/** Only provider translation: the ToolLoopAgent owns every model/tool loop step. */
export function toBrainMessages(prompt: LanguageModelV4Prompt): Message[] {
  const result: Message[] = [];
  for (const message of prompt) {
    if (message.role === 'system') { result.push({ role: 'system', content: message.content }); continue; }
    if (message.role === 'user') {
      if (message.content.some(part => part.type !== 'text')) throw new Fault('unsupported', 'prototype only supports text input');
      result.push({ role: 'user', content: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n') });
    } else if (message.role === 'assistant') {
      const calls = message.content.filter(part => part.type === 'tool-call').map(part => ({
        id: part.toolCallId, type: 'function' as const,
        function: { name: part.toolName, arguments: part.input as Record<string, unknown> },
      }));
      result.push({ role: 'assistant', content: message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'), ...(calls.length ? { toolCalls: calls } : {}) });
    } else {
      for (const part of message.content) if (part.type === 'tool-result') result.push({
        role: 'tool', toolCallId: part.toolCallId,
        content: 'value' in part.output ? (typeof part.output.value === 'string' ? part.output.value : JSON.stringify(part.output.value)) : JSON.stringify(part.output),
      });
    }
  }
  return result;
}

function modelResult(answer: Answer): LanguageModelV4GenerateResult {
  return {
    content: [
      ...(answer.message.content ? [{ type: 'text' as const, text: answer.message.content }] : []),
      ...(answer.message.toolCalls ?? []).map(call => ({ type: 'tool-call' as const, toolCallId: call.id, toolName: call.function.name, input: JSON.stringify(call.function.arguments) })),
    ],
    finishReason: { unified: answer.finishReason === 'tool_calls' ? 'tool-calls' : answer.finishReason === 'length' ? 'length' : 'stop', raw: answer.finishReason },
    usage: {
      inputTokens: { total: answer.usage.input, noCache: answer.usage.input, cacheRead: answer.usage.cacheRead, cacheWrite: answer.usage.cacheWrite },
      outputTokens: { total: answer.usage.output, text: answer.usage.output, reasoning: undefined },
    },
    warnings: [],
  };
}

export async function main() {
  let seq = 0;
  const emit = (t: string, data: object) => process.stdout.write(JSON.stringify({ v: 1, seq: ++seq, ts: new Date().toISOString(), t, data: clean(data) }) + '\n');
  let mcp: Mcp | undefined;
  let run: Run | undefined;
  let current: Promise<void> | undefined;
  let shuttingDown = false;
  let requiresRestart = false;
  let sessionId = randomUUID();
  let scriptIndex = 0;
  let history: ModelMessage[] = [];
  const pending = new Map<string, Pending>();
  try {
    const config = configuration(process.argv.slice(2));
    const brain = config.model === 'scripted' ? undefined : new Brain(config.model);
    async function openMcp() {
      mcp = new Mcp([process.execPath, resolve(root, 'runtime/clova/mcp.ts'), 'mcp', '--workspace', config.workspace], root, { CLOVA_MCP_ALLOWED_TOOLS: allowed.join(',') });
      const { tools } = await mcp.initialize();
      if (tools.length !== allowed.length || tools.some(t => !allowed.includes(t.name))) throw new Fault('configuration', 'MCP must expose exactly four artifact tools');
      return tools;
    }
    const mcpTools = await openMcp();
    const getRun = () => {
      if (!run) throw new Fault('engine', 'no active run');
      run.controller.signal.throwIfAborted();
      return run;
    };
    const recordCall = (active: Run, name: string, callId: string, input: unknown) => {
      if (active.seen.has(callId)) return;
      active.seen.add(callId);
      emit('tool_call', { tool: name, callId, input });
    };
    const provider: LanguageModelV4 = {
      specificationVersion: 'v4', provider: 'elda-brain', modelId: config.model, supportedUrls: {},
      async doGenerate(options: LanguageModelV4CallOptions) {
        options.abortSignal?.throwIfAborted();
        const active = getRun();
        if (active.turns >= config.maxTurns) throw new Fault('max_turns', 'maximum model requests reached');
        active.turns++;
        let answer: Answer;
        if (config.script) {
          const next = config.script[scriptIndex++];
          if (!next) throw new Fault('script_exhausted', 'script response array exhausted');
          if (next.delayMs) await delay(next.delayMs, undefined, { signal: active.controller.signal });
          active.controller.signal.throwIfAborted();
          answer = structuredClone({ ...next, usage: { ...usageZero(), ...next.usage } });
        } else {
          const tools: Tool[] = (options.tools ?? []).map(t => {
            if (t.type !== 'function') throw new Fault('unsupported', 'provider-defined tools are not supported');
            return { name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> };
          });
          answer = await brain!.call(toBrainMessages(options.prompt), tools, active.controller.signal, { maxTokens: 2048 });
        }
        active.controller.signal.throwIfAborted();
        for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) active.usage[key] += answer.usage[key];
        return modelResult(answer);
      },
      async doStream() { throw new Fault('unsupported', 'prototype uses ToolLoopAgent.generate, not streaming'); },
    };
    const tools: ToolSet = Object.fromEntries(mcpTools.map(def => {
      const name = `clova__${def.name}`;
      return [name, tool({
        description: def.description,
        inputSchema: z.fromJSONSchema(def.inputSchema),
        execute: async (input, { toolCallId, abortSignal }) => {
          // Check the SDK call's signal as well as the currently active turn;
          // a late callback must never borrow a newer turn's authority.
          abortSignal?.throwIfAborted();
          const active = getRun();
          active.toolCalls++;
          active.inFlight++;
          try {
            const output = await mcp!.request('tools/call', { name: def.name, arguments: input }, active.controller.signal, Math.max(1, config.timeoutMs - (Date.now() - active.started)));
            active.controller.signal.throwIfAborted();
            const ok = output?.isError !== true;
            if (!ok) active.failures.push('tool_error');
            emit('tool_result', { tool: name, callId: toolCallId, ok, output });
            return { ok, output };
          } catch (error) {
            // A transport failure leaves the side-effect outcome unknown. Do not
            // feed it back as a normal repairable tool error and retry the write.
            requiresRestart = true;
            const fault = new Fault('mcp_error', 'MCP transport failed; effects are uncertain and the worker must restart');
            if (!active.controller.signal.aborted) {
              emit('tool_result', { tool: name, callId: toolCallId, ok: false, output: { error: fault.code, message: fault.message, effectsUnknown: true } });
              active.controller.abort(fault);
            }
            await mcp!.close();
            throw active.controller.signal.reason ?? error;
          } finally { active.inFlight--; }
        },
      })];
    }));
    const agent = new ToolLoopAgent({
      model: provider,
      instructions: comparison.systemPrompt,
      tools, maxRetries: 0, maxOutputTokens: 2048, temperature: 0,
      stopWhen: isStepCount(config.maxTurns), toolCallConcurrency: 1,
      toolApproval: async ({ toolCall }) => {
        const active = getRun();
        recordCall(active, toolCall.toolName, toolCall.toolCallId, toolCall.input);
        const approvalId = randomUUID();
        const approved = await new Promise<boolean>((resolveApproval, rejectApproval) => {
          const abort = () => {
            pending.delete(approvalId);
            rejectApproval(active.controller.signal.reason ?? new Fault('interrupted', 'run interrupted'));
          };
          pending.set(approvalId, { run: active, decide: allow => {
            pending.delete(approvalId);
            active.controller.signal.removeEventListener('abort', abort);
            resolveApproval(allow);
          } });
          active.controller.signal.addEventListener('abort', abort, { once: true });
          emit('approval', { tool: toolCall.toolName, callId: toolCall.toolCallId, input: toolCall.input, approvalId });
          if (active.controller.signal.aborted) abort();
        });
        active.controller.signal.throwIfAborted();
        if (!approved) {
          active.failures.push('denied');
          emit('tool_result', { tool: toolCall.toolName, callId: toolCall.toolCallId, ok: false, output: { error: 'denied', message: 'User denied the tool call' } });
        }
        return { type: approved ? 'approved' : 'denied', reason: approved ? 'Explicit JSONL approval received' : 'User denied the tool call' };
      },
      onStepEnd: step => {
        const active = getRun();
        for (const call of step.toolCalls) {
          recordCall(active, call.toolName, call.toolCallId, call.input);
          if ('error' in call && call.error) {
            active.failures.push('tool_error');
            emit('tool_result', { tool: call.toolName, callId: call.toolCallId, ok: false, output: { error: 'invalid_tool_call', message: 'Invalid tool name or arguments' } });
          }
        }
      },
    });
    async function prompt(text: string) {
      const active: Run = { controller: new AbortController(), started: Date.now(), turns: 0, toolCalls: 0, usage: usageZero(), failures: [], seen: new Set(), inFlight: 0 };
      run = active;
      emit('turn_start', { sessionId });
      const timer = setTimeout(() => active.controller.abort(new Fault('timeout', 'turn deadline exceeded')), config.timeoutMs);
      let ok = false;
      let endReason = 'error';
      const messages: ModelMessage[] = [...history, { role: 'user', content: text }];
      try {
        const result = await agent.generate({ messages, abortSignal: active.controller.signal });
        active.controller.signal.throwIfAborted();
        // v7 response.messages is the final step only. responseMessages retains
        // all intermediate assistant tool calls and tool results across prompts.
        history = [...messages, ...result.responseMessages];
        if (result.text) emit('text', { text: result.text });
        if (active.turns >= config.maxTurns && result.finishReason === 'tool-calls') {
          endReason = 'max_turns';
          emit('error', { code: endReason, message: 'maximum model requests reached before completion' });
        } else if (active.failures.length) endReason = active.failures[0];
        else if (result.finishReason === 'stop') { ok = true; endReason = 'stop'; }
        else endReason = result.finishReason;
      } catch (error) {
        const reason = active.controller.signal.aborted ? active.controller.signal.reason : error;
        endReason = reason instanceof Fault ? reason.code : 'engine';
        emit('error', { code: endReason, message: reason instanceof Fault ? reason.message : 'SDK generation failed' });
        // Incomplete SDK histories are discarded; successful prior turns are preserved.
      } finally {
        clearTimeout(timer);
        for (const [id, entry] of pending) if (entry.run === active) { pending.delete(id); entry.decide(false); }
        run = undefined;
        emit('turn_end', { ok, endReason, turns: active.turns, toolCalls: active.toolCalls, usage: active.usage, durationMs: Date.now() - active.started, sessionId });
        emit('idle', { sessionId, requiresRestart });
      }
    }
    function interrupt() {
      if (!run) return;
      // Closing the MCP process stops outstanding work; already completed effects cannot be rolled back.
      if (run.inFlight) { requiresRestart = true; void mcp!.close(); }
      run.controller.abort(new Fault('interrupted', 'run interrupted'));
    }
    const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      interrupt();
      await current;
      await mcp?.close();
      reader.close();
    }
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
    reader.on('line', line => {
      if (shuttingDown) return;
      let input: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        input = parsed as Record<string, unknown>;
      } catch { emit('error', { code: 'invalid_input', message: 'Expected one JSON object per line' }); return; }
      if (input.op === 'approve') {
        if (typeof input.approvalId !== 'string' || typeof input.allow !== 'boolean') { emit('error', { code: 'invalid_input', message: 'approvalId string and allow boolean are required' }); return; }
        const approval = pending.get(input.approvalId);
        if (!approval || approval.run !== run) { emit('error', { code: 'no_such_approval', message: 'Approval is unknown or already resolved' }); return; }
        approval.decide(input.allow);
      } else if (input.op === 'interrupt') interrupt();
      else if (input.op === 'new') {
        if (run) { emit('error', { code: 'busy', message: 'Wait for idle before resetting' }); return; }
        if (requiresRestart) { emit('error', { code: 'requires_restart', message: 'Restart the worker after an in-flight MCP interruption' }); return; }
        history = []; scriptIndex = 0; brain?.reset(); sessionId = randomUUID();
        emit('notice', { message: 'Session and scripted response cursor reset', sessionId });
        emit('idle', { sessionId, requiresRestart: false });
      } else if (input.op === 'prompt') {
        if (typeof input.text !== 'string' || !input.text.trim()) { emit('error', { code: 'invalid_input', message: 'prompt text must be a nonempty string' }); return; }
        if (run) { emit('error', { code: 'busy', message: 'Only one prompt can run at a time' }); return; }
        if (requiresRestart) { emit('error', { code: 'requires_restart', message: 'Restart the worker after an in-flight MCP interruption' }); return; }
        current = prompt(input.text);
      } else emit('error', { code: 'invalid_input', message: 'Unknown operation' });
    });
    reader.once('close', () => { void shutdown(); });
    emit('ready', { framework: 'vercel-ai-sdk', version: sdkVersion, model: config.model, tools: Object.keys(tools), mcpPid: mcp!.proc.pid });
    await new Promise<void>(resolveExit => reader.once('close', resolveExit));
    await shutdown();
    await current;
    await mcp?.close();
  } catch (error) {
    emit('error', { code: error instanceof Fault ? error.code : 'configuration', message: error instanceof Fault ? error.message : 'Worker setup failed' });
    await mcp?.close();
    process.exitCode = 1;
  }
}
