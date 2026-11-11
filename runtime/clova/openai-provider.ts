import {Fault, secretFile, type Answer, type Message, type Tool, type ToolCall, type Usage} from './common.ts';
import {mode2ProviderForModel, type Mode2Provider} from './providers.ts';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const tokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function endpoint(provider: Mode2Provider): URL {
  const override = process.env[provider.baseUrlEnv];
  let base: URL;
  try { base = new URL(override ?? provider.defaultBaseUrl); }
  catch { throw new Fault('configuration', `${provider.baseUrlEnv} is invalid`); }
  if (base.username || base.password || base.search || base.hash ||
    (override !== undefined && (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) {
    throw new Fault('configuration', `${provider.baseUrlEnv} only allows a loopback test server`);
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/chat/completions`;
  return base;
}

function credential(provider: Mode2Provider): string {
  const path = process.env[provider.keyFileEnv];
  if (!path) throw new Fault('configuration', `${provider.keyFileEnv} is required`);
  try { return secretFile(path); }
  catch (error) {
    // Filesystem exceptions contain credential paths. Never include their messages.
    if (error instanceof Fault) throw error;
    throw new Fault('configuration', `${provider.keyFileEnv} could not be read`);
  }
}

function wireMessage(message: Message, provider: Mode2Provider): JsonObject {
  const result: JsonObject = {role: message.role, content: message.content};
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new Fault('invalid_argument', 'tool result requires a tool call ID');
    result.tool_call_id = message.toolCallId;
  }
  if (message.role === 'assistant') {
    if (message.toolCalls?.length) {
      result.content = message.content || null;
      result.tool_calls = message.toolCalls.map(call => ({id: call.id, type: 'function', function: {
        name: call.function.name, arguments: JSON.stringify(call.function.arguments),
      }}));
    }
    const reasoning = message.providerReasoning;
    if (provider.id === 'zai' && reasoning?.reasoningContent !== undefined) result.reasoning_content = reasoning.reasoningContent;
    if (provider.id !== 'zai' && reasoning?.reasoning !== undefined) result.reasoning = reasoning.reasoning;
    if (provider.id === 'openrouter' && reasoning?.reasoningDetails !== undefined) result.reasoning_details = reasoning.reasoningDetails;
  }
  return result;
}

function usageFrom(value: unknown): Usage {
  if (!object(value) || !tokenCount(value.prompt_tokens) || !tokenCount(value.completion_tokens)) {
    throw new Fault('api_error', 'provider response has no valid token usage', 502);
  }
  const details = value.prompt_tokens_details;
  if (details !== undefined && details !== null && !object(details)) throw new Fault('api_error', 'invalid provider cache usage', 502);
  const cached = object(details) ? details.cached_tokens ?? 0 : 0;
  const written = object(details) ? details.cache_write_tokens ?? 0 : 0;
  if (!tokenCount(cached) || !tokenCount(written) || cached + written > value.prompt_tokens) throw new Fault('api_error', 'invalid provider cache usage', 502);
  // prompt_tokens includes cached input; Elda's four counters are disjoint.
  // completion_tokens already includes reasoning tokens; do not add them again.
  return {input: value.prompt_tokens - cached - written, output: value.completion_tokens, cacheRead: cached, cacheWrite: written};
}

function toolCallsFrom(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) throw new Fault('api_error', 'provider tool_calls must be an array', 502);
  const ids = new Set<string>();
  return value.map(call => {
    if (!object(call) || typeof call.id !== 'string' || !call.id || ids.has(call.id) || call.type !== 'function' ||
      !object(call.function) || typeof call.function.name !== 'string' || !call.function.name) {
      throw new Fault('api_error', 'invalid provider tool call identity', 502);
    }
    ids.add(call.id);
    let args: unknown = call.function.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); }
      catch { throw new Fault('api_error', 'provider tool arguments contain invalid JSON', 502); }
    }
    if (!object(args)) throw new Fault('api_error', 'provider tool arguments must be an object', 502);
    return {id: call.id, type: 'function', function: {name: call.function.name, arguments: args}};
  });
}

function answerFrom(body: unknown): Answer {
  if (!object(body)) throw new Fault('api_error', 'invalid provider response', 502);
  const usage = usageFrom(body.usage);
  try {
    if (body.error != null || !Array.isArray(body.choices) || body.choices.length !== 1) throw new Fault('api_error', 'invalid provider choices', 502);
    const choice: unknown = body.choices[0];
    if (!object(choice) || !object(choice.message) || choice.message.role !== 'assistant' ||
      (choice.message.content != null && typeof choice.message.content !== 'string')) throw new Fault('api_error', 'invalid provider assistant message', 502);
    if (typeof choice.finish_reason !== 'string' || !['stop', 'length', 'tool_calls'].includes(choice.finish_reason)) throw new Fault('api_error', 'unsupported provider finish reason', 502);
    const message: Message = {role: 'assistant', content: choice.message.content ?? ''};
    if (choice.message.tool_calls !== undefined && choice.message.tool_calls !== null) message.toolCalls = toolCallsFrom(choice.message.tool_calls);
    if (choice.finish_reason === 'tool_calls' && !message.toolCalls?.length) throw new Fault('api_error', 'provider tool_calls response is empty', 502);
    if (message.toolCalls?.length && choice.finish_reason !== 'tool_calls') throw new Fault('api_error', 'provider tool calls have inconsistent finish reason', 502);
    const reasoning: NonNullable<Message['providerReasoning']> = {};
    for (const [wire, field] of [['reasoning', 'reasoning'], ['reasoning_content', 'reasoningContent']] as const) {
      const value = choice.message[wire];
      if (value !== undefined && value !== null) {
        if (typeof value !== 'string') throw new Fault('api_error', 'invalid provider reasoning metadata', 502);
        reasoning[field] = value;
      }
    }
    if (choice.message.reasoning_details !== undefined && choice.message.reasoning_details !== null) {
      if (!Array.isArray(choice.message.reasoning_details) || !choice.message.reasoning_details.every(object)) throw new Fault('api_error', 'invalid provider reasoning metadata', 502);
      reasoning.reasoningDetails = choice.message.reasoning_details;
    }
    if (Object.keys(reasoning).length) message.providerReasoning = reasoning;
    return {message, finishReason: choice.finish_reason, usage};
  } catch (error) {
    if (error instanceof Fault) error.usage = usage;
    throw error;
  }
}

/** OpenAI Chat Completions transport for the three fixed mode 2 candidates. */
export class OpenAIProvider {
  readonly provider: Mode2Provider;
  private readonly key: string;
  private readonly url: URL;
  private readonly model: string;
  constructor(selector: string) {
    const provider = mode2ProviderForModel(selector);
    if (!provider) throw new Fault('configuration', 'model is not an approved mode 2 candidate');
    this.provider = provider;
    this.model = selector.slice(provider.id.length + 1);
    this.url = endpoint(provider);
    this.key = credential(provider);
  }

  async call(messages: Message[], tools: Tool[], signal: AbortSignal, generation: {maxTokens?: number} = {}): Promise<Answer> {
    const maxTokens = generation.maxTokens ?? 2048;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) throw new Fault('invalid_argument', 'maxTokens must be an integer from 1 to 2048');
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    const interrupted = () => new Fault(signal.aborted && signal.reason?.name !== 'TimeoutError' ? 'interrupted' : 'timeout',
      signal.aborted && signal.reason?.name !== 'TimeoutError' ? 'provider request was cancelled' : 'provider request exceeded its time limit', 504);
    if (requestSignal.aborted) throw interrupted();
    const body: JsonObject = {
      model: this.model, messages: messages.map(message => wireMessage(message, this.provider)), temperature: 0, stream: false,
      ...(tools.length ? {tools: tools.map(tool => ({type: 'function', function: {name: tool.name, description: tool.description, parameters: tool.inputSchema}})), tool_choice: 'auto'} : {}),
    };
    if (this.provider.id === 'groq') {
      // GPT-OSS rejects reasoning_format; include_reasoning is its native control.
      Object.assign(body, {max_completion_tokens: maxTokens, reasoning_effort: 'low', include_reasoning: true});
    } else {
      body.max_tokens = maxTokens;
      if (this.provider.id === 'zai') body.thinking = {type: 'disabled'};
      else body.provider = {require_parameters: true, allow_fallbacks: false, max_price: {prompt: 0, completion: 0, request: 0}};
    }
    let response: Response;
    try {
      response = await fetch(this.url, {method: 'POST', redirect: 'error', signal: requestSignal,
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${this.key}`}, body: JSON.stringify(body)});
    } catch {
      if (requestSignal.aborted) throw interrupted();
      throw new Fault('api_error', 'provider connection failed', 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Fault('api_error', `${this.provider.label} HTTP ${response.status}`, response.status);
    }
    let data: unknown;
    try { data = await response.json(); }
    catch {
      if (requestSignal.aborted) throw interrupted();
      throw new Fault('api_error', 'provider response is not valid JSON', 502);
    }
    return answerFrom(data);
  }
}
