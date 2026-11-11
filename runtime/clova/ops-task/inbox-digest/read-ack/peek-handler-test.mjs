#!/usr/bin/env node
/** Offline handler boundary tests. Never import the source module or run its MCP loop. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../../../..');
const sourcePath = path.join(repo, '.local/comms-mcp-source-f296148.mjs');
const sourceCommit = 'f296148cac6475941c90e86c066eebac5329b8ac';
const expectedSha256 = '85521ab6a90e52c7a09e998124bc9902b86265eab62e32fffb02a6a702316617';
const installedPath = '/home/gino/.local/share/elda-comms/elda-comms-mcp.mjs';
const outputPath = path.join(directory, 'peek-handler-result.json');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const copy = (value) => JSON.parse(JSON.stringify(value));
const bytes = await readFile(sourcePath);
assert.equal(sha(bytes), expectedSha256, 'Refuse a changed source snapshot');
const source = bytes.toString('utf8');
const startMarker = 'const TOOLS = [';
const endMarker = '// ── MCP stdio';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
assert(start >= 0 && end > start);
assert.equal(source.indexOf(startMarker, start + 1), -1, 'Ambiguous TOOLS declaration');
const declaration = source.slice(start, end).trim();
assert(declaration.startsWith(startMarker) && declaration.endsWith('];'));
// Defense in depth for this pinned, inspected declaration; not a general untrusted-code sandbox.
const forbidden = /\b(?:import|require|process|global|globalThis|fetch|readline|loadConfig|fs|os|eval|Function|constructor|prototype|__proto__|setTimeout|setInterval|WebSocket|XMLHttpRequest)\b/;
assert(!forbidden.test(declaration), 'External access/import/module execution in selected declaration');
const toolScript = new vm.Script(`${declaration}\nTOOLS;`, { filename: 'pinned-comms-TOOLS-only.vm.js' });

// These snippets are inspected, not evaluated. Actual handle()/send()/readline/config never run.
const wrapperFragments = [
  'const tool = TOOLS.find((t) => t.name === params?.name);',
  'const text = await tool.run(params.arguments ?? {});',
  'return send({ id, result: { content: [{ type: \'text\', text }] } });',
  'return send({ id, result: { content: [{ type: \'text\', text: String(e?.message ?? e) }], isError: true } });',
  'if (!tool) return send({ id, error: { code: -32602, message: `알 수 없는 도구: ${params?.name}` } });',
];
for (const fragment of wrapperFragments) assert(source.includes(fragment), `Wrapper contract changed: ${fragment}`);

const syntheticMessage = {
  id: 'f900000009', team: 'TEST', thread: 'offline-peek', at: '2026-11-11T00:00:00Z',
  from: 'synthetic-sender', to: ['synthetic-reader'], cc: [], subject: 'synthetic only',
  body: 'SYNTHETIC_BODY_NO_REAL_MESSAGE', read: false, ref: [],
};

function setup({ failGet = false, failPost = false } = {}) {
  const calls = [], renderCalls = [], syntheticReadIds = [];
  const hub = async (method, route, body) => {
    calls.push({ method, route, ...(body === undefined ? {} : { body: copy(body) }) });
    if (method === 'GET' && route.startsWith('/messages/')) {
      if (failGet) throw new Error('SYNTHETIC_GET_FAILURE');
      return copy(syntheticMessage);
    }
    if (method === 'POST' && route === '/read') {
      if (failPost) throw new Error('SYNTHETIC_POST_FAILURE');
      syntheticReadIds.push(...copy(body.ids));
      return { ok: true };
    }
    throw new Error(`Unexpected mock hub route: ${method} ${route}`);
  };
  // Formatting is intentionally stubbed. Only original TOOLS handler control flow is tested.
  const render = (message) => {
    renderCalls.push(copy(message));
    return `MOCK_RENDER:${message.id}:${message.body}`;
  };
  const sandbox = Object.create(null);
  Object.assign(sandbox, {
    hub, render,
    when: (iso) => iso.replace('T', ' ').replace(/:\d\dZ$/, 'Z'),
    list: (a) => [].concat(a ?? []).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean),
    ADDR: 'SYNTHETIC_ADDRESS_DESCRIPTION',
  });
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const absent = vm.runInContext('[typeof process, typeof require, typeof fetch, typeof Buffer, typeof readline]', context, { timeout: 1000 });
  assert.deepEqual(copy(absent), Array(5).fill('undefined'));
  const tools = toolScript.runInContext(context, { timeout: 1000 });
  assert.equal(calls.length, 0, 'TOOLS initialization must not call hub');
  return { tools, calls, renderCalls, syntheticReadIds, injectedHelpers: Object.keys(sandbox) };
}

async function callHandler(env, name, arguments_) {
  const tool = env.tools.find((item) => item.name === name);
  assert(tool, `Missing original handler ${name}`);
  let timer;
  try {
    return await Promise.race([
      tool.run(arguments_),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('offline handler timeout')), 1000); }),
    ]);
  } finally { clearTimeout(timer); }
}

// Test-owned envelope mirrors the statically matched original catch. This is not real MCP dispatch.
async function envelope(env, name, arguments_) {
  if (!env.tools.some((item) => item.name === name)) return { error: { code: -32602, message: `알 수 없는 도구: ${name}` } };
  try {
    const text = await callHandler(env, name, arguments_);
    return { result: { content: [{ type: 'text', text }] } };
  } catch (error) {
    return { result: { content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true } };
  }
}

const cases = [];
async function verify(id, scenario) {
  const observation = await scenario();
  cases.push({ id, passed: true, ...observation });
}
const getFor = (id) => ({ method: 'GET', route: `/messages/${encodeURIComponent(id)}` });
const postFor = (ids) => ({ method: 'POST', route: '/read', body: { ids } });
const rendered = `MOCK_RENDER:${syntheticMessage.id}:${syntheticMessage.body}`;

await verify('peek_get_only_and_encoded_requested_id', async () => {
  const env = setup(), id = 'request /? 한글';
  const text = await callHandler(env, 'comms_peek', { id });
  assert.equal(text, rendered);
  assert.deepEqual(env.calls, [getFor(id)]);
  assert.deepEqual(env.syntheticReadIds, []);
  assert.deepEqual(env.renderCalls, [syntheticMessage]);
  return { calls: env.calls, syntheticReadIdsAfter: env.syntheticReadIds, renderCalls: env.renderCalls.length };
});
await verify('read_default_get_then_post_returned_canonical_id', async () => {
  const env = setup(), id = 'f900000001';
  assert.equal(await callHandler(env, 'comms_read', { id }), rendered);
  assert.deepEqual(env.calls, [getFor(id), postFor([syntheticMessage.id])]);
  assert.deepEqual(env.syntheticReadIds, [syntheticMessage.id]);
  return { requestedId: id, returnedId: syntheticMessage.id, calls: env.calls, syntheticReadIdsAfter: env.syntheticReadIds };
});
await verify('read_legacy_keepUnread_parameter_does_not_protect_in_f296148', async () => {
  const env = setup(), id = 'f900000001';
  assert.equal(await callHandler(env, 'comms_read', { id, keepUnread: true }), rendered);
  assert.deepEqual(env.calls, [getFor(id), postFor([syntheticMessage.id])]);
  return { calls: env.calls, interpretation: 'Unknown extra keepUnread is ignored by this handler. Use the separate comms_peek tool.' };
});
await verify('peek_get_failure_throws_before_any_mark_or_render', async () => {
  const env = setup({ failGet: true }), id = 'f900000001';
  await assert.rejects(callHandler(env, 'comms_peek', { id }), /SYNTHETIC_GET_FAILURE/);
  assert.deepEqual(env.calls, [getFor(id)]);
  assert.deepEqual(env.syntheticReadIds, []);
  assert.deepEqual(env.renderCalls, []);
  return { calls: env.calls, handlerThrows: true, syntheticReadIdsAfter: env.syntheticReadIds, renderCalls: 0 };
});
await verify('peek_get_failure_isError_in_test_owned_matching_envelope', async () => {
  const env = setup({ failGet: true });
  const response = await envelope(env, 'comms_peek', { id: 'f900000001' });
  assert.deepEqual(response, { result: { content: [{ type: 'text', text: 'SYNTHETIC_GET_FAILURE' }], isError: true } });
  assert.equal(env.calls.length, 1);
  return { calls: env.calls, response, scope: 'Original handler throw + test-owned envelope; original MCP dispatch was not executed.' };
});
await verify('read_get_failure_does_not_post', async () => {
  const env = setup({ failGet: true }), id = 'f900000001';
  await assert.rejects(callHandler(env, 'comms_read', { id }), /SYNTHETIC_GET_FAILURE/);
  assert.deepEqual(env.calls, [getFor(id)]);
  assert.deepEqual(env.syntheticReadIds, []);
  return { calls: env.calls, handlerThrows: true };
});
await verify('read_post_failure_is_swallowed_by_existing_handler', async () => {
  const env = setup({ failPost: true }), id = 'f900000001';
  assert.equal(await callHandler(env, 'comms_read', { id }), rendered);
  assert.deepEqual(env.calls, [getFor(id), postFor([syntheticMessage.id])]);
  assert.deepEqual(env.syntheticReadIds, []);
  return { calls: env.calls, handlerReturnsBodyDespiteAckFailure: true, syntheticReadIdsAfter: env.syntheticReadIds };
});
await verify('mark_read_explicit_post_exact_ids_no_get', async () => {
  const env = setup(), ids = ['f900000001', 'f900000002', 'f900000001'];
  assert.equal(await callHandler(env, 'comms_mark_read', { ids }), '읽음: 3');
  assert.deepEqual(env.calls, [postFor(ids)]);
  assert.deepEqual(env.syntheticReadIds, ids);
  return { requestedIds: ids, calls: env.calls, syntheticReadIdsAfter: env.syntheticReadIds, duplicatesPreserved: true };
});
await verify('mark_read_post_failure_propagates_as_error', async () => {
  const env = setup({ failPost: true }), ids = ['f900000001', 'f900000002'];
  const response = await envelope(env, 'comms_mark_read', { ids });
  assert.deepEqual(env.calls, [postFor(ids)]);
  assert.deepEqual(response, { result: { content: [{ type: 'text', text: 'SYNTHETIC_POST_FAILURE' }], isError: true } });
  assert.deepEqual(env.syntheticReadIds, []);
  return { calls: env.calls, response, syntheticReadIdsAfter: env.syntheticReadIds };
});

const env = setup();
const schemas = Object.fromEntries(['comms_read', 'comms_peek', 'comms_mark_read'].map((name) => {
  const tool = env.tools.find((item) => item.name === name);
  assert(tool);
  return [name, copy(tool.inputSchema)];
}));
assert.deepEqual(schemas.comms_read, { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] });
assert.deepEqual(schemas.comms_peek, schemas.comms_read);
assert.deepEqual(schemas.comms_mark_read, { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] });

let installedSnapshot;
try {
  const installed = await readFile(installedPath);
  const text = installed.toString('utf8');
  const a = text.indexOf(startMarker), z = text.indexOf(endMarker, a);
  assert(a >= 0 && z > a);
  installedSnapshot = {
    path: installedPath, sha256: sha(installed), readOnly: true, evaluated: false,
    sameBytesAsPinnedSource: installed.equals(bytes),
    peekDeclared: /name:\s*['"]comms_peek['"]/.test(text.slice(a, z)),
    keepUnreadPresent: /keepUnread/.test(text.slice(a, z)),
    interpretation: 'Installation may have changed. This read-only snapshot is not assumed to be an old version.',
  };
} catch (error) {
  installedSnapshot = { path: installedPath, readOnly: true, evaluated: false, readError: String(error.message) };
}

const result = {
  format: 'comms-peek-pinned-handler-test-v1', date: '2026-11-11', passed: cases.every((item) => item.passed),
  source: { path: sourcePath, repository: 'ginojang/Elda-AI-Agent', commit: sourceCommit,
    repositoryPath: 'comms-hub/elda-comms-mcp.mjs', sha256: sha(bytes), pinnedSha256Matched: true,
    toolsDeclarationSha256: sha(declaration), sourceStartLine: source.slice(0, start).split('\n').length,
    sourceEndLine: source.slice(0, end).split('\n').length - 1 },
  test: { path: fileURLToPath(import.meta.url), sha256: sha(await readFile(fileURLToPath(import.meta.url))) },
  sandbox: { evaluatedOnly: 'const TOOLS = [ ... ]; declaration plus test-owned TOOLS value return',
    sourceModuleImported: false, sourceHandleExecuted: false, sourceRenderExecuted: false,
    sourceReadlineExecuted: false, sourceLoadConfigExecuted: false, externalImportOrAccessTokensRejected: true,
    injectedHelpers: env.injectedHelpers, renderer: 'test-owned pure synthetic render sentinel; production formatting not tested',
    dynamicCodeGeneration: false, wasmCodeGeneration: false, declarationTimeoutMilliseconds: 1000,
    handlerTimeoutMilliseconds: 1000, processRequireFetchBufferReadlineUnavailable: true },
  errorBoundary: { originalWrapperStaticallyMatched: true, originalWrapperExecuted: false,
    actualHandlerThrowTested: true, envelopeExecution: 'test-owned mirror only', exactMatchedSourceFragments: wrapperFragments },
  tools: env.tools.map((tool) => tool.name), schemas, cases, installedSnapshot,
  actualExternalApiCalls: 0, actualProductionMcpCalls: 0, actualModelCalls: 0, actualReadMarksChanged: 0,
  scope: 'Pinned tool-handler control flow with a synthetic hub. No production API/MCP/config/key or inbox state access.',
  limitations: ['No server-side GET /messages or POST /read implementation was executed.',
    'No real MCP stdio session, credentials, deployment state, summary workflow, or model behavior was tested.',
    'isError envelope behavior is a test-owned mirror statically matched to the original dispatcher, not real dispatcher execution.',
    'Installed source currently matches the new commit when sameBytesAsPinnedSource is true; no old-version negative compatibility run is claimed.'],
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ passed: result.passed, cases: cases.length, output: outputPath,
  pinnedSha256: result.source.sha256, installedSameAsPinned: installedSnapshot.sameBytesAsPinnedSource,
  actualExternalApiCalls: 0, actualProductionMcpCalls: 0, actualReadMarksChanged: 0 }));
