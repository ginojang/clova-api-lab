import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request, type Server, type ServerResponse} from 'node:http';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseAnthropicRequest, toAnthropicMessage, anthropicEvents} from '../anthropic.ts';
import {createWrapper, type WrapperCallMetrics} from '../http.ts';
import type {Answer} from '../common.ts';

const model = 'HCX-005';
const key = 'anthropic-test-native-private-key', token = 'anthropic-test-wrapper-private-token';
const basic = {model, max_tokens: 2048, messages: [{role: 'user', content: '안녕'}]};
const tool = {name: 'artifact_read', description: 'Read a file.', input_schema: {type: 'object', properties: {path: {type: 'string'}}, required: ['path']}};
const answer: Answer = {message: {role: 'assistant', content: '파일을 읽겠습니다.', toolCalls: [{id: 'tool-one', type: 'function', function: {name: 'artifact_read', arguments: {path: 'hello.txt'}}}]},
  finishReason: 'tool_calls', usage: {input: 13, output: 8, cacheRead: 0, cacheWrite: 0}};

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
}
async function fixture(handler?: (res: ServerResponse, body: any) => void, timeoutMs?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'clova-anthropic-test-'));
  const keyFile = join(dir, 'native.key'), tokenFile = join(dir, 'wrapper.token');
  writeFileSync(keyFile, key, {mode: 0o600}); writeFileSync(tokenFile, token, {mode: 0o600});
  const previous = {key: process.env.CLOVA_API_KEY_FILE, base: process.env.CLOVA_BASE_URL};
  const captured: any[] = [], metrics: WrapperCallMetrics[] = [];
  const native = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); captured.push({body, authorization: req.headers.authorization});
    if (handler) handler(res, body);
    else res.end(JSON.stringify({status: {code: '20000'}, result: {message: answer.message, finishReason: answer.finishReason, usage: {promptTokens: 13, completionTokens: 8}}}));
  });
  const nativeUrl = await listen(native);
  process.env.CLOVA_API_KEY_FILE = keyFile; process.env.CLOVA_BASE_URL = nativeUrl;
  const wrapper = createWrapper({tokenFile, timeoutMs, onCall: m => metrics.push(m)}), url = await listen(wrapper);
  const post = (body: unknown = basic, auth: Record<string, string> = {'x-api-key': token}) => fetch(url + '/v1/messages?beta=true', {
    method: 'POST', headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...auth}, body: JSON.stringify(body),
  });
  return {url, captured, metrics, post, cleanup: async () => {
    await close(wrapper); await close(native);
    if (previous.key === undefined) delete process.env.CLOVA_API_KEY_FILE; else process.env.CLOVA_API_KEY_FILE = previous.key;
    if (previous.base === undefined) delete process.env.CLOVA_BASE_URL; else process.env.CLOVA_BASE_URL = previous.base;
    rmSync(dir, {recursive: true, force: true});
  }};
}
function events(raw: string): any[] {
  return raw.split('\n\n').filter(Boolean).map(part => {
    const name = /^event: (.+)$/m.exec(part)?.[1], value = JSON.parse(/^data: (.+)$/m.exec(part)![1]);
    assert.equal(value.type, name); return value;
  });
}

