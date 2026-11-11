// Exercises the native Brain HTTP adapter on loopback only. No real CLOVA call.
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const comparison = JSON.parse(readFileSync(join(root, 'runtime/clova/fixtures/comparison.json'), 'utf8'));
mkdirSync(join(here, '.smoke.local'), { recursive: true });
const runRoot = mkdtempSync(join(here, '.smoke.local/brain-http-'));
const workspace = join(runRoot, 'workspace'); mkdirSync(workspace);
const keyPath = join(runRoot, 'fake-key'); writeFileSync(keyPath, 'pi-smoke-loopback-fake-key', { mode: 0o600 }); chmodSync(keyPath, 0o600);
const tool = (name, args, id) => ({ id, type: 'function', function: { name: `clova__${name}`, arguments: args } });
const action = (...calls) => ({ message: { role: 'assistant', content: '', toolCalls: calls }, finishReason: 'tool_calls' });
const done = content => ({ message: { role: 'assistant', content }, finishReason: 'stop' });
const answers = [
  action(tool('artifact_write', { path: comparison.file, text: comparison.steps[0].expectedText }, 'create-id')), done('created'),
  action(tool('artifact_write', { path: comparison.file, text: comparison.steps[1].expectedText }, 'edit-id')), done('edited'),
  action(tool('artifact_undo', {}, 'undo-id'), tool('artifact_read', { path: comparison.file }, 'read-id')), done('restored'),
];
const requests = [];
let serverError;
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v3/chat-completions/HCX-005');
    assert.equal(request.headers.authorization, 'Bearer pi-smoke-loopback-fake-key');
    let bytes = '';
    for await (const chunk of request) bytes += chunk;
    const body = JSON.parse(bytes);
    requests.push(body);
    assert.equal(body.maxTokens, 2048); assert.equal(body.temperature, 0);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[0].content, comparison.systemPrompt);
    assert.deepEqual(body.tools.map(t => t.function.name).sort(), comparison.tools.map(n => `clova__${n}`).sort());
    assert(body.tools.every(t => t.type === 'function' && t.function.parameters.type === 'object'));
    const answer = answers[requests.length - 1]; assert(answer, 'unexpected extra model request');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: { code: '20000' }, result: { ...answer, usage: { promptTokens: 11, completionTokens: 5 } } }));
  } catch (error) {
    serverError = error;
    response.writeHead(500); response.end('mock validation failed');
  }
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
const child = spawn(process.execPath, [join(here, 'cli.mjs'), '--workspace', workspace, '--model', 'clova:HCX-005', '--max-turns', '4', '--timeout-ms', '15000'], {
  cwd: root, env: { ...process.env, CLOVA_BASE_URL: base, CLOVA_API_KEY_FILE: keyPath }, stdio: 'pipe',
});
const events = []; let stderr = '';
const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));
child.stderr.on('data', chunk => { stderr += chunk; });
const send = op => child.stdin.write(JSON.stringify(op) + '\n');
createInterface({ input: child.stdout }).on('line', line => {
  const event = JSON.parse(line); events.push(event);
  if (event.t === 'approval') send({ op: 'approve', approvalId: event.data.approvalId, allow: true });
});
async function wait(type, from = 0) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    if (serverError) throw serverError;
    const event = events.slice(from).find(e => e.t === type); if (event) return event;
    if (child.exitCode !== null) throw new Error(`worker exited: ${stderr}\n${JSON.stringify(events)}`);
    await delay(5);
  }
  throw new Error(`wait ${type} timed out: ${JSON.stringify(events)}`);
}
try {
  const ready = await wait('ready');
  assert.equal(ready.data.model, 'clova:HCX-005');
  const env = readFileSync(`/proc/${ready.data.mcpPid}/environ`, 'utf8');
  assert(!env.includes('CLOVA_API_KEY_FILE=')); assert(!env.includes('CLOVA_BASE_URL='));
  for (let index = 0; index < comparison.steps.length; index++) {
    const step = comparison.steps[index], start = events.length;
    send({ op: 'prompt', text: step.prompt }); await wait('idle', start);
    const end = events.slice(start).find(e => e.t === 'turn_end').data;
    assert.equal(end.ok, true); assert.equal(end.turns, 2); assert.equal(end.toolCalls, index === 2 ? 2 : 1);
    assert.deepEqual(end.usage, { input: 22, output: 10, cacheRead: 0, cacheWrite: 0 });
    assert.equal(readFileSync(join(workspace, comparison.file), 'utf8'), step.expectedText);
  }
  assert.equal(requests.length, 6);
  const history = requests.at(-1).messages;
  assert.deepEqual(history.filter(m => m.role === 'user').map(m => m.content), comparison.steps.map(s => s.prompt));
  const toolResults = history.filter(m => m.role === 'tool');
  assert.deepEqual(toolResults.map(m => m.toolCallId), ['create-id', 'edit-id', 'undo-id', 'read-id']);
  assert(toolResults.every(m => JSON.parse(m.content).isError === false));
  const assistantCalls = history.filter(m => m.role === 'assistant').flatMap(m => m.toolCalls ?? []);
  assert.deepEqual(assistantCalls.map(c => c.id), toolResults.map(m => m.toolCallId));
  assert(events.filter(e => e.t === 'tool_result').every(e => e.data.ok));
  child.stdin.end(); const exit = await exited; assert.equal(exit.code, 0, stderr);
  assert.throws(() => process.kill(ready.data.mcpPid, 0), { code: 'ESRCH' });
  const result = { ok: true, framework: 'pi-agent-core', version: '1.5.1', mode: 'mock-loopback-native-Brain', realClovaCalls: 0, mockHttpRequests: requests.length, mcpCalls: 4, checks: ['native CLOVA request/response schema', 'comparison system prompt', '4 tool JSON schemas', 'maxTokens=2048', 'temperature=0', 'tool result IDs/history', 'create/edit/undo/read', 'key isolation', 'MCP cleanup'], runRoot };
  writeFileSync(join(runRoot, 'requests.json'), JSON.stringify(requests, null, 2));
  writeFileSync(join(runRoot, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(join(runRoot, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (child.exitCode === null) { child.stdin.end(); child.kill('SIGTERM'); await exited; }
  await new Promise(resolveClose => server.close(resolveClose));
}
