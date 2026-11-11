import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request, type Server, type IncomingMessage, type ServerResponse} from 'node:http';
import {mkdtempSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createWrapper} from '../http.ts';

const API_KEY = 'native-api-key-only-in-local-tests';
const WRAPPER_TOKEN = 'separate-wrapper-token-only-in-local-tests';
const simpleRequest = {model: 'HCX-005', messages: [{role: 'user', content: '안녕'}]};
const nativeAnswer = (finishReason = 'stop', message: object = {role: 'assistant', content: '로컬 답변'}) => ({
  status: {code: '20000'}, result: {message, finishReason, usage: {promptTokens: 11, completionTokens: 7}},
});
type Captured = {url: string | undefined; headers: IncomingMessage['headers']; body: any};
type Handler = (req: IncomingMessage, res: ServerResponse, input: Captured) => void;
async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function fixture(handler?: Handler, timeoutMs?: number, allowedModels?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'clova-http-test-'));
  const apiKeyFile = join(dir, 'native.key'), tokenFile = join(dir, 'wrapper.token');
  writeFileSync(apiKeyFile, API_KEY, {mode: 0o600});
  writeFileSync(tokenFile, WRAPPER_TOKEN, {mode: 0o600});
  const previous = {key: process.env.CLOVA_API_KEY_FILE, base: process.env.CLOVA_BASE_URL};
  const captured: Captured[] = [];
  const native = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = {url: req.url, headers: req.headers, body: JSON.parse(raw)};
    captured.push(input);
    res.setHeader('content-type', 'application/json');
    if (handler) handler(req, res, input); else res.end(JSON.stringify(nativeAnswer()));
  });
  const nativeUrl = await listen(native);
  process.env.CLOVA_API_KEY_FILE = apiKeyFile;
  process.env.CLOVA_BASE_URL = nativeUrl;
  const wrapper = createWrapper({tokenFile, timeoutMs, ...(allowedModels ? {allowedModels} : {})});
  const url = await listen(wrapper);
  const post = (payload: unknown = simpleRequest, token = WRAPPER_TOKEN) => fetch(`${url}/v1/chat/completions`, {
    method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${token}`}, body: JSON.stringify(payload),
  });
  return {dir, apiKeyFile, tokenFile, nativeUrl, url, captured, post, cleanup: async () => {
    await close(wrapper); await close(native);
    if (previous.key === undefined) delete process.env.CLOVA_API_KEY_FILE; else process.env.CLOVA_API_KEY_FILE = previous.key;
    if (previous.base === undefined) delete process.env.CLOVA_BASE_URL; else process.env.CLOVA_BASE_URL = previous.base;
    rmSync(dir, {recursive: true, force: true});
  }};
}

test('HTTP wrapper authenticates health and models with a token distinct from the native key', async () => {
  const f = await fixture();
  try {
    for (const path of ['/health', '/v1/models']) {
      assert.equal((await fetch(f.url + path)).status, 401);
      const rejected = await fetch(f.url + path, {headers: {authorization: `Bearer ${API_KEY}`}});
      assert.equal(rejected.status, 401); assert.equal((await rejected.text()).includes(API_KEY), false);
    }
    const headers = {authorization: `Bearer ${WRAPPER_TOKEN}`};
    assert.deepEqual(await (await fetch(f.url + '/health', {headers})).json(), {status: 'ok', version: '1.0.0'});
    const models = await (await fetch(f.url + '/v1/models', {headers})).json() as any;
    assert.deepEqual(models.data.map((m: any) => m.id), ['HCX-005']);
    assert.equal(f.captured.length, 0);
    chmodSync(f.tokenFile, 0o644);
    assert.throws(() => createWrapper({tokenFile: f.tokenFile}), /600/);
    chmodSync(f.tokenFile, 0o600); writeFileSync(f.tokenFile, API_KEY);
    assert.throws(() => createWrapper({tokenFile: f.tokenFile}), /must differ/);
  } finally { await f.cleanup(); }
});

test('OpenAI tool history and native CLOVA function calls preserve IDs, schemas, usage and finish reason', async () => {
  let turn = 0;
  const f = await fixture((_req, res) => {
    res.end(JSON.stringify(++turn === 1 ? nativeAnswer('tool_calls', {
      role: 'assistant', content: '', toolCalls: [{id: 'call-한글-1', type: 'function', function: {name: 'artifact_read', arguments: {path: 'hello.txt'}}}],
    }) : nativeAnswer()));
  });
  try {
    const tools = [{type: 'function', function: {name: 'artifact_read', description: 'Read a file.', parameters: {
      type: 'object', properties: {path: {type: 'string'}}, required: ['path'], additionalProperties: false,
    }}}];
    const firstResponse = await f.post({...simpleRequest, tools, stream: false});
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as any;
    assert.match(first.id, /^chatcmpl-/); assert.equal(first.object, 'chat.completion');
    assert.equal(first.model, 'HCX-005'); assert.equal(first.choices[0].finish_reason, 'tool_calls');
    assert.deepEqual(first.usage, {prompt_tokens: 11, completion_tokens: 7, total_tokens: 18});
    const assistant = first.choices[0].message;
    assert.equal(assistant.content, null); assert.equal(assistant.tool_calls[0].id, 'call-한글-1');
    assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), {path: 'hello.txt'});
    const second = await (await f.post({model: 'HCX-005', tools, messages: [
      {role: 'system', content: 'Use the supplied tools.'}, ...simpleRequest.messages, assistant,
      {role: 'tool', tool_call_id: 'call-한글-1', content: '{"text":"hello"}'},
    ]})).json() as any;
    assert.equal(second.choices[0].finish_reason, 'stop'); assert.equal(second.choices[0].message.content, '로컬 답변');
    assert.equal(f.captured.length, 2);
    for (const call of f.captured) {
      assert.equal(call.url, '/v3/chat-completions/HCX-005');
      assert.equal(call.headers.authorization, `Bearer ${API_KEY}`);
      assert.equal(JSON.stringify(call).includes(WRAPPER_TOKEN), false);
      assert.equal(call.body.maxTokens, 2048); assert.equal(call.body.temperature, 0);
      assert.deepEqual(call.body.tools, tools);
    }
    const nativeHistory = f.captured[1].body.messages;
    assert.equal(nativeHistory[2].content, '');
    assert.deepEqual(nativeHistory[2].toolCalls[0].function.arguments, {path: 'hello.txt'});
    assert.equal(nativeHistory[3].toolCallId, 'call-한글-1');
    assert.equal(nativeHistory[3].tool_call_id, undefined);
  } finally { await f.cleanup(); }
});

test('Invalid inputs, streaming, model or credential injection and unsupported sampling fail before native HTTP', async () => {
  const f = await fixture();
  try {
    const cases: unknown[] = [null, [], {...simpleRequest, stream: true}, {...simpleRequest, stream: 'false'},
      {...simpleRequest, model: 'another-model'}, {...simpleRequest, temperature: 0.5}, {...simpleRequest, max_tokens: 100},
      {...simpleRequest, api_key: 'request-secret'}, {...simpleRequest, base_url: 'https://attacker.invalid'},
      {...simpleRequest, messages: []}, {...simpleRequest, messages: [{role: 'user', content: [{type: 'image_url'}]}]},
      {...simpleRequest, messages: [{role: 'tool', content: 'result'}]},
      {...simpleRequest, messages: [{role: 'assistant', content: null, tool_calls: [
        {id: 'one', type: 'function', function: {name: 'read', arguments: '{bad'}},
      ]}]},
      {...simpleRequest, messages: [{role: 'assistant', content: null, tool_calls: [
        {id: 'one', type: 'function', function: {name: 'read', arguments: '[]'}},
      ]}]},
    ];
    for (const input of cases) {
      const response = await f.post(input); assert.equal(response.status, 400);
      const error = await response.text(); assert.equal(error.includes('request-secret'), false); assert.equal(error.includes('attacker.invalid'), false);
    }
    const invalidJson = await fetch(f.url + '/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${WRAPPER_TOKEN}`}, body: '{bad'});
    assert.equal(invalidJson.status, 400);
    const huge = await f.post({...simpleRequest, messages: [{role: 'user', content: 'x'.repeat(1024 * 1024)}]});
    assert.equal(huge.status, 413);
    assert.equal(f.captured.length, 0);
  } finally { await f.cleanup(); }
});

