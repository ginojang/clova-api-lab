import test from 'node:test';
import assert from 'node:assert/strict';
import { clovaGenerationConfig, type ClovaThinkingEffort, type ClovaResponseFormat } from '../clova-model-config.ts';
import { Fault } from '../common.ts';

test('HCX-005 preserves the existing default and explicit request settings', () => {
  assert.deepEqual(clovaGenerationConfig('clova:HCX-005'), { maxTokens: 2048, temperature: 0 });
  assert.deepEqual(clovaGenerationConfig('HCX-005', { maxTokens: 1024 }), { maxTokens: 1024, temperature: 0 });
  assert.deepEqual(clovaGenerationConfig('HCX-005', { maxTokens: 1 }), { maxTokens: 1, temperature: 0 });
});

test('HCX-007 uses the completion budget field and explicitly disables thinking', () => {
  const expected = { maxCompletionTokens: 2048, temperature: 0, thinking: { effort: 'none' } };
  assert.deepEqual(clovaGenerationConfig('clova:HCX-007'), expected);
  assert.deepEqual(clovaGenerationConfig('HCX-007'), expected);
  const config = clovaGenerationConfig('HCX-007', { maxTokens: 1024 });
  assert.deepEqual(config, { maxCompletionTokens: 1024, temperature: 0, thinking: { effort: 'none' } });
  assert.equal(Object.hasOwn(config, 'maxTokens'), false);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(config)), 'maxTokens'), false);
});

test('other native names keep previous request shape rather than silently adopting 007 options', () => {
  for (const model of ['HCX-DASH-002', 'clova:HCX-003', 'clova:HCX-DASH-001', 'HCX-UNKNOWN', 'HCX-007-custom']) {
    assert.deepEqual(clovaGenerationConfig(model, { maxTokens: 1536 }), { maxTokens: 1536, temperature: 0 }, model);
  }
});

test('the existing lab token policy is the same for both models', () => {
  for (const model of ['HCX-005', 'HCX-007']) {
    for (const value of [0, -1, 2049, 32768, 1.5, NaN, Infinity, '1024']) {
      assert.throws(() => clovaGenerationConfig(model, { maxTokens: value as number }), (error: unknown) =>
        error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('1 to 2048'));
    }
    assert.equal(clovaGenerationConfig(model, { maxTokens: 2048 }).temperature, 0);
  }
});

test('tool calls retain the existing minimum token budget while 007 thinking stays off', () => {
  for (const model of ['clova:HCX-005', 'clova:HCX-007']) {
    assert.throws(() => clovaGenerationConfig(model, { maxTokens: 1023 }, 1), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('at least 1024'));
    assert.doesNotThrow(() => clovaGenerationConfig(model, { maxTokens: 1024 }, 1));
    assert.doesNotThrow(() => clovaGenerationConfig(model, { maxTokens: 512 }, 0));
  }
  assert.deepEqual(clovaGenerationConfig('HCX-007', { maxTokens: 1024 }, 2).thinking, { effort: 'none' });
});

test('malformed native model identifiers and arguments fail explicitly', () => {
  for (const model of ['', 'clova:', 'clova:HCX-007/other', 'openrouter:model', 'HCX 007', '../HCX-007']) {
    assert.throws(() => clovaGenerationConfig(model), (error: unknown) => error instanceof Fault && error.code === 'configuration');
  }
  for (const count of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => clovaGenerationConfig('HCX-007', {}, count), (error: unknown) => error instanceof Fault && error.code === 'invalid_argument');
  }
});

test('the pure helper does not mutate or reuse caller-owned generation objects', () => {
  const generation = Object.freeze({ maxTokens: 1536 });
  const first = clovaGenerationConfig('HCX-007', generation);
  const second = clovaGenerationConfig('HCX-007', generation);
  assert.deepEqual(generation, { maxTokens: 1536 });
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.thinking, second.thinking);
});

test('007 accepts each explicit effort while preserving temperature and the lab budget', () => {
  for (const thinkingEffort of ['none', 'low', 'medium', 'high'] as const) {
    assert.deepEqual(clovaGenerationConfig('clova:HCX-007', { maxTokens: 2048, thinkingEffort }), {
      maxCompletionTokens: 2048, temperature: 0, thinking: { effort: thinkingEffort },
    });
    // Provider defaults are not a documented effort-dependent minimum.
    assert.equal(clovaGenerationConfig('HCX-007', { maxTokens: 1, thinkingEffort }).maxCompletionTokens, 1);
    assert.throws(() => clovaGenerationConfig('HCX-007', { maxTokens: 5120, thinkingEffort }), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('1 to 2048'));
  }
});