test('Anthropic text blocks, function history, tool result errors and system blocks translate without losing IDs', () => {
  const parsed = parseAnthropicRequest({...basic, system: [{type: 'text', text: '규칙 하나'}, {type: 'text', text: '규칙 둘'}], tools: [tool],
    thinking: {type: 'disabled'}, temperature: 0, metadata: {user_id: 'client-attribution'}, tool_choice: {type: 'auto'}, messages: [
      {role: 'user', content: [{type: 'text', text: '파일을 읽어라'}]},
      {role: 'assistant', content: [{type: 'text', text: '읽기'}, {type: 'tool_use', id: 'tool-one', name: tool.name, input: {path: 'hello.txt'}}]},
      {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tool-one', is_error: true, content: [{type: 'text', text: 'not_found: use another file'}]}, {type: 'text', text: '다른 파일을 읽어라'}]},
    ]}, [model]);
  assert.equal(parsed.messages[0].content, '규칙 하나\n규칙 둘');
  assert.deepEqual(parsed.tools, [{name: tool.name, description: tool.description, inputSchema: tool.input_schema}]);
  assert.equal(parsed.messages[2].toolCalls![0].id, 'tool-one');
  assert.deepEqual(parsed.messages[2].toolCalls![0].function.arguments, {path: 'hello.txt'});
  assert.equal(parsed.messages[3].toolCallId, 'tool-one');
  assert.deepEqual(JSON.parse(parsed.messages[3].content), {is_error: true, content: 'not_found: use another file'});
  assert.equal(parsed.messages[4].content, '다른 파일을 읽어라');
  assert.equal(JSON.stringify(parsed).includes('client-attribution'), false);
});

test('Anthropic output and SSE preserve tool IDs, JSON arguments, actual usage and all finish reasons', () => {
  const message = toAnthropicMessage(answer, model, 'msg-test');
  assert.equal(message.stop_reason, 'tool_use'); assert.equal(message.model, model);
  assert.deepEqual(message.usage, {input_tokens: 13, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0});
  const stream = [...anthropicEvents(message)];
  assert.deepEqual(stream.map(e => e.type), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop',
    'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal((stream[0].message as any).usage.input_tokens, 13);
  assert.equal((stream[4].content_block as any).id, 'tool-one');
  assert.deepEqual(JSON.parse((stream[5].delta as any).partial_json), {path: 'hello.txt'});
  assert.equal((stream[7].usage as any).output_tokens, 8);
  assert.equal(toAnthropicMessage({...answer, finishReason: 'length'}, model, 'id').stop_reason, 'max_tokens');
  assert.equal(toAnthropicMessage({...answer, message: {role: 'assistant', content: 'done'}, finishReason: 'stop'}, model, 'id').stop_reason, 'end_turn');
});

test('HTTP Anthropic route accepts beta query and either gateway credential header, then shares native Brain', async () => {
  const f = await fixture();
  try {
    const response = await f.post({...basic, tools: [tool], system: 'local system'});
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-clova-compatibility'), 'experimental-text-tools');
    const reply = await response.json() as any;
    assert.equal(reply.type, 'message'); assert.equal(reply.content[1].id, 'tool-one');
    assert.equal(reply.stop_reason, 'tool_use');
    const next = await f.post({...basic, tools: [tool], messages: [...basic.messages,
      {role: 'assistant', content: reply.content}, {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tool-one', content: 'hello'}]},
    ]}, {authorization: `Bearer ${token}`});
    assert.equal(next.status, 200);
    assert.equal(f.captured[0].authorization, `Bearer ${key}`);
    assert.equal(f.captured[0].body.maxTokens, 2048);
    assert.equal(f.captured[1].body.messages[2].toolCallId, 'tool-one');
    assert.equal(f.metrics.length, 2); assert.equal(f.metrics[0].model, model); assert.equal(f.metrics[0].usage?.input, 13);
    assert.deepEqual(Object.keys(f.metrics[0]).sort(), ['durationMs', 'model', 'ok', 'status', 'usage']);
    assert.equal(JSON.stringify(f.metrics).includes(key), false);
  } finally { await f.cleanup(); }
});

test('Anthropic SSE sends a waiting ping, then a complete ordered buffered response', async () => {
  let finish!: () => void;
  const f = await fixture(res => { finish = () => res.end(JSON.stringify({result: {message: answer.message, finishReason: answer.finishReason, usage: {promptTokens: 13, completionTokens: 8}}})); });
  try {
    const response = await f.post({...basic, tools: [tool], stream: true});
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /^text\/event-stream/);
    assert.equal(response.headers.get('x-clova-streaming'), 'buffered-native');
    const reader = response.body!.getReader(), first = await reader.read();
    let raw = new TextDecoder().decode(first.value); assert.equal(events(raw)[0].type, 'ping');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
    finish();
    for (;;) { const part = await reader.read(); if (part.done) break; raw += new TextDecoder().decode(part.value); }
    const stream = events(raw), types = stream.map(e => e.type);
    assert.equal(types[1], 'message_start'); assert.deepEqual(types.slice(-2), ['message_delta', 'message_stop']);
    assert.equal(stream[1].message.usage.input_tokens, 13);
    assert.equal(stream.at(-2).delta.stop_reason, 'tool_use'); assert.equal(stream.at(-2).usage.output_tokens, 8);
    assert.equal(f.captured.length, 1);
  } finally { await f.cleanup(); }
});

test('Unsupported Anthropic capabilities and invalid bodies fail before native requests without echoing values', async () => {
  const f = await fixture();
  try {
    const invalid = [
      {...basic, model: 'secret-model-value'}, {...basic, max_tokens: 4096}, {...basic, max_tokens: 1, tools: [tool]},
      {...basic, thinking: {type: 'enabled', budget_tokens: 1024}}, {...basic, thinking: {type: 'adaptive'}},
      {...basic, output_config: {effort: 'high'}}, {...basic, context_management: {edits: []}}, {...basic, temperature: 0.8},
      {...basic, tool_choice: {type: 'any'}}, {...basic, stop_sequences: ['stop']},
      {...basic, system: [{type: 'text', text: 'secret-prompt-value', cache_control: {type: 'ephemeral'}}]},
      {...basic, tools: [{...tool, defer_loading: true}]},
      {...basic, messages: [{role: 'user', content: [{type: 'image', source: {}}]}]},
      {...basic, messages: [{role: 'assistant', content: [{type: 'thinking', thinking: 'secret-thought-value'}]}]},
      {...basic, api_key: 'secret-api-value'}, null,
    ];
    for (const input of invalid) {
      const response = await f.post(input); assert.equal(response.status, 400);
      const body = await response.json() as any; assert.equal(body.type, 'error'); assert.equal(body.error.type, 'invalid_request_error');
      assert.equal(JSON.stringify(body).includes('secret-'), false);
    }
    const invalidAuth: Record<string, string>[] = [{}, {'x-api-key': key}, {'x-api-key': token, authorization: 'Bearer wrong-token'}];
    for (const auth of invalidAuth) {
      const response = await f.post(basic, auth); assert.equal(response.status, 401);
      const body = await response.json() as any; assert.equal(body.error.type, 'authentication_error');
    }
    assert.equal(f.captured.length, 0); assert.equal(f.metrics.length, 0);
  } finally { await f.cleanup(); }
});

test('Native HTTP errors keep status in JSON and become terminal Anthropic SSE error events without retries', async () => {
  const f = await fixture(res => { res.writeHead(529); res.end(JSON.stringify({secret: key})); });
  try {
    const plain = await f.post(); assert.equal(plain.status, 529);
    const error = await plain.json() as any; assert.equal(error.error.type, 'overloaded_error'); assert.equal(JSON.stringify(error).includes(key), false);
    const streaming = await f.post({...basic, stream: true}); assert.equal(streaming.status, 200);
    const stream = events(await streaming.text()); assert.deepEqual(stream.map(e => e.type), ['ping', 'error']);
    assert.equal(stream[1].error.type, 'overloaded_error'); assert.equal(JSON.stringify(stream).includes(key), false);
    assert.equal(f.captured.length, 2); assert.deepEqual(f.metrics.map(m => m.status), [529, 529]);
  } finally { await f.cleanup(); }
});

test('Closing an Anthropic stream aborts native generation and reports cancellation once', async () => {
  let started!: () => void, closed!: () => void;
  const began = new Promise<void>(resolve => { started = resolve; }), ended = new Promise<void>(resolve => { closed = resolve; });
  const f = await fixture(res => { res.once('close', closed); started(); });
  try {
    const req = request(f.url + '/v1/messages?beta=true', {method: 'POST', headers: {'x-api-key': token}}, res => res.resume());
    req.on('error', () => {}); req.end(JSON.stringify({...basic, stream: true}));
    await began; req.destroy();
    await Promise.race([ended, new Promise((_, reject) => setTimeout(() => reject(new Error('native stream survived disconnect')), 2000).unref())]);
    assert.equal(f.captured.length, 1);
    assert.equal(f.metrics.length, 1); assert.equal(f.metrics[0].status, 499);
  } finally { await f.cleanup(); }
});

test('Anthropic max_tokens reaches native generation and streamed deadlines remain explicit errors', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post({...basic, max_tokens: 512})).status, 200);
    assert.equal(f.captured[0].body.maxTokens, 512);
  } finally { await f.cleanup(); }
  const stalled = await fixture(() => {}, 50);
  try {
    const response = await stalled.post({...basic, stream: true});
    const stream = events(await response.text()); assert.equal(stream.at(-1).type, 'error');
    assert.match(stream.at(-1).error.message, /timed out/); assert.equal(stalled.metrics[0].status, 504);
  } finally { await stalled.cleanup(); }
});
