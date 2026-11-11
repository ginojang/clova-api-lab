import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Answer } from '../../clova/common.ts';

const folder = dirname(fileURLToPath(import.meta.url));
const tempRoot = resolve(folder, '.smoke');
mkdirSync(tempRoot, { recursive: true });
type Event = { seq: number; t: string; data: Record<string, any> };
const usage = { input: 11, output: 5, cacheRead: 0, cacheWrite: 0 };
const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function' as const, function: { name: `clova__${name}`, arguments: args } });
const actions = (...calls: ReturnType<typeof call>[]): Answer => ({ message: { role: 'assistant', content: '', toolCalls: calls }, finishReason: 'tool_calls', usage });
const done = (): Answer => ({ message: { role: 'assistant', content: 'Completed.' }, finishReason: 'stop', usage });

function launch(script: (Answer & { delayMs?: number })[], maxTurns = 4, live: { model?: string; env?: NodeJS.ProcessEnv } = {}) {
  const temp = mkdtempSync(resolve(tempRoot, 'case-'));
  const workspace = resolve(temp, 'workspace');
  const scriptFile = resolve(temp, 'script.json');
  writeFileSync(scriptFile, JSON.stringify(script));
  const modelArgs = live.model ? ['--model', live.model] : ['--script', scriptFile];
  const child = spawn(process.execPath, [resolve(folder, 'cli.mjs'), '--workspace', workspace, ...modelArgs, '--max-turns', String(maxTurns)], { cwd: folder, stdio: 'pipe', env: { ...process.env, ...live.env } });
  const events: Event[] = [];
  const waiters = new Set<() => void>();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise<number | null>(resolveClose => child.once('close', resolveClose));
  createInterface({ input: child.stdout }).on('line', line => {
    const event = JSON.parse(line) as Event;
    assert.equal(event.seq, events.length + 1);
    events.push(event);
    for (const notify of waiters) notify();
  });
  const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
  const wait = (predicate: (event: Event) => boolean, start = 0): Promise<Event> => new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => { waiters.delete(check); rejectWait(new Error(`Timed out; events=${JSON.stringify(events)} stderr=${stderr}`)); }, 8000);
    const check = () => {
      const event = events.slice(start).find(predicate);
      if (event) { clearTimeout(timer); waiters.delete(check); resolveWait(event); }
    };
    waiters.add(check); check();
  });
  const cleanup = async () => {
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const mcpPid = events.find(e => e.t === 'ready')?.data.mcpPid;
      if (mcpPid) try { process.kill(mcpPid, 'SIGKILL'); } catch { /* already exited */ }
    }, 3000);
    await closed;
    clearTimeout(timer);
  };
  return { child, events, workspace, send, wait, closed, cleanup, stderr: () => stderr };
}

test('real SDK + MCP: ordered multi-call create/edit/undo/read and duplicate approval', async t => {
  const worker = launch([actions(
    call('create', 'artifact_write', { path: 'a.txt', text: 'first' }),
    call('edit', 'artifact_write', { path: 'a.txt', text: 'second' }),
    call('undo', 'artifact_undo', {}),
    call('read', 'artifact_read', { path: 'a.txt' }),
  ), done()]);
  t.after(worker.cleanup);
  const ready = await worker.wait(e => e.t === 'ready');
  assert.equal(ready.data.version, '7.0.166');
  assert.ok(ready.data.mcpPid);
  worker.send({ op: 'prompt', text: 'create, edit, undo and read' });
  for (const id of ['create', 'edit', 'undo', 'read']) {
    const approval = await worker.wait(e => e.t === 'approval' && e.data.callId === id);
    if (id === 'create') assert.equal(existsSync(resolve(worker.workspace, 'a.txt')), false);
    worker.send({ op: 'approve', approvalId: approval.data.approvalId, allow: true });
    if (id === 'create') worker.send({ op: 'approve', approvalId: approval.data.approvalId, allow: true });
  }
  const end = await worker.wait(e => e.t === 'turn_end');
  assert.equal(end.data.ok, true);
  assert.equal(end.data.turns, 2);
  assert.equal(end.data.toolCalls, 4);
  assert.equal(end.data.usage.input, 22);
  assert.equal(readFileSync(resolve(worker.workspace, 'a.txt'), 'utf8'), 'first');
  assert.ok(worker.events.some(e => e.t === 'error' && e.data.code === 'no_such_approval'));
  assert.equal(worker.events.filter(e => e.t === 'tool_result' && e.data.ok).length, 4);
  worker.child.stdin.end();
  assert.equal(await worker.closed, 0, worker.stderr());
  assert.throws(() => process.kill(ready.data.mcpPid, 0));
});