test('an explicit thinking option is rejected on other models, including explicit none', () => {
  for (const model of ['HCX-005', 'clova:HCX-DASH-002', 'HCX-007-custom']) {
    for (const thinkingEffort of ['none', 'low', 'medium', 'high'] as const) {
      assert.throws(() => clovaGenerationConfig(model, { thinkingEffort }), (error: unknown) =>
        error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('only for HCX-007'));
    }
  }
  assert.deepEqual(clovaGenerationConfig('HCX-005', { thinkingEffort: undefined }), { maxTokens: 2048, temperature: 0 });
});

test('invalid effort values do not silently become none or service defaults', () => {
  for (const thinkingEffort of ['', 'LOW', 'auto', 'minimal', 0, false, null]) {
    assert.throws(() => clovaGenerationConfig('HCX-007', { thinkingEffort: thinkingEffort as ClovaThinkingEffort }), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('must be none, low, medium, or high'));
  }
});

test('thinking and function calling cannot be combined; none still allows tools', () => {
  for (const thinkingEffort of ['low', 'medium', 'high'] as const) {
    assert.throws(() => clovaGenerationConfig('HCX-007', { maxTokens: 2048, thinkingEffort }, 1), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('cannot be combined'));
  }
  assert.deepEqual(clovaGenerationConfig('HCX-007', { maxTokens: 1024, thinkingEffort: 'none' }, 1).thinking, { effort: 'none' });
});

test('native structured output uses the explicit schema with default or explicit none', () => {
  const responseFormat: ClovaResponseFormat = {
    type: 'json', schema: { type: 'object', properties: { reply: { type: 'string' } }, required: ['reply'] },
  };
  for (const thinkingEffort of [undefined, 'none'] as const) {
    assert.deepEqual(clovaGenerationConfig('clova:HCX-007', { maxTokens: 1536, thinkingEffort, responseFormat }), {
      maxCompletionTokens: 1536, temperature: 0, thinking: { effort: 'none' }, responseFormat,
    });
  }
});

test('structured output cannot be used by other models or alongside thinking or tools', () => {
  const responseFormat: ClovaResponseFormat = { type: 'json', schema: {} };
  for (const model of ['HCX-005', 'HCX-DASH-002', 'clova:HCX-007-custom']) {
    assert.throws(() => clovaGenerationConfig(model, { responseFormat }), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('only for HCX-007'));
  }
  for (const thinkingEffort of ['low', 'medium', 'high'] as const) {
    assert.throws(() => clovaGenerationConfig('HCX-007', { responseFormat, thinkingEffort }), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('requires thinkingEffort none'));
  }
  assert.throws(() => clovaGenerationConfig('HCX-007', { responseFormat }, 1), (error: unknown) =>
    error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('no function calling'));
});

test('invalid response format and non-object schema are rejected before transport', () => {
  for (const responseFormat of [null, [], 'json', {}, { type: 'json_schema', schema: {} }, { type: 'json' },
    { type: 'json', schema: null }, { type: 'json', schema: [] }, { type: 'json', schema: 'object' },
    { type: 'json', schema: true }, { type: 'json', schema: 42 }]) {
    assert.throws(() => clovaGenerationConfig('HCX-007', { responseFormat: responseFormat as ClovaResponseFormat }), (error: unknown) =>
      error instanceof Fault && error.code === 'invalid_argument' && error.message.includes('type json and an object schema'));
  }
});

test('schema is deeply copied without guessing validation-keyword support', () => {
  const schema = {
    type: 'object', properties: { reply: { type: 'string', pattern: '^test', description: 'test' } },
    additionalProperties: false, required: ['reply'], customMetadata: { source: 'caller' },
  };
  const generation = { responseFormat: { type: 'json' as const, schema } };
  const first = clovaGenerationConfig('HCX-007', generation);
  const second = clovaGenerationConfig('HCX-007', generation);
  assert.deepEqual(first.responseFormat, generation.responseFormat);
  assert.notEqual(first.responseFormat, generation.responseFormat);
  assert.notEqual(first.responseFormat?.schema, schema);
  const copied = first.responseFormat!.schema as typeof schema;
  copied.properties.reply.description = 'changed';
  copied.required.push('new_field');
  assert.equal(schema.properties.reply.description, 'test');
  assert.deepEqual(schema.required, ['reply']);
  assert.deepEqual(second.responseFormat, generation.responseFormat);
  // Passing keywords through is not a claim that NAVER accepts those keywords.
});

test('omitting structured output preserves both existing plain wire contracts', () => {
  const oldModel = clovaGenerationConfig('HCX-005', { responseFormat: undefined });
  const newModel = clovaGenerationConfig('HCX-007', { responseFormat: undefined });
  assert.deepEqual(oldModel, { maxTokens: 2048, temperature: 0 });
  assert.deepEqual(newModel, { maxCompletionTokens: 2048, temperature: 0, thinking: { effort: 'none' } });
  assert.equal(Object.hasOwn(oldModel, 'responseFormat'), false);
  assert.equal(Object.hasOwn(newModel, 'responseFormat'), false);
});
