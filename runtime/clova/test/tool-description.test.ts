import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { request, type Server } from 'node:http';
import { Brain } from '../provider.ts';
import { createWrapper } from '../http.ts';
import type { Tool } from '../common.ts';

const wrapperToken = 'synthetic-tool-description-wrapper-token';
const messages = [{ role: 'user' as const, content: '도구 설명 전달을 확인해 줘.' }];
const models = ['HCX-005', 'HCX-007'];

function fixture() {
  const base = resolve('.local/tool-description-tests');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'case-'));
  const key = join(dir, 'native.key'), tokenFile = join(dir, 'wrapper.token');
  writeFileSync(key, 'synthetic-tool-description-native-key', { mode: 0o600 });
  writeFileSync(tokenFile, wrapperToken, { mode: 0o600 });
  const savedKey = process.env.CLOVA_API_KEY_FILE, savedBase = process.env.CLOVA_BASE_URL;
  const originalFetch = globalThis.fetch;
  const captured: { url: string; body: Record<string, any> }[] = [];
  process.env.CLOVA_API_KEY_FILE = key;
  process.env.CLOVA_BASE_URL = 'https://clovastudio.stream.ntruss.com';
  // Every provider fetch is intercepted; no external request can be dispatched.
  globalThis.fetch = async (input, init) => {
    captured.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ status: { code: '20000' }, result: {
      message: { role: 'assistant', content: '모의 응답' }, finishReason: 'stop',
      usage: { promptTokens: 5, completionTokens: 3 },
    } }), { headers: { 'content-type': 'application/json' } });
  };
  return { captured, tokenFile, cleanup() {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.CLOVA_API_KEY_FILE; else process.env.CLOVA_API_KEY_FILE = savedKey;
    if (savedBase === undefined) delete process.env.CLOVA_BASE_URL; else process.env.CLOVA_BASE_URL = savedBase;
    rmSync(dir, { recursive: true, force: true });
  } };
}

test('native 005 and 007 replace empty descriptions with names while preserving valid descriptions and caller tools', async () => {
  const f = fixture();
  try {
    const schema = Object.freeze({ type: 'object', properties: Object.freeze({ path: Object.freeze({ type: 'string' }) }), required: Object.freeze(['path']) });
    const validDescription = '  이 설명의 공백과\n줄바꿈도 원문 그대로 유지해 주세요.  ';
    const input = Object.freeze([
      Object.freeze({ name: 'empty_description', description: '', inputSchema: schema }),
      Object.freeze({ name: 'whitespace_description', description: ' \t\n ', inputSchema: schema }),
      Object.freeze({ name: 'missing_description', inputSchema: schema }),
      Object.freeze({ name: 'null_description', description: null, inputSchema: schema }),
      Object.freeze({ name: 'valid_description', description: validDescription, inputSchema: schema }),
    ]);
    const before = structuredClone(input);
    for (const model of models) {
      await new Brain(`clova:${model}`).call(messages, input as unknown as Tool[], new AbortController().signal);
      const sent = f.captured.at(-1)!;
      assert.equal(sent.url, `https://clovastudio.stream.ntruss.com/v3/chat-completions/${model}`);
      assert.deepEqual(sent.body.tools.map((tool: any) => tool.function.description), [
        'empty_description', 'whitespace_description', 'missing_description', 'null_description', validDescription,
      ], `${model} native descriptions`);
      assert.deepEqual(sent.body.tools.map((tool: any) => tool.function.name), input.map(tool => tool.name));
      for (const tool of sent.body.tools) assert.deepEqual(tool.function.parameters, schema);
      assert.deepEqual(input, before, 'native fallback must not mutate tool descriptions or schemas');
      assert.equal(Object.hasOwn(input[2], 'description'), false);
    }
    assert.equal(f.captured.length, 2);
  } finally { f.cleanup(); }
});

test('requests without tools retain each model native generation shape', async () => {
  const f = fixture();
  try {
    for (const model of models) {
      await new Brain(`clova:${model}`).call(messages, [], new AbortController().signal);
      assert.deepEqual(f.captured.at(-1)!.body, model === 'HCX-005'
        ? { messages, maxTokens: 2048, temperature: 0 }
        : { messages, maxCompletionTokens: 2048, temperature: 0, thinking: { effort: 'none' } });
    }
  } finally { f.cleanup(); }
});

test('HTTP wrapper omitted description is repaired only at the native boundary for both models', async () => {
  const f = fixture();
  let wrapper: Server | undefined;
  try {
    wrapper = createWrapper({ tokenFile: f.tokenFile, allowedModels: models });
    await new Promise<void>((resolveReady, reject) => { wrapper!.once('error', reject); wrapper!.listen(0, '127.0.0.1', resolveReady); });
    const address = wrapper.address();
    assert.ok(address && typeof address !== 'string');
    const tool = { type: 'function', function: { name: 'wrapper_read', parameters: { type: 'object', properties: {} } } };
    const before = structuredClone(tool);
    for (const model of models) {
      const status = await new Promise<number | undefined>((resolveStatus, reject) => {
        // Node HTTP reaches only the local wrapper; its native fetch is mocked above.
        const req = request({ hostname: '127.0.0.1', port: address.port, path: '/v1/chat/completions', method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${wrapperToken}` } }, res => {
          res.resume(); res.once('end', () => resolveStatus(res.statusCode));
          res.once('error', reject);
        });
        req.once('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('Local wrapper timeout')));
        req.end(JSON.stringify({ model, messages, tools: [tool] }));
      });
      assert.equal(status, 200);
      assert.equal(f.captured.at(-1)!.body.tools[0].function.description, 'wrapper_read');
      assert.deepEqual(f.captured.at(-1)!.body.tools[0].function.parameters, tool.function.parameters);
      assert.deepEqual(tool, before);
      assert.equal(Object.hasOwn(tool.function, 'description'), false);
    }
    assert.equal(f.captured.length, 2);
  } finally {
    try {
      if (wrapper?.listening) {
        wrapper.closeAllConnections();
        await new Promise<void>((resolveClosed, reject) => wrapper!.close(error => error ? reject(error) : resolveClosed()));
      }
    } finally { f.cleanup(); }
  }
});
