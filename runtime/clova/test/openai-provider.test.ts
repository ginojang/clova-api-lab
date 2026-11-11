import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {mkdtempSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Brain} from '../provider.ts';
import {Fault, redact, type Message, type Tool} from '../common.ts';
import {MODE2_PROVIDERS, mode2ProviderForModel, type Mode2Provider} from '../providers.ts';

const TEST_KEY = 'mode2-private-credential-local-tests-only';
const tool: Tool = {name: 'clova__artifact_read', description: 'Read one workspace file.', inputSchema: {
  type: 'object', properties: {path: {type: 'string'}}, required: ['path'], additionalProperties: false,
}};
const messages: Message[] = [{role: 'system', content: 'Use the supplied tools.'}, {role: 'user', content: 'Read 테스트.txt'}];
const completion = (message: object = {role: 'assistant', content: '완료'}, finishReason = 'stop') => ({
  choices: [{message, finish_reason: finishReason}],
  usage: {prompt_tokens: 11, completion_tokens: 7, prompt_tokens_details: {cached_tokens: 3}, completion_tokens_details: {reasoning_tokens: 4}},
});
type Captured = {path: string | undefined; headers: IncomingMessage['headers']; body: any};
async function fixture(provider: Mode2Provider, handler?: (res: ServerResponse, request: Captured) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'mode2-provider-test-'));
  const keyFile = join(dir, 'credential');
  writeFileSync(keyFile, TEST_KEY, {mode: 0o600});
  const previous = [provider.keyFileEnv, provider.baseUrlEnv].map(name => [name, process.env[name]] as const);
  const captured: Captured[] = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = {path: req.url, headers: req.headers, body: JSON.parse(raw)};
    captured.push(request);
    res.setHeader('content-type', 'application/json');
    if (handler) handler(res, request); else res.end(JSON.stringify(completion()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/test/v1`;
  process.env[provider.keyFileEnv] = keyFile;
  process.env[provider.baseUrlEnv] = baseUrl;
  return {captured, keyFile, baseUrl, cleanup: async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, {recursive: true, force: true});
  }};
}

for (const provider of MODE2_PROVIDERS) {
  test(`${provider.id}: native HTTP tool round-trip preserves arguments, IDs, reasoning and disjoint usage`, async () => {
    let turn = 0;
    const reasoning = provider.id === 'zai' ? {reasoning_content: 'private tool context'} : provider.id === 'groq' ? {reasoning: 'private tool context'} : {
      reasoning: 'private tool context', reasoning_details: [{type: 'reasoning.encrypted', data: 'opaque', id: 'r1', index: 0}],
    };
    const f = await fixture(provider, res => {
      res.end(JSON.stringify(++turn === 1 ? completion({role: 'assistant', content: null, ...reasoning,
        tool_calls: [{id: 'call-one', type: 'function', function: {name: tool.name,
          arguments: provider.id === 'zai' ? {path: '테스트.txt'} : '{"path":"테스트.txt"}'}}],
      }, 'tool_calls') : completion()));
    });
    try {
      const brain = new Brain(provider.models[0]!.id);
      const first = await brain.call(messages, [tool], new AbortController().signal);
      assert.equal(first.finishReason, 'tool_calls');
      assert.equal(first.message.content, '');
      assert.deepEqual(first.message.toolCalls?.[0]?.function.arguments, {path: '테스트.txt'});
      assert.deepEqual(first.usage, {input: 8, output: 7, cacheRead: 3, cacheWrite: 0});
      const second = await brain.call([...messages, first.message, {role: 'tool', toolCallId: 'call-one', content: '{"text":"파일 내용"}'}], [tool], new AbortController().signal);
      assert.equal(second.message.content, '완료');
      assert.equal(second.finishReason, 'stop');
      assert.equal(f.captured.length, 2);
      for (const request of f.captured) {
        assert.equal(request.path, '/test/v1/chat/completions');
        assert.equal(request.headers.authorization, `Bearer ${TEST_KEY}`);
        assert.equal(request.body.model, provider.models[0]!.id.slice(provider.id.length + 1));
        assert.equal(request.body.stream, false);
        assert.equal(request.body.temperature, 0);
        assert.deepEqual(request.body.tools, [{type: 'function', function: {name: tool.name, description: tool.description, parameters: tool.inputSchema}}]);
        assert.equal(request.body.tool_choice, 'auto');
        assert.equal(request.body.models, undefined);
        if (provider.id === 'groq') {
          assert.equal(request.body.max_completion_tokens, 2048); assert.equal(request.body.max_tokens, undefined);
          assert.equal(request.body.reasoning_effort, 'low'); assert.equal(request.body.include_reasoning, true);
          assert.equal(request.body.reasoning_format, undefined);
        } else {
          assert.equal(request.body.max_tokens, 2048);
          if (provider.id === 'openrouter') assert.deepEqual(request.body.provider, {
            require_parameters: true, allow_fallbacks: false, max_price: {prompt: 0, completion: 0, request: 0},
          });
          else assert.deepEqual(request.body.thinking, {type: 'disabled'});
        }
      }
      const history = f.captured[1]!.body.messages;
      assert.deepEqual(history[2], {role: 'assistant', content: null, ...reasoning,
        tool_calls: [{id: 'call-one', type: 'function', function: {name: tool.name, arguments: '{"path":"테스트.txt"}'}}]});
      assert.deepEqual(history[3], {role: 'tool', tool_call_id: 'call-one', content: '{"text":"파일 내용"}'});
      assert.equal(Object.hasOwn(history[2], 'providerReasoning'), false);
      assert.equal(redact(TEST_KEY), '***');
    } finally { await f.cleanup(); }
  });
}

test('fixed catalog rejects paid/random models and unsafe URL/credential configuration before HTTP', async () => {
  for (const candidate of ['openrouter:cohere/north-mini-code', 'openrouter:openrouter/free', 'groq:other', 'zai:glm-4.7-flashx']) {
    assert.equal(mode2ProviderForModel(candidate), undefined);
    assert.throws(() => new Brain(candidate), (error: unknown) => error instanceof Fault && error.code === 'configuration');
  }
  const provider = MODE2_PROVIDERS[0]!;
  const f = await fixture(provider);
  try {
    for (const url of ['https://external.invalid/private', 'http://127.0.0.1.external.invalid', 'file:///private',
      'http://user:secret@127.0.0.1/', 'http://127.0.0.1/?token=secret', 'http://127.0.0.1/#private', 'invalid-secret-url']) {
      process.env[provider.baseUrlEnv] = url;
      assert.throws(() => new Brain(provider.models[0]!.id), (error: unknown) => {
        assert.ok(error instanceof Fault); assert.equal(error.code, 'configuration'); assert.equal(error.message.includes(url), false); return true;
      });
    }
    process.env[provider.baseUrlEnv] = f.baseUrl;
    delete process.env[provider.keyFileEnv];
    assert.throws(() => new Brain(provider.models[0]!.id), /GROQ_API_KEY_FILE is required/);
    process.env[provider.keyFileEnv] = '/missing-private-credential-path';
    assert.throws(() => new Brain(provider.models[0]!.id), (error: unknown) => error instanceof Fault && !error.message.includes('/missing-private'));
    process.env[provider.keyFileEnv] = f.keyFile;
    chmodSync(f.keyFile, 0o644);
    assert.throws(() => new Brain(provider.models[0]!.id), /600/);
    chmodSync(f.keyFile, 0o600); writeFileSync(f.keyFile, '');
    assert.throws(() => new Brain(provider.models[0]!.id), /empty/);
    assert.equal(f.captured.length, 0);
  } finally { await f.cleanup(); }
});

test('HTTP failures and redirects expose neither response secrets nor credential-bearing URLs and never retry', async () => {
  const provider = MODE2_PROVIDERS[1]!;
  let status = 429;
  const f = await fixture(provider, res => {
    res.writeHead(status, {location: '/should-not-follow'});
    res.end(JSON.stringify({error: {message: TEST_KEY}}));
  });
  try {
    const brain = new Brain(provider.models[0]!.id);
    for (status of [429, 503, 401, 307]) {
      const before = f.captured.length;
      await assert.rejects(brain.call(messages, [], new AbortController().signal), (error: unknown) => {
        assert.ok(error instanceof Fault); assert.equal(error.code, 'api_error');
        assert.equal(error.status, status === 307 ? 502 : status);
        assert.equal(error.message.includes(TEST_KEY), false); assert.equal(error.message.includes(f.baseUrl), false); return true;
      });
      assert.equal(f.captured.length, before + 1);
    }
  } finally { await f.cleanup(); }
});

test('malformed/unsupported tool responses retain billed usage while invalid counters are rejected', async () => {
  const provider = MODE2_PROVIDERS[2]!;
  let value: unknown;
  const f = await fixture(provider, res => res.end(JSON.stringify(value)));
  try {
    const brain = new Brain(provider.models[0]!.id);
    const call = () => brain.call(messages, [tool], new AbortController().signal);
    const toolMessage = (args: unknown) => ({role: 'assistant', content: null, tool_calls: [{id: 'one', type: 'function', function: {name: tool.name, arguments: args}}]});
    for (const bad of [completion(toolMessage('{bad'), 'tool_calls'), completion(toolMessage('[]'), 'tool_calls'),
      completion(toolMessage(null), 'tool_calls'), completion(toolMessage({}), 'stop'),
      completion({role: 'assistant', content: '', tool_calls: []}, 'tool_calls'),
      completion({role: 'assistant', content: 'x'}, 'content_filter'),
      completion({...toolMessage({}), tool_calls: [toolMessage({}).tool_calls[0], toolMessage({}).tool_calls[0]]}, 'tool_calls')]) {
      value = bad;
      await assert.rejects(call(), (error: unknown) => {
        assert.ok(error instanceof Fault); assert.equal(error.code, 'api_error');
        assert.deepEqual(error.usage, {input: 8, output: 7, cacheRead: 3, cacheWrite: 0}); return true;
      });
    }
    for (const usage of [undefined, {prompt_tokens: -1, completion_tokens: 1}, {prompt_tokens: 1.5, completion_tokens: 1},
      {prompt_tokens: 1, completion_tokens: '1'}, {prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: {cached_tokens: 2}},
      {prompt_tokens: 3, completion_tokens: 1, prompt_tokens_details: {cached_tokens: 2, cache_write_tokens: 2}},
      {prompt_tokens: 3, completion_tokens: 1, prompt_tokens_details: {cache_write_tokens: -1}},
      {prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: {cached_tokens: -1}}]) {
      value = {...completion(), usage};
      await assert.rejects(call(), (error: unknown) => error instanceof Fault && error.code === 'api_error');
    }
    value = completion({role: 'assistant', content: 'partial'}, 'length');
    assert.equal((await call()).finishReason, 'length');
    value = {...completion(), usage: {prompt_tokens: 11, completion_tokens: 7}};
    assert.deepEqual((await call()).usage, {input: 11, output: 7, cacheRead: 0, cacheWrite: 0});
    value = {...completion(), usage: {prompt_tokens: 11, completion_tokens: 7, prompt_tokens_details: {cached_tokens: 3, cache_write_tokens: 2}}};
    assert.deepEqual((await call()).usage, {input: 6, output: 7, cacheRead: 3, cacheWrite: 2});
    value = completion({role: 'assistant', tool_calls: toolMessage({}).tool_calls}, 'tool_calls');
    assert.equal((await call()).message.content, '');
  } finally { await f.cleanup(); }
});

test('cancellation and timeout abort pending HTTP including a stalled response body', async () => {
  const provider = MODE2_PROVIDERS[0]!;
  let started!: () => void;
  let bodyStarted = false;
  const f = await fixture(provider, res => {
    if (bodyStarted) { res.writeHead(200); res.write('{'); }
    started();
  });
  try {
    const brain = new Brain(provider.models[0]!.id);
    for (const kind of ['cancel', 'timeout', 'body-timeout']) {
      bodyStarted = kind === 'body-timeout';
      const begin = new Promise<void>(resolve => { started = resolve; });
      const controller = new AbortController();
      const pending = brain.call(messages, [], controller.signal);
      const rejected = assert.rejects(pending, (error: unknown) => error instanceof Fault && error.code === (kind === 'cancel' ? 'interrupted' : 'timeout'));
      await begin;
      controller.abort(kind === 'cancel' ? new Error('private cancellation detail') : new DOMException('deadline', 'TimeoutError'));
      await rejected;
    }
    const before = f.captured.length;
    await assert.rejects(brain.call(messages, [], AbortSignal.abort(new Error(TEST_KEY))), (error: unknown) => error instanceof Fault && error.code === 'interrupted' && !error.message.includes(TEST_KEY));
    await assert.rejects(brain.call(messages, [], new AbortController().signal, {maxTokens: 2049}), (error: unknown) => error instanceof Fault && error.code === 'invalid_argument');
    assert.equal(f.captured.length, before);
  } finally { await f.cleanup(); }
});
