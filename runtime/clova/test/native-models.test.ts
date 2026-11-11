import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {Brain} from '../provider.ts';

test('005 keeps its wire contract; 007 selects native token/thinking fields and never replays thinkingContent', async () => {
  const base = resolve('.local/native-model-tests'); mkdirSync(base, {recursive: true});
  const dir = mkdtempSync(join(base, 'wire-')), key = join(dir, 'test.key');
  writeFileSync(key, 'synthetic-native-model-test-key', {mode: 0o600});
  const savedKey = process.env.CLOVA_API_KEY_FILE, savedBase = process.env.CLOVA_BASE_URL, originalFetch = globalThis.fetch;
  process.env.CLOVA_API_KEY_FILE = key; process.env.CLOVA_BASE_URL = 'https://clovastudio.stream.ntruss.com';
  const requests: {url: string; body: any}[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({url: String(input), body: JSON.parse(String(init?.body))});
    return new Response(JSON.stringify({status: {code: '20000'}, result: {message: {role: 'assistant', content: '확인했어요.', thinkingContent: 'provider internal field must not become history'}, finishReason: 'stop', usage: {promptTokens: 11, completionTokens: 7, completionTokensDetails: {thinkingTokens: 3}}}}), {headers: {'content-type': 'application/json'}});
  };
  try {
    const input = [{role: 'user' as const, content: '도와줘'}];
    const old = await new Brain('clova:HCX-005').call(input, [], new AbortController().signal, {maxTokens: 1024});
    const brain = new Brain('clova:HCX-007');
    const modern = await brain.call(input, [], new AbortController().signal, {maxTokens: 1024});
    await brain.call([...input, modern.message, {role: 'user', content: '계속해'}], [], new AbortController().signal, {maxTokens: 1024});
    assert.equal(requests[0].body.maxTokens, 1024); assert.equal(requests[0].body.maxCompletionTokens, undefined); assert.equal(requests[0].body.thinking, undefined);
    assert.ok(requests[1].url.endsWith('/HCX-007')); assert.equal(requests[1].body.maxTokens, undefined); assert.equal(requests[1].body.maxCompletionTokens, 1024);
    assert.deepEqual(requests[1].body.thinking, {effort: 'none'}); assert.equal(requests[1].body.temperature, 0);
    assert.deepEqual(modern.message, {role: 'assistant', content: '확인했어요.'}); assert.deepEqual(old.message, modern.message);
    assert.ok(!JSON.stringify(requests[2].body).includes('thinkingContent'));
    assert.deepEqual(modern.usage, {input: 11, output: 7, cacheRead: 0, cacheWrite: 0});
    const format = {type: 'json' as const, schema: {type: 'object', properties: {reply: {type: 'string'}}, required: ['reply']}};
    await brain.call(input, [], new AbortController().signal, {maxTokens: 2048, responseFormat: format});
    assert.deepEqual(requests[3].body.responseFormat, format);
    assert.equal(requests[3].body.maxCompletionTokens, 2048);
    assert.deepEqual(requests[3].body.thinking, {effort: 'none'});
    assert.equal(requests[3].body.maxTokens, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedKey === undefined) delete process.env.CLOVA_API_KEY_FILE; else process.env.CLOVA_API_KEY_FILE = savedKey;
    if (savedBase === undefined) delete process.env.CLOVA_BASE_URL; else process.env.CLOVA_BASE_URL = savedBase;
    rmSync(dir, {recursive: true, force: true});
  }
});