test('denial and invalid approval do not call MCP; subsequent turn and new reset work', async t => {
  const worker = launch([actions(call('denied', 'artifact_write', { path: 'no.txt', text: 'must not exist' })), done(), done()]);
  t.after(worker.cleanup);
  await worker.wait(e => e.t === 'ready');
  worker.send({ op: 'prompt', text: 'write' });
  const approval = await worker.wait(e => e.t === 'approval');
  worker.send({ op: 'approve', approvalId: approval.data.approvalId, allow: 'yes' });
  await worker.wait(e => e.t === 'error' && e.data.code === 'invalid_input');
  worker.send({ op: 'approve', approvalId: approval.data.approvalId, allow: false });
  const end = await worker.wait(e => e.t === 'turn_end');
  assert.equal(end.data.ok, false);
  assert.equal(end.data.toolCalls, 0);
  assert.equal(existsSync(resolve(worker.workspace, 'no.txt')), false);
  let start = worker.events.length;
  worker.send({ op: 'prompt', text: 'next' });
  const next = await worker.wait(e => e.t === 'turn_end', start);
  assert.equal(next.data.turns, 1);
  start = worker.events.length;
  worker.send({ op: 'new' });
  await worker.wait(e => e.t === 'notice', start);
  worker.send({ op: 'prompt', text: 'reset script' });
  await worker.wait(e => e.t === 'approval', start);
  worker.child.stdin.end();
  assert.equal(await worker.closed, 0);
  assert.equal(existsSync(resolve(worker.workspace, 'no.txt')), false);
});

test('interrupt pending approval and EOF cleanly stop MCP; call cap is actual requests', async t => {
  const worker = launch([actions(call('blocked', 'artifact_write', { path: 'no.txt', text: 'no' })), done()]);
  t.after(worker.cleanup);
  const ready = await worker.wait(e => e.t === 'ready');
  worker.send({ op: 'prompt', text: 'write' });
  await worker.wait(e => e.t === 'approval');
  worker.send({ op: 'interrupt' });
  await worker.wait(e => e.t === 'idle');
  assert.ok(worker.events.some(e => e.t === 'error' && e.data.code === 'interrupted'));
  assert.equal(existsSync(resolve(worker.workspace, 'no.txt')), false);
  worker.child.stdin.end();
  assert.equal(await worker.closed, 0);
  assert.throws(() => process.kill(ready.data.mcpPid, 0));

  const capped = launch([actions(call('list', 'artifact_list', {})), done()], 1);
  t.after(capped.cleanup);
  await capped.wait(e => e.t === 'ready');
  capped.send({ op: 'prompt', text: 'list' });
  const approval = await capped.wait(e => e.t === 'approval');
  capped.send({ op: 'approve', approvalId: approval.data.approvalId, allow: true });
  const end = await capped.wait(e => e.t === 'turn_end');
  assert.equal(end.data.turns, 1);
  assert.equal(end.data.endReason, 'max_turns');
  capped.child.stdin.end();
  assert.equal(await capped.closed, 0);
});

test('MCP failure is visible and script exhaustion fails rather than repeating', async t => {
  const worker = launch([actions(call('outside', 'artifact_write', { path: '../escape.txt', text: 'forbidden' })), done()]);
  t.after(worker.cleanup);
  await worker.wait(e => e.t === 'ready');
  worker.send({ op: 'prompt', text: 'try invalid path' });
  const approval = await worker.wait(e => e.t === 'approval');
  worker.send({ op: 'approve', approvalId: approval.data.approvalId, allow: true });
  const end = await worker.wait(e => e.t === 'turn_end');
  assert.equal(end.data.ok, false);
  assert.equal(end.data.toolCalls, 1);
  assert.ok(worker.events.some(e => e.t === 'tool_result' && e.data.ok === false));
  const start = worker.events.length;
  worker.send({ op: 'prompt', text: 'exhaust' });
  await worker.wait(e => e.t === 'error' && e.data.code === 'script_exhausted', start);
  await worker.wait(e => e.t === 'idle', start);
  worker.child.stdin.end();
  assert.equal(await worker.closed, 0);
});