test('Chunked requests also enforce the 1 MiB limit without reaching CLOVA', async () => {
  const f = await fixture();
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(f.url + '/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${WRAPPER_TOKEN}`}}, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode!));
      });
      req.on('error', reject);
      for (let n = 0; n < 5; n++) req.write('x'.repeat(256 * 1024));
      req.end();
    });
    assert.equal(status, 413); assert.equal(f.captured.length, 0);
  } finally { await f.cleanup(); }
});

test('Native statuses survive without retries or sensitive error bodies; malformed responses become 502', async () => {
  let mode: number | string = 429;
  const f = await fixture((_req, res) => {
    if (typeof mode === 'number') { res.writeHead(mode); res.end(JSON.stringify({secret: API_KEY, token: WRAPPER_TOKEN})); }
    else if (mode === 'json') res.end('{broken native json');
    else if (mode === 'usage') res.end(JSON.stringify({result: {message: {role: 'assistant', content: API_KEY}, finishReason: 'stop'}}));
    else res.end(JSON.stringify(nativeAnswer('length')));
  });
  try {
    for (const status of [429, 529, 401]) {
      mode = status;
      const before = f.captured.length, response = await f.post();
      assert.equal(response.status, status); assert.equal(f.captured.length, before + 1);
      const text = await response.text(); assert.equal(text.includes(API_KEY), false); assert.equal(text.includes(WRAPPER_TOKEN), false);
    }
    for (const value of ['json', 'usage']) { mode = value; assert.equal((await f.post()).status, 502); }
    mode = 'length';
    const truncated = await (await f.post()).json() as any;
    assert.equal(truncated.choices[0].finish_reason, 'length'); assert.equal(truncated.usage.total_tokens, 18);
    assert.equal(f.captured.length, 6);
  } finally { await f.cleanup(); }
});

