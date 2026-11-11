#!/usr/bin/env node
import {createServer, type IncomingMessage, type ServerResponse, type Server} from 'node:http';
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Brain} from './provider.ts';
import {Fault, secretFile, type Message, type Tool, type ToolCall, type Usage} from './common.ts';
import {AnthropicInputError, parseAnthropicRequest, toAnthropicMessage, anthropicEvents, type AnthropicEvent} from './anthropic.ts';

const BODY_LIMIT = 1024 * 1024;
const VERSION = '1.0.0';
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
type JsonObject = Record<string, unknown>;
export type WrapperCallMetrics = {model: string; durationMs: number; ok: boolean; status: number; usage?: Usage};
export type WrapperOptions = {tokenFile?: string; allowedModels?: string[]; timeoutMs?: number; onCall?: (metrics: WrapperCallMetrics) => void};

class InputError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'invalid_request') {
    super(message); this.status = status; this.code = code;
  }
}
function object(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(`${field} must be an object.`);
  return value as JsonObject;
}
function keys(value: JsonObject, allowed: string[], field: string) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new InputError(`${field} contains unsupported fields.`);
}
function string(value: unknown, field: string, max = BODY_LIMIT): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new InputError(`${field} must be a nonempty string.`);
  return value;
}
function toolName(value: unknown): string {
  const name = string(value, 'function.name', 64);
  if (!NAME.test(name)) throw new InputError('function.name has an invalid format.');
  return name;
}
function calls(value: unknown): ToolCall[] {
  if (!Array.isArray(value) || !value.length) throw new InputError('tool_calls must be a nonempty array.');
  const ids = new Set<string>();
  return value.map(v => {
    const call = object(v, 'tool_call'); keys(call, ['id', 'type', 'function'], 'tool_call');
    if (call.type !== 'function') throw new InputError('Only function tool calls are supported.');
    const id = string(call.id, 'tool_call.id', 128);
    if (ids.has(id)) throw new InputError('tool_call.id must be unique within a message.');
    ids.add(id);
    const fn = object(call.function, 'function'); keys(fn, ['name', 'arguments'], 'function');
    if (typeof fn.arguments !== 'string') throw new InputError('function.arguments must be a JSON object encoded as a string.');
    let args: unknown;
    try { args = JSON.parse(fn.arguments); } catch { throw new InputError('function.arguments must contain valid JSON.'); }
    return {id, type: 'function', function: {name: toolName(fn.name), arguments: object(args, 'function.arguments')}};
  });
}
function messages(value: unknown): Message[] {
  if (!Array.isArray(value) || !value.length) throw new InputError('messages must be a nonempty array.');
  return value.map(v => {
    const m = object(v, 'message'); keys(m, ['role', 'content', 'tool_calls', 'tool_call_id'], 'message');
    if (!['system', 'user', 'assistant', 'tool'].includes(String(m.role))) throw new InputError('message.role is unsupported.');
    const role = m.role as Message['role'];
    const toolCalls = m.tool_calls === undefined ? undefined : calls(m.tool_calls);
    if (toolCalls && role !== 'assistant') throw new InputError('tool_calls are only valid in assistant messages.');
    if (m.tool_call_id !== undefined && role !== 'tool') throw new InputError('tool_call_id is only valid in tool messages.');
    const content = m.content === null && role === 'assistant' && toolCalls ? '' : m.content;
    if (typeof content !== 'string') throw new InputError('message.content must be text; multimodal input is unsupported.');
    const toolCallId = role === 'tool' ? string(m.tool_call_id, 'tool_call_id', 128) : undefined;
    return {role, content, ...(toolCalls ? {toolCalls} : {}), ...(toolCallId ? {toolCallId} : {})};
  });
}
function tools(value: unknown): Tool[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InputError('tools must be an array.');
  const names = new Set<string>();
  return value.map(v => {
    const t = object(v, 'tool'); keys(t, ['type', 'function'], 'tool');
    if (t.type !== 'function') throw new InputError('Only function tools are supported.');
    const fn = object(t.function, 'function'); keys(fn, ['name', 'description', 'parameters'], 'function');
    const name = toolName(fn.name);
    if (names.has(name)) throw new InputError('Tool names must be unique.');
    names.add(name);
    if (fn.description !== undefined && typeof fn.description !== 'string') throw new InputError('function.description must be text.');
    const inputSchema = object(fn.parameters ?? {type: 'object'}, 'function.parameters');
    if (inputSchema.type !== undefined && inputSchema.type !== 'object') throw new InputError('function.parameters must describe an object.');
    return {name, description: fn.description as string ?? '', inputSchema};
  });
}
function body(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let length = 0, settled = false;
    const chunks: Buffer[] = [];
    const fail = (error: Error) => { if (!settled) { settled = true; chunks.length = 0; reject(error); } };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > BODY_LIMIT) { fail(new InputError('Request body exceeds 1 MiB.', 413, 'body_too_large')); return; }
      chunks.push(chunk);
    });
    req.once('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new InputError('Request body must contain valid JSON.')); }
    });
    req.once('error', () => fail(new InputError('Request body could not be read.')));
    req.once('aborted', () => fail(new InputError('Request was interrupted.')));
  });
}
function send(res: ServerResponse, status: number, value: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(value));
}
function errorDetails(error: unknown) {
  if (error instanceof InputError || error instanceof AnthropicInputError) return {status: error.status, message: error.message, code: error.code};
  const status = error instanceof Fault && Number.isInteger(error.status) && error.status! >= 400 && error.status! <= 599
    ? error.status! : error instanceof Fault && error.code === 'configuration' ? 503 : 502;
  const timeout = error instanceof Fault && error.code === 'timeout';
  // Native error bodies, credentials, URLs, paths and request contents never cross this boundary.
  return {status: timeout ? 504 : status,
    message: timeout ? 'CLOVA request timed out.' : error instanceof Fault && error.code === 'configuration' ? 'CLOVA wrapper is not configured.' : `CLOVA upstream request failed (HTTP ${status}).`,
    code: timeout ? 'timeout' : 'api_error'};
}
function providerErrorFields(error: unknown) {
  return error instanceof Fault && error.apiError !== undefined
    ? {apiError: error.apiError, retryable: error.retryable === true, ...(error.providerCode ? {providerCode: error.providerCode} : {})} : {};
}
function anthropicError(error: unknown) {
  const details = errorDetails(error);
  const type = ({400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 413: 'request_too_large', 429: 'rate_limit_error', 529: 'overloaded_error'} as Record<number, string>)[details.status] ?? 'api_error';
  return {type: 'error', error: {type, message: details.message, ...providerErrorFields(error)}, request_id: `req_${randomUUID()}`};
}
function fail(res: ServerResponse, error: unknown, anthropic = false) {
  const {status, message, code} = errorDetails(error);
  if (status === 413) res.shouldKeepAlive = false;
  send(res, status, anthropic ? anthropicError(error) : {error: {message, code, ...providerErrorFields(error),
    type: error instanceof InputError ? 'invalid_request_error' : 'upstream_error'}});
}
function sse(res: ServerResponse, event: AnthropicEvent) {
  if (!res.destroyed && !res.writableEnded) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
function loopback(address: string | undefined) {
  return address === '::1' || /^127\./.test(address ?? '') || /^::ffff:127\./.test(address ?? '');
}

/** A single-provider compatibility wrapper; the caller owns the agent loop and tools. */
export function createWrapper(options: WrapperOptions = {}): Server {
  const tokenFile = options.tokenFile ?? process.env.CLOVA_WRAPPER_TOKEN_FILE;
  if (!tokenFile) throw new Fault('configuration', 'CLOVA_WRAPPER_TOKEN_FILE is required');
  const token = secretFile(tokenFile), apiKey = secretFile(process.env.CLOVA_API_KEY_FILE);
  if (token === apiKey) throw new Fault('configuration', 'wrapper token must differ from the CLOVA API key');
  const tokenHash = createHash('sha256').update(token).digest();
  const allowedModels = options.allowedModels ?? ['HCX-005'];
  if (!allowedModels.length || new Set(allowedModels).size !== allowedModels.length || allowedModels.some(m => !/^[A-Za-z0-9_-]+$/.test(m))) throw new Fault('configuration', 'invalid allowed models');
  const timeoutMs = options.timeoutMs ?? 60000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Fault('configuration', 'invalid wrapper timeout');
  const brains = new Map(allowedModels.map(model => [model, new Brain(`clova:${model}`)]));
  const call = async (model: string, messages: Message[], tools: Tool[], signal: AbortSignal, maxTokens?: number) => {
    const started = performance.now();
    const report = (metrics: Omit<WrapperCallMetrics, 'model' | 'durationMs'>) => {
      try { options.onCall?.({model, durationMs: Math.round(performance.now() - started), ...metrics}); } catch {}
    };
    try {
      const answer = await brains.get(model)!.call(messages, tools, signal, maxTokens === undefined ? undefined : {maxTokens});
      report({ok: true, status: 200, usage: {...answer.usage}});
      return answer;
    } catch (error) {
      report({ok: false, status: error instanceof Fault && error.code === 'interrupted' ? 499 : errorDetails(error).status,
        ...(error instanceof Fault && error.usage ? {usage: {...error.usage}} : {})});
      throw error;
    }
  };
  const server = createServer(async (req, res) => {
    const controller = new AbortController();
    const path = req.url?.split('?')[0];
    const anthropic = path === '/v1/messages';
    let streaming = false, pingTimer: ReturnType<typeof setInterval> | undefined;
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (!loopback(req.socket.remoteAddress)) throw new InputError('Only loopback clients are allowed.', 403, 'loopback_only');
      const authorization = req.headers.authorization;
      const apiToken = req.headers['x-api-key'];
      const supplied = [authorization === undefined ? undefined : authorization.startsWith('Bearer ') ? authorization.slice(7) : '', apiToken].filter(v => v !== undefined);
      if (!supplied.length || supplied.some(v => typeof v !== 'string' || !v || !timingSafeEqual(tokenHash, createHash('sha256').update(v).digest()))) {
        res.setHeader('www-authenticate', 'Bearer');
        throw new InputError('A valid wrapper bearer token is required.', 401, 'unauthorized');
      }
      if (req.method === 'GET' && path === '/health') { send(res, 200, {status: 'ok', version: VERSION}); return; }
      if (req.method === 'GET' && path === '/v1/models') {
        send(res, 200, {object: 'list', data: allowedModels.map(id => ({id, object: 'model', created: 0, owned_by: 'naver-clova'}))}); return;
      }
      if (req.method === 'POST' && anthropic) {
        if (req.headers['anthropic-version'] !== undefined && req.headers['anthropic-version'] !== '2023-06-01') throw new InputError('Only anthropic-version 2023-06-01 is supported.');
        const input = parseAnthropicRequest(await body(req), allowedModels);
        res.setHeader('x-clova-compatibility', 'experimental-text-tools');
        if (input.stream) {
          streaming = true;
          // Native Brain is nonstreaming. Pings keep the transport alive; content arrives after generation.
          res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
            'x-accel-buffering': 'no', 'x-clova-streaming': 'buffered-native'});
          res.flushHeaders();
          sse(res, {type: 'ping'});
          pingTimer = setInterval(() => sse(res, {type: 'ping'}), 10000); pingTimer.unref();
        }
        const answer = await call(input.model, input.messages, input.tools, AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]), input.maxTokens);
        if (controller.signal.aborted) return;
        const result = toAnthropicMessage(answer, input.model, `msg_${randomUUID().replaceAll('-', '')}`);
        if (streaming) { for (const event of anthropicEvents(result)) sse(res, event); res.end(); }
        else send(res, 200, result);
        return;
      }
      if (req.method !== 'POST' || path !== '/v1/chat/completions') throw new InputError('Route not found.', 404, 'not_found');
      const input = object(await body(req), 'request');
      keys(input, ['model', 'messages', 'tools', 'stream'], 'request');
      if (input.stream !== undefined && input.stream !== false) throw new InputError('Streaming is unsupported; use stream:false.', 400, 'unsupported_stream');
      const model = string(input.model, 'model', 128), brain = brains.get(model);
      if (!brain) throw new InputError('Requested model is not enabled.', 400, 'model_not_allowed');
      const nativeMessages = messages(input.messages), nativeTools = tools(input.tools);
      const answer = await call(model, nativeMessages, nativeTools, AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]));
      if (controller.signal.aborted) return;
      send(res, 200, {
        id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{index: 0, finish_reason: answer.finishReason, message: {
          role: 'assistant', content: answer.message.content || (answer.message.toolCalls?.length ? null : ''),
          ...(answer.message.toolCalls?.length ? {tool_calls: answer.message.toolCalls.map(c => ({
            id: c.id, type: 'function', function: {name: c.function.name, arguments: JSON.stringify(c.function.arguments)},
          }))} : {}),
        }}],
        usage: {prompt_tokens: answer.usage.input, completion_tokens: answer.usage.output, total_tokens: answer.usage.input + answer.usage.output},
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        if (streaming) { sse(res, anthropicError(error)); res.end(); }
        else fail(res, error, anthropic);
      }
    } finally { if (pingTimer) clearInterval(pingTimer); }
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const cliOptions = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--port', '--models'].includes(args[i]!) || !args[i + 1] || cliOptions.has(args[i]!)) throw new Error('invalid arguments');
      cliOptions.set(args[i]!, args[i + 1]!);
    }
    const port = Number(cliOptions.get('--port') ?? process.env.CLOVA_WRAPPER_PORT ?? 4331);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid port');
    const models = cliOptions.get('--models')?.split(',');
    const server = createWrapper(models ? {allowedModels: models} : {});
    server.on('error', () => { process.stderr.write('{"error":"wrapper_start_failed"}\n'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') process.stderr.write(JSON.stringify({address: address.address, port: address.port}) + '\n');
    });
    const stop = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch { process.stderr.write('{"error":"wrapper_configuration"}\n'); process.exitCode = 2; }
}