test('CLOVA Brain HTTP adapter: loopback protocol, exact shared prompt, schema, history and actual MCP effects', async t => {
  const localRoot = resolve(folder, '.smoke.local');
  mkdirSync(localRoot, { recursive: true });
  const local = mkdtempSync(resolve(localRoot, 'brain-'));
  const keyPath = resolve(local, 'fake-key');
  writeFileSync(keyPath, 'local-test-only-no-real-credential', { mode: 0o600 });
  const fixture = JSON.parse(readFileSync(resolve(folder, '../../clova/fixtures/comparison.json'), 'utf8'));
  const responses: Answer[] = [
    actions(call('http-create', 'artifact_write', { path: fixture.file, text: fixture.steps[0].expectedText })), done(),
    actions(call('http-edit', 'artifact_write', { path: fixture.file, text: fixture.steps[1].expectedText })), done(),
    actions(call('http-undo', 'artifact_undo', {})),
    actions(call('http-read', 'artifact_read', { path: fixture.file })), done(),
  ];
  const requests: Record<string, any>[] = [];
  const serverErrors: Error[] = [];
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v3/chat-completions/HCX-005');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.authorization, 'Bearer local-test-only-no-real-credential');
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      requests.push(body);
      assert.equal(body.maxTokens, 2048);
      assert.equal(body.temperature, 0);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[0].content, fixture.systemPrompt);
      assert.deepEqual(body.tools.map((entry: any) => entry.function.name).sort(), ['clova__artifact_list', 'clova__artifact_read', 'clova__artifact_write', 'clova__artifact_undo'].sort());
      for (const entry of body.tools) {
        assert.equal(entry.type, 'function');
        assert.equal(entry.function.parameters.type, 'object');
        assert.equal(entry.function.parameters.additionalProperties, false);
      }
      const writeTool = body.tools.find((entry: any) => entry.function.name === 'clova__artifact_write');
      assert.deepEqual(writeTool.function.parameters.required.sort(), ['path', 'text']);
      const answer = responses[requests.length - 1];
      assert.ok(answer, 'unexpected model request');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: { code: '20000' }, result: { message: answer.message, finishReason: answer.finishReason, usage: { promptTokens: 11, completionTokens: 5 } } }));
    } catch (error) {
      serverErrors.push(error as Error);
      response.writeHead(500); response.end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const worker = launch([], 4, { model: 'clova:HCX-005', env: { CLOVA_API_KEY_FILE: keyPath, CLOVA_BASE_URL: `http://127.0.0.1:${address.port}` } });
  t.after(worker.cleanup);
  const ready = await worker.wait(e => e.t === 'ready');
  assert.equal(ready.data.model, 'clova:HCX-005');
  if (process.platform === 'linux') {
    const env = readFileSync(`/proc/${ready.data.mcpPid}/environ`, 'utf8');
    assert.equal(env.includes('CLOVA_API_KEY_FILE='), false);
    assert.equal(env.includes('local-test-only-no-real-credential'), false);
  }
  for (let index = 0; index < fixture.steps.length; index++) {
    const step = fixture.steps[index];
    const start = worker.events.length;
    worker.send({ op: 'prompt', text: step.prompt });
    const ids = index === 0 ? ['http-create'] : index === 1 ? ['http-edit'] : ['http-undo', 'http-read'];
    for (const id of ids) {
      const approval = await worker.wait(e => e.t === 'approval' && e.data.callId === id, start);
      worker.send({ op: 'approve', approvalId: approval.data.approvalId, allow: true });
    }
    const end = await worker.wait(e => e.t === 'turn_end', start);
    assert.equal(end.data.ok, true, JSON.stringify(serverErrors.map(e => e.message)));
    assert.equal(end.data.turns, index === 2 ? 3 : 2);
    assert.equal(end.data.toolCalls, ids.length);
    assert.equal(readFileSync(resolve(worker.workspace, fixture.file), 'utf8'), step.expectedText);
  }
  assert.deepEqual(serverErrors, []);
  assert.equal(requests.length, 7);
  const finalHistory = requests.at(-1)!.messages;
  for (const id of ['http-create', 'http-edit', 'http-undo', 'http-read']) {
    assert.ok(finalHistory.some((message: any) => message.role === 'assistant' && message.toolCalls?.some((entry: any) => entry.id === id)), `assistant call history missing: ${id}`);
    const result = finalHistory.find((message: any) => message.role === 'tool' && message.toolCallId === id);
    assert.ok(result, `tool result history missing: ${id}`);
    assert.equal(JSON.parse(result.content).ok, true);
  }
  const readResult = finalHistory.find((message: any) => message.toolCallId === 'http-read');
  assert.ok(readResult.content.includes(fixture.steps[0].expectedText));
  writeFileSync(resolve(local, 'result.json'), JSON.stringify({ kind: 'loopback-clova-protocol-mock', realClova: false, modelRequests: requests.length, verified: ['systemPrompt', 'four MCP schemas', 'toolCallId histories', 'maxTokens=2048', 'temperature=0', 'create-edit-undo-read bytes', 'MCP credential isolation'], finalText: readFileSync(resolve(worker.workspace, fixture.file), 'utf8') }, null, 2));
  worker.child.stdin.end();
  assert.equal(await worker.closed, 0);
  assert.throws(() => process.kill(ready.data.mcpPid, 0));
});