test('Wrapper deadline cancels native HTTP and returns 504 once', async () => {
  let closed!: () => void;
  const upstreamClosed = new Promise<void>(resolve => { closed = resolve; });
  const f = await fixture((_req, res) => { res.once('close', closed); }, 100);
  try {
    const response = await f.post(); assert.equal(response.status, 504);
    assert.equal((await response.json() as any).error.code, 'timeout');
    await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('native request not cancelled')), 2000).unref())]);
    assert.equal(f.captured.length, 1);
  } finally { await f.cleanup(); }
});

test('Disconnecting the HTTP client aborts the native request without a retry', async () => {
  let started!: () => void, closed!: () => void;
  const upstreamStarted = new Promise<void>(resolve => { started = resolve; });
  const upstreamClosed = new Promise<void>(resolve => { closed = resolve; });
  const f = await fixture((_req, res) => { res.once('close', closed); started(); });
  try {
    const req = request(f.url + '/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${WRAPPER_TOKEN}`, 'content-type': 'application/json'}});
    req.on('error', () => {}); req.end(JSON.stringify(simpleRequest));
    await upstreamStarted; req.destroy();
    await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('native request survived disconnect')), 2000).unref())]);
    assert.equal(f.captured.length, 1);
  } finally { await f.cleanup(); }
});

test('Standalone wrapper binds loopback and prints only address and port to stderr', async () => {
  const f = await fixture();
  const proc = spawn(process.execPath, [resolve('runtime/clova/http.ts'), '--port', '0'], {
    env: {...process.env, CLOVA_API_KEY_FILE: f.apiKeyFile, CLOVA_WRAPPER_TOKEN_FILE: f.tokenFile, CLOVA_BASE_URL: f.nativeUrl}, stdio: 'pipe',
  });
  let stdout = ''; proc.stdout.on('data', data => { stdout += data; });
  const exited = new Promise<number | null>(resolve => proc.once('exit', resolve));
  const watchdog = setTimeout(() => proc.kill('SIGKILL'), 5000);
  try {
    const ready = await new Promise<any>((resolve, reject) => {
      proc.once('error', reject);
      createInterface({input: proc.stderr}).once('line', line => { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
    });
    assert.deepEqual(Object.keys(ready).sort(), ['address', 'port']); assert.equal(ready.address, '127.0.0.1'); assert.ok(ready.port > 0);
    const response = await fetch(`http://${ready.address}:${ready.port}/v1/models`, {headers: {authorization: `Bearer ${WRAPPER_TOKEN}`}});
    assert.equal(response.status, 200);
    proc.kill('SIGTERM'); assert.equal(await exited, 0); assert.equal(stdout, ''); assert.equal(f.captured.length, 0);
  } finally { clearTimeout(watchdog); if (proc.exitCode === null) { proc.kill('SIGKILL'); await exited; } await f.cleanup(); }
});

// Explicit model registration preserves the 005 default and exercises both adapter routes.
test('HCX-007 wrapper forwards native generation fields and removes thinkingContent', async () => {
  const f = await fixture((_req, res) => res.end(JSON.stringify(nativeAnswer('stop', {role: 'assistant', content: '일곱 모델 답변', thinkingContent: 'do-not-replay-native-thinking'}))), undefined, ['HCX-005', 'HCX-007']);
  try {
    const response = await f.post({model: 'HCX-007', messages: [{role: 'user', content: '도와줘'}]});
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.choices[0].message.content, '일곱 모델 답변');
    assert.ok(!JSON.stringify(body).includes('thinkingContent'));
    assert.equal(f.captured[0].url, '/v3/chat-completions/HCX-007');
    assert.equal(f.captured[0].body.maxTokens, undefined);
    assert.equal(f.captured[0].body.maxCompletionTokens, 2048);
    assert.deepEqual(f.captured[0].body.thinking, {effort: 'none'});
    const anthropic = await fetch(f.url + '/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${WRAPPER_TOKEN}`}, body: JSON.stringify({model: 'HCX-007', max_tokens: 1024, messages: [{role: 'user', content: '도와줘'}]})});
    assert.equal(anthropic.status, 200);
    assert.equal(f.captured[1].body.maxCompletionTokens, 1024);
    assert.equal(f.captured[1].body.maxTokens, undefined);
    assert.ok(!(await anthropic.text()).includes('do-not-replay-native-thinking'));
  } finally { await f.cleanup(); }
});
