import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { HarnessLab } from './service.ts';
import { harnessRouter } from '../routes/harness.ts';
import { MODE2_PROVIDERS } from '../../runtime/clova/providers.ts';

const token = 'test-access-capability-not-a-real-secret-1234567890';
const runtimeDir = resolve('server-dist/clova');
const comparison = JSON.parse(readFileSync(new URL('../../runtime/clova/fixtures/comparison.json', import.meta.url), 'utf8')) as { systemPrompt: string };
async function waitState(lab: HarnessLab, owner: string, id: string, expected: string[]) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const state = lab.state(owner, id);
    if (expected.includes(state.state)) return state;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`session did not reach ${expected.join(', ')}`);
}
const waitIdle = (lab: HarnessLab, owner: string, id: string) => waitState(lab, owner, id, ['idle', 'invalid', 'closed']);

test('web session ownership, capacity, overlap, events and cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clova-web-test-'));
  const lab = new HarnessLab({ root, runtimeDir, accessToken: token });
  const owner = randomUUID(), other = randomUUID();
  try {
    assert.throws(() => lab.authenticate(undefined), (e: any) => e.status === 401);
    lab.authenticate(`Bearer ${token}`);
    assert.equal(lab.info().maxTurns, 4);
    assert.deepEqual(lab.info().harnessModes, ['2', '3']);
    await assert.rejects(lab.create(owner, 'scripted', 'HCX-005', '1'), (e: any) => e.status === 400);
    const a = await lab.create(owner, 'scripted', 'HCX-005');
    assert.equal(a.harness, 'langgraph');
    assert.equal(a.harnessMode, '3');
    assert.equal(a.approval, 'never');
    assert.deepEqual(a.events.find(e => e.t === 'ready')?.data.tools.sort(),
      ['clova__artifact_list', 'clova__artifact_read', 'clova__artifact_undo', 'clova__artifact_write']);
    assert.throws(() => lab.approve(owner, a.id, 'anything', true), (e: any) => e.status === 409);
    assert.throws(() => lab.state(other, a.id), (e: any) => e.status === 404);
    await assert.rejects(lab.create(owner, 'scripted', 'HCX-005'), (e: any) => e.status === 409);
    const b = await lab.create(other, 'scripted', 'HCX-005');
    await assert.rejects(lab.create(randomUUID(), 'scripted', 'HCX-005'), (e: any) => e.status === 429);
    lab.prompt(owner, a.id, 'list');
    assert.throws(() => lab.prompt(owner, a.id, 'duplicate'), (e: any) => e.status === 409);
    const first = await waitIdle(lab, owner, a.id);
    assert.equal(first.lastTurn?.ok, true);
    assert.equal(first.toolCalls, 1);
    assert.ok(first.events.some(e => e.t === 'user_prompt'));
    assert.equal(first.events.some(e => e.t === 'approval'), false);
    assert.equal(lab.state(owner, a.id, first.cursor).events.length, 0);
    assert.throws(() => lab.file(owner, a.id, '../profile.json'), (e: any) => e.status === 400);
    lab.prompt(owner, a.id, 'again');
    const second = await waitIdle(lab, owner, a.id);
    assert.equal(second.lastTurn?.sessionId, first.lastTurn?.sessionId);
    assert.equal(second.usage.input, first.usage.input * 2);
    assert.equal(second.prompts, 2);
    await lab.close(owner, a.id); await lab.close(other, b.id);
    assert.throws(() => lab.state(owner, a.id), (e: any) => e.status === 404);
  } finally { await lab.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('HTTP route auth, live adapter tool results, file content and interrupt (local API fixture)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clova-web-http-'));
  let calls = 0, slow = false;
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const input = JSON.parse(body); calls++;
    assert.equal(req.headers.authorization, 'Bearer fixture-provider-key');
    assert.equal(input.messages[0]?.role, 'system');
    assert.ok(input.messages[0].content.startsWith(comparison.systemPrompt), 'mode 3 must send the shared comparison system prompt to CLOVA');
    assert.equal(input.maxTokens, 2048);
    assert.equal(input.temperature, 0);
    assert.deepEqual(input.tools.map((t: any) => t.function.name).sort(),
      ['clova__artifact_list', 'clova__artifact_read', 'clova__artifact_undo', 'clova__artifact_write']);
    const hasToolResult = input.messages.at(-1)?.role === 'tool';
    if (slow) await new Promise(r => setTimeout(r, 1000));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: { code: '20000' }, result: {
      message: hasToolResult ? { role: 'assistant', content: '파일을 확인했습니다.' } : { role: 'assistant', content: '', toolCalls: [
        { id: 'write1', type: 'function', function: { name: 'clova__artifact_write', arguments: { path: 'hello.txt', text: '웹 테스트 완료' } } },
        { id: 'empty-write', type: 'function', function: { name: 'clova__artifact_write', arguments: null } },
        { id: 'read1', type: 'function', function: { name: 'clova__artifact_read', arguments: { path: 'hello.txt' } } },
      ] }, finishReason: hasToolResult ? 'stop' : 'tool_calls', usage: { promptTokens: 5, completionTokens: 3 },
    } }));
  });
  await new Promise<void>(r => provider.listen(0, '127.0.0.1', r));
  const lab = new HarnessLab({ root, runtimeDir, accessToken: token, apiKey: 'fixture-provider-key', baseUrl: `http://127.0.0.1:${(provider.address() as any).port}` });
  const app = express(); app.use(express.json()); app.use('/api/harness', harnessRouter(lab));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/harness`;
  const owner = randomUUID();
  const headers = { Authorization: `Bearer ${token}`, 'X-Harness-Client': owner, 'Content-Type': 'application/json' };
  const request = (path: string, method = 'GET', body?: object) => fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await fetch(base + '/info')).status, 401);
    assert.equal((await request('/info')).status, 200);
    const response = await request('/sessions', 'POST', { mode: 'live', model: 'HCX-005', harnessMode: '3' });
    assert.equal(response.status, 201); const created = await response.json() as any;
    await request(`/sessions/${created.id}/prompt`, 'POST', { text: '파일 만들기' });
    const finished = await waitIdle(lab, owner, created.id);
    assert.equal(finished.lastTurn?.ok, true); assert.equal(calls, 2);
    assert.equal(finished.events.some(e => e.t === 'approval'), false);
    assert.ok(finished.events.some(e => e.t === 'tool_result' && e.data.ok === false));
    const file = await (await request(`/sessions/${created.id}/file?path=hello.txt`)).json() as any;
    assert.equal(file.text, '웹 테스트 완료');
    assert.equal((await request(`/sessions/${created.id}/file?path=..%2Fprofile.json`)).status, 400);
    const report = await (await request(`/sessions/${created.id}/report`)).text();
    assert.ok(!report.includes('fixture-provider-key'));
    assert.equal((await fetch(`${base}/sessions/${created.id}`, { headers: { ...headers, 'X-Harness-Client': randomUUID() } })).status, 404);
    slow = true;
    await request(`/sessions/${created.id}/prompt`, 'POST', { text: '중단 시험' });
    await new Promise(r => setTimeout(r, 100));
    await request(`/sessions/${created.id}/interrupt`, 'POST', {});
    const stopped = await waitIdle(lab, owner, created.id);
    assert.ok(stopped.events.some(e => e.t === 'error' && e.data.code === 'interrupted'));
    assert.equal(stopped.lastTurn, null, 'an interrupted request must not display the previous successful turn');
    assert.equal((await request(`/sessions/${created.id}`, 'DELETE')).status, 200);
    assert.equal((await request(`/sessions/${created.id}`)).status, 404);
  } finally {
    await lab.dispose();
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('mode 2 HTTP approval guards file effects, supports denial, and interrupts a pending decision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clova-web-approval-'));
  let calls = 0;
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const input = JSON.parse(body); calls++;
    assert.equal(input.messages[0]?.role, 'system');
    assert.ok(input.messages[0].content.startsWith(comparison.systemPrompt), 'mode 2 must send the shared comparison system prompt to CLOVA');
    const done = input.messages.at(-1)?.role === 'tool';
    const text = input.messages.findLast((m: any) => m.role === 'user').content;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: { code: '20000' }, result: {
      message: done ? { role: 'assistant', content: '도구 결과를 확인했습니다.' } : { role: 'assistant', content: '', toolCalls: [
        { id: `write-${calls}`, type: 'function', function: { name: 'clova__artifact_write', arguments: { path: 'approved.txt', text } } },
      ] }, finishReason: done ? 'stop' : 'tool_calls', usage: { promptTokens: 5, completionTokens: 3 },
    } }));
  });
  await new Promise<void>(r => provider.listen(0, '127.0.0.1', r));
  const lab = new HarnessLab({ root, runtimeDir, accessToken: token, apiKey: 'fixture-provider-key', baseUrl: `http://127.0.0.1:${(provider.address() as any).port}` });
  const app = express(); app.use(express.json()); app.use('/api/harness', harnessRouter(lab));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/harness`, owner = randomUUID();
  const headers = { Authorization: `Bearer ${token}`, 'X-Harness-Client': owner, 'Content-Type': 'application/json' };
  const request = (path: string, body: object) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const response = await request('/sessions', { mode: 'live', model: 'HCX-005', harnessMode: '2' });
    assert.equal(response.status, 201); const created = await response.json() as any;
    assert.equal(created.approval, 'ask');
    await request(`/sessions/${created.id}/prompt`, { text: 'first version' });
    const pending = await waitState(lab, owner, created.id, ['awaiting_approval']);
    const approvalId = pending.pendingApproval!.approvalId;
    assert.equal(pending.pendingApproval!.tool, 'clova__artifact_write');
    assert.equal(calls, 1);
    assert.deepEqual(lab.files(owner, created.id), []);
    assert.equal((await request(`/sessions/${created.id}/prompt`, { text: 'overlap' })).status, 409);
    assert.equal((await fetch(`${base}/sessions/${created.id}/approve`, { method: 'POST', headers: { ...headers, 'X-Harness-Client': randomUUID() }, body: JSON.stringify({ approvalId, allow: true }) })).status, 404);
    assert.equal((await request(`/sessions/${created.id}/approve`, { approvalId, allow: 'true' })).status, 400);
    assert.equal((await request(`/sessions/${created.id}/approve`, { approvalId: 'stale', allow: true })).status, 409);
    assert.equal(lab.state(owner, created.id).pendingApproval!.approvalId, approvalId);
    assert.equal((await request(`/sessions/${created.id}/approve`, { approvalId, allow: true })).status, 200);
    assert.equal((await request(`/sessions/${created.id}/approve`, { approvalId, allow: true })).status, 409);
    const first = await waitIdle(lab, owner, created.id);
    assert.equal(first.pendingApproval, null);
    assert.equal(first.lastTurn?.toolCalls, 1);
    assert.equal(lab.file(owner, created.id, 'approved.txt').text, 'first version');
    await request(`/sessions/${created.id}/prompt`, { text: 'denied replacement' });
    const denied = await waitState(lab, owner, created.id, ['awaiting_approval']);
    assert.equal((await request(`/sessions/${created.id}/approve`, { approvalId: denied.pendingApproval!.approvalId, allow: false, reason: 'keep the original' })).status, 200);
    const second = await waitIdle(lab, owner, created.id);
    assert.equal(second.lastTurn?.toolCalls, 0);
    assert.ok(second.events.some(e => e.t === 'approval_decision' && e.data.allow === false));
    assert.ok(second.events.some(e => e.t === 'tool_result' && e.data.ok === false));
    assert.equal(lab.file(owner, created.id, 'approved.txt').text, 'first version');
    await request(`/sessions/${created.id}/prompt`, { text: 'cancelled replacement' });
    const cancelled = await waitState(lab, owner, created.id, ['awaiting_approval']);
    assert.equal((await request(`/sessions/${created.id}/interrupt`, {})).status, 200);
    const stopped = await waitIdle(lab, owner, created.id);
    assert.equal(stopped.pendingApproval, null);
    assert.equal(stopped.lastTurn, null);
    assert.equal((await request(`/sessions/${created.id}/approve`, { approvalId: cancelled.pendingApproval!.approvalId, allow: true })).status, 409);
    assert.ok(stopped.events.some(e => e.t === 'error' && e.data.code === 'interrupted'));
    assert.equal(lab.file(owner, created.id, 'approved.txt').text, 'first version');
  } finally {
    await lab.dispose();
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only polling does not renew the idle session lifetime', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
  const root = mkdtempSync(join(tmpdir(), 'clova-web-expiry-'));
  const lab = new HarnessLab({ root, runtimeDir, accessToken: token, idleMs: 15000 });
  const owner = randomUUID();
  try {
    const session = await lab.create(owner, 'scripted', 'HCX-005');
    context.mock.timers.tick(10000);
    lab.state(owner, session.id); lab.files(owner, session.id); lab.report(owner, session.id);
    context.mock.timers.tick(10000);
    let expired = false;
    for (let i = 0; i < 100; i++) {
      try { lab.state(owner, session.id); } catch (error: any) { assert.equal(error.status, 404); expired = true; break; }
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(expired, true);
  } finally { await lab.dispose(); context.mock.timers.reset(); rmSync(root, { recursive: true, force: true }); }
});

test('additional providers report configuration separately from verification and reject mode 3 or unlisted models', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mode2-web-configuration-'));
  const keyFiles = Object.fromEntries(MODE2_PROVIDERS.map(provider => [provider.id, join(root, provider.id)]));
  const lab = new HarnessLab({ root, runtimeDir, accessToken: token, providerKeyFiles: keyFiles });
  try {
    for (const provider of MODE2_PROVIDERS) {
      const info = lab.info().providers.find(item => item.id === provider.id)!;
      assert.equal(info.configured, false);
      assert.equal(info.validationStatus, 'not_verified');
      assert.match(info.unavailableReason!, new RegExp(provider.keyFileEnv));
      assert.deepEqual(info.harnessModes, ['2']);
      const owner = randomUUID(), model = provider.models[0].id;
      await assert.rejects(lab.create(owner, 'live', model, '3', provider.id), (e: any) => e.status === 400);
      await assert.rejects(lab.create(owner, 'live', 'https://untrusted.invalid/model', '2', provider.id), (e: any) => e.status === 400);
      await assert.rejects(lab.create(owner, 'live', 'openrouter:paid-model', '2', provider.id), (e: any) => e.status === 400);
      await assert.rejects(lab.create(owner, 'scripted', model, '2', provider.id), (e: any) => e.status === 400);
      await assert.rejects(lab.create(owner, 'live', model, '2', provider.id), (e: any) => e.status === 503);
      writeFileSync(keyFiles[provider.id], `fixture-${provider.id}-key`, { mode: 0o600 });
      assert.equal(lab.info().providers.find(item => item.id === provider.id)!.configured, true);
      assert.equal(lab.info().providers.find(item => item.id === provider.id)!.validationStatus, 'not_verified');
      chmodSync(keyFiles[provider.id], 0o644);
      assert.equal(lab.info().providers.find(item => item.id === provider.id)!.configured, false);
      await assert.rejects(lab.create(owner, 'live', model, '2', provider.id), (e: any) => e.status === 503);
    }
    await assert.rejects(lab.create(randomUUID(), 'live', 'HCX-005', '2', 'unknown'), (e: any) => e.status === 400);
  } finally { await lab.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('mode 2 additional provider HTTP routing uses the selected credential and preserves approval, denial and cancellation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mode2-web-providers-'));
  const keyFiles = Object.fromEntries(MODE2_PROVIDERS.map(provider => {
    const file = join(root, `${provider.id}-credential`);
    writeFileSync(file, `fixture-${provider.id}-key`, { mode: 0o600 });
    // The child runs in runtimeDir, so the parent must resolve relative credential paths.
    return [provider.id, relative(process.cwd(), file)];
  }));
  const calls: Record<string, number> = {};
  const requests: Array<{ provider: string; body: any }> = [];
  const upstream = createServer(async (req, res) => {
    const providerId = req.url!.split('/')[1];
    const descriptor = MODE2_PROVIDERS.find(provider => provider.id === providerId)!;
    let body = ''; for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    calls[providerId] = (calls[providerId] ?? 0) + 1;
    requests.push({ provider: providerId, body: input });
    assert.equal(req.url, `/${providerId}/v1/chat/completions`);
    assert.equal(req.headers.authorization, `Bearer fixture-${providerId}-key`);
    assert.equal(input.model, descriptor.models[0].id.slice(providerId.length + 1));
    assert.equal(input.messages[0].role, 'system');
    assert.ok(input.messages[0].content.startsWith(comparison.systemPrompt));
    assert.deepEqual(input.tools.map((tool: any) => tool.function.name).sort(),
      ['clova__artifact_list', 'clova__artifact_read', 'clova__artifact_undo', 'clova__artifact_write']);
    const done = input.messages.at(-1).role === 'tool';
    const content = input.messages.findLast((message: any) => message.role === 'user').content;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: done ? 'stop' : 'tool_calls', message: done
      ? { role: 'assistant', content: '도구 결과를 확인했습니다.' }
      : { role: 'assistant', content: null, tool_calls: [{ id: `${providerId}-${calls[providerId]}`, type: 'function',
          function: { name: 'clova__artifact_write', arguments: JSON.stringify({ path: 'approved.txt', text: content }) } }] } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 } }));
  });
  await new Promise<void>(r => upstream.listen(0, '127.0.0.1', r));
  const upstreamBase = `http://127.0.0.1:${(upstream.address() as any).port}`;
  const providerBaseUrls = Object.fromEntries(MODE2_PROVIDERS.map(provider => [provider.id, `${upstreamBase}/${provider.id}/v1`]));
  const lab = new HarnessLab({ root, runtimeDir, accessToken: token, apiKey: 'unrelated-clova-key', providerKeyFiles: keyFiles, providerBaseUrls });
  const app = express(); app.use(express.json()); app.use('/api/harness', harnessRouter(lab));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/harness`;
  try {
    for (const provider of MODE2_PROVIDERS) {
      const owner = randomUUID();
      const headers = { Authorization: `Bearer ${token}`, 'X-Harness-Client': owner, 'Content-Type': 'application/json' };
      const request = (path: string, body: object) => fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
      const payload = { provider: provider.id, model: provider.models[0].id, mode: 'live', harnessMode: '2' };
      assert.equal((await request('/sessions', { ...payload, harnessMode: '3' })).status, 400);
      const response = await request('/sessions', { ...payload,
        baseUrl: 'https://untrusted.invalid/api', apiKeyFile: '/untrusted/credential',
        providerBaseUrls: { [provider.id]: 'https://untrusted.invalid/api' } });
      assert.equal(response.status, 201); const session = await response.json() as any;
      assert.equal(session.provider, provider.id); assert.equal(session.model, payload.model);
      assert.equal(session.harnessMode, '2'); assert.equal(session.approval, 'ask');
      await request(`/sessions/${session.id}/prompt`, { text: 'approved version' });
      const pending = await waitState(lab, owner, session.id, ['awaiting_approval']);
      assert.deepEqual(lab.files(owner, session.id), []);
      assert.equal(calls[provider.id], 1);
      assert.equal((await request(`/sessions/${session.id}/approve`, { approvalId: pending.pendingApproval!.approvalId, allow: true })).status, 200);
      const first = await waitIdle(lab, owner, session.id);
      assert.equal(first.lastTurn?.ok, true); assert.equal(first.lastTurn?.toolCalls, 1);
      assert.equal(lab.file(owner, session.id, 'approved.txt').text, 'approved version');
      await request(`/sessions/${session.id}/prompt`, { text: 'denied replacement' });
      const denied = await waitState(lab, owner, session.id, ['awaiting_approval']);
      await request(`/sessions/${session.id}/approve`, { approvalId: denied.pendingApproval!.approvalId, allow: false });
      const second = await waitIdle(lab, owner, session.id);
      assert.equal(second.lastTurn?.toolCalls, 0);
      assert.equal(lab.file(owner, session.id, 'approved.txt').text, 'approved version');
      assert.ok(requests.filter(item => item.provider === provider.id).some(item =>
        item.body.messages.some((message: any) => message.role === 'tool' && /denied/i.test(message.content))));
      await request(`/sessions/${session.id}/prompt`, { text: 'cancelled replacement' });
      await waitState(lab, owner, session.id, ['awaiting_approval']);
      await request(`/sessions/${session.id}/interrupt`, {});
      const interrupted = await waitIdle(lab, owner, session.id);
      assert.equal(interrupted.lastTurn, null); assert.equal(interrupted.pendingApproval, null);
      assert.ok(interrupted.events.some(event => event.t === 'error' && event.data.code === 'interrupted'));
      assert.equal(lab.file(owner, session.id, 'approved.txt').text, 'approved version');
      const report = JSON.stringify(lab.report(owner, session.id));
      for (const candidate of MODE2_PROVIDERS) assert.ok(!report.includes(`fixture-${candidate.id}-key`));
      assert.ok(!report.includes('unrelated-clova-key'));
      assert.equal(lab.info().providers.find(item => item.id === provider.id)!.validationStatus, 'not_verified');
      await lab.close(owner, session.id);
    }
  } finally {
    await lab.dispose();
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));
    upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r()));
    rmSync(root, { recursive: true, force: true });
  }
});
