import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, '.local'), { recursive: true });
const runRoot = mkdtempSync(join(here, '.local/smoke-'));
const usage = { input: 11, output: 5, cacheRead: 0, cacheWrite: 0 };
const call = (name, input, id = 'c1') => ({ id, type: 'function', function: { name: `clova__${name}`, arguments: input } });
const action = (...calls) => ({ message: { role: 'assistant', content: '', toolCalls: calls }, finishReason: 'tool_calls', usage });
const done = text => ({ message: { role: 'assistant', content: text }, finishReason: 'stop', usage });
let passed = 0;
async function boot(name, responses, extra = []) {
  const folder = join(runRoot, name); mkdirSync(folder);
  const workspace = join(folder, 'workspace'); mkdirSync(workspace);
  const script = join(folder, 'script.json'); writeFileSync(script, JSON.stringify(responses));
  const child = spawn(process.execPath, [join(here, 'cli.mjs'), '--workspace', workspace, '--script', script, ...extra], { cwd: here, env: { ...process.env, CLOVA_API_KEY: 'must-not-reach-mcp', GROQ_API_KEY: 'must-not-reach-mcp' }, stdio: 'pipe' });
  const events = []; let stderr = ''; let parseError;
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => { try { events.push(JSON.parse(line)); } catch (e) { parseError = e; } });
  const send = op => child.stdin.write(JSON.stringify(op) + '\n');
  async function wait(t, from = 0, predicate = () => true) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (parseError) throw parseError;
      const event = events.slice(from).find(e => e.t === t && predicate(e));
      if (event) return event;
      if (child.exitCode !== null) throw new Error(`${name} exited ${child.exitCode}: ${stderr}\n${JSON.stringify(events)}`);
      await delay(5);
    }
    throw new Error(`${name}: timed out waiting for ${t}\n${stderr}\n${JSON.stringify(events)}`);
  }
  const ready = await wait('ready');
  assert.equal(ready.data.version, '1.5.1');
  assert.equal(ready.data.tools.length, 4);
  const mcpEnv = readFileSync(`/proc/${ready.data.mcpPid}/environ`, 'utf8');
  assert(!mcpEnv.includes('must-not-reach-mcp'));
  let approving = false;
  let seen = 0;
  const poll = setInterval(() => { if (!approving) return; for (const event of events.slice(seen)) if (event.t === 'approval') send({ op: 'approve', approvalId: event.data.approvalId, allow: true }); seen = events.length; }, 2);
  async function prompt(text = 'exercise fixture', auto = true) {
    const start = events.length; approving = auto; seen = start; send({ op: 'prompt', text });
    await wait('idle', start); approving = false;
    return events.slice(start);
  }
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  async function close() {
    clearInterval(poll); child.stdin.end();
    const result = await Promise.race([exited, delay(5000, undefined, { ref: false }).then(() => { child.kill('SIGKILL'); throw new Error('worker failed to exit'); })]);
    assert.equal(result.code, 0, stderr);
    assert.throws(() => process.kill(ready.data.mcpPid, 0), { code: 'ESRCH' });
    assert(events.every((event, index) => event.seq === index + 1));
    writeFileSync(join(folder, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  return { events, send, wait, prompt, close, workspace, child };
}
async function check(name, fn) { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }

await check('real MCP create/edit/undo/read, shared history and synthetic usage', async () => {
  const h = await boot('files', [action(call('artifact_write', { path: 'a.txt', text: 'first' })), done('created'), action(call('artifact_write', { path: 'a.txt', text: 'second' }, 'edit'), call('artifact_undo', {}, 'undo'), call('artifact_read', { path: 'a.txt' }, 'read')), done('verified')]);
  const first = await h.prompt(); const second = await h.prompt();
  assert.equal(readFileSync(join(h.workspace, 'a.txt'), 'utf8'), 'first');
  assert.equal(first.find(e => e.t === 'turn_end').data.toolCalls, 1);
  assert.equal(second.find(e => e.t === 'turn_end').data.toolCalls, 3);
  assert(second.find(e => e.t === 'turn_end').data.messages > first.find(e => e.t === 'turn_end').data.messages);
  assert.deepEqual(second.find(e => e.t === 'turn_end').data.usage, { input: 22, output: 10, cacheRead: 0, cacheWrite: 0 });
  assert(second.filter(e => e.t === 'tool_result').every(e => e.data.ok));
  await h.close();
});
await check('denied, malformed, stale and duplicate approvals never execute MCP', async () => {
  const h = await boot('deny', [action(call('artifact_write', { path: 'denied.txt', text: 'no' })), done('denied')]);
  h.send({ op: 'prompt', text: 'write' }); const approval = await h.wait('approval');
  h.send({ op: 'approve', approvalId: 'stale', allow: true }); await h.wait('error', 0, e => e.data.code === 'no_such_approval');
  h.send({ op: 'approve', approvalId: approval.data.approvalId, allow: 'yes' }); await h.wait('error', 0, e => e.data.code === 'invalid_input');
  h.send({ op: 'approve', approvalId: approval.data.approvalId, allow: false });
  h.send({ op: 'approve', approvalId: approval.data.approvalId, allow: true }); await h.wait('idle');
  assert.equal(h.events.filter(e => e.t === 'error' && e.data.code === 'no_such_approval').length, 2);
  assert.equal(h.events.find(e => e.t === 'turn_end').data.toolCalls, 0);
  assert.equal(h.events.find(e => e.t === 'tool_result').data.ok, false);
  assert(!existsSync(join(h.workspace, 'denied.txt'))); await h.close();
});
await check('interrupt while approval waits prevents writes and allows another prompt', async () => {
  const h = await boot('interrupt', [action(call('artifact_write', { path: 'cancelled.txt', text: 'no' })), done('after interrupt')]);
  h.send({ op: 'prompt', text: 'write' }); await h.wait('approval'); h.send({ op: 'interrupt' });
  const idle = await h.wait('idle'); assert.equal(idle.data.requiresRestart, false);
  assert(h.events.some(e => e.t === 'error' && e.data.code === 'interrupted'));
  assert(!existsSync(join(h.workspace, 'cancelled.txt')));
  const next = await h.prompt(); assert.equal(next.find(e => e.t === 'turn_end').data.ok, true); await h.close();
});
await check('EOF denies pending approval and cleans MCP process', async () => {
  const h = await boot('eof', [action(call('artifact_write', { path: 'cancelled.txt', text: 'no' })), done('no')]);
  h.send({ op: 'prompt', text: 'write' }); await h.wait('approval'); await h.close(); assert(!existsSync(join(h.workspace, 'cancelled.txt')));
});
await check('invalid path returns real MCP error to the agent', async () => {
  const h = await boot('path', [action(call('artifact_write', { path: '../escaped.txt', text: 'no' })), done('handled error')]);
  const events = await h.prompt(); assert.equal(events.find(e => e.t === 'tool_result').data.ok, false); assert.equal(events.find(e => e.t === 'turn_end').data.toolCalls, 1); await h.close();
});
await check('actual model calls capped at four, no fifth MCP effect', async () => {
  const h = await boot('limit', Array.from({ length: 6 }, (_, i) => action(call('artifact_list', {}, `list-${i}`))));
  const events = await h.prompt(); const end = events.find(e => e.t === 'turn_end').data;
  assert.equal(end.turns, 4); assert.equal(end.toolCalls, 4); assert.equal(end.endReason, 'max_turns'); await h.close();
});
await check('script exhaustion explicit, new resets fixture and session', async () => {
  const h = await boot('reset', [done('first')]); const initial = await h.prompt(); const exhausted = await h.prompt();
  assert.equal(exhausted.find(e => e.t === 'turn_end').data.endReason, 'script_exhausted');
  h.send({ op: 'new' }); await h.wait('notice'); const reset = await h.prompt();
  assert.equal(reset.find(e => e.t === 'text').data.text, 'first');
  assert.notEqual(reset.find(e => e.t === 'turn_end').data.sessionId, initial.find(e => e.t === 'turn_end').data.sessionId);
  await h.close();
});
await check('delayed model abort, invalid input and deadline', async () => {
  const h = await boot('timeout', [{ ...done('too late'), delayMs: 10000 }], ['--timeout-ms', '100']);
  h.child.stdin.write('{bad-json\n'); await h.wait('error', 0, e => e.data.code === 'invalid_input');
  const events = await h.prompt(); assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'interrupted'); assert(!events.some(e => e.t === 'text')); await h.close();
});
console.log(JSON.stringify({ passed, runRoot, modelApiCalls: 0 }));
