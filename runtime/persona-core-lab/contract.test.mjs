import test from 'node:test';
import assert from 'node:assert/strict';
import { runSession as rawRunSession, reply, verifyVendor } from './runner.mjs';

const runSession = async options => {
  const result = await rawRunSession(options);
  assert.deepEqual(result.handlerErrors, [], 'Fixture errors must fail the test even if Stop fails open');
  return result;
};

const ends = run => run.events.filter(e => e.t === 'turn_end');
const calls = run => run.requests.filter(e => e.path === '/v1/chat/completions');
test('snapshot matches six pinned upstream files', () => assert.equal(Object.keys(verifyVendor().files).length, 6));
test('before HTTP failure prevents model call and marks failed answer', async () => {
  const r = await runSession({ prompts: ['안녕'], before: () => ({ httpStatus: 503 }), complete: () => reply('must not run') });
  assert.equal(calls(r).length, 0); assert.equal(ends(r)[0].data.hookFailed, true); assert.equal(ends(r)[0].data.ok, false);
});
test('before timeout prevents model call', async () => {
  const r = await runSession({ prompts: ['안녕'], hookTimeoutMs: 50,
    before: () => new Promise(r => setTimeout(() => r({}), 120)), complete: () => reply('must not run') });
  assert.equal(calls(r).length, 0); assert.equal(ends(r)[0].data.hookFailed, true);
});
test('deterministic identity answer bypasses brain and Stop', async () => {
  const r = await runSession({ prompts: ['누구야?'], before: () => ({ decision: 'block', reason: '저는 다솔이에요.' }), complete: () => reply('must not run') });
  assert.equal(calls(r).length, 0); assert.equal(r.requests.length, 1); assert.equal(ends(r)[0].data.answeredBy, 'hook');
});
test('additionalContext is user role, persists in history, and model allowlist holds', async () => {
  const r = await runSession({ prompts: ['처음', '다음'], system: 'SYSTEM',
    before: () => ({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'PERSONA', brain: 'eldacore:unapproved' } }), complete: () => reply('답') });
  const [a,b] = calls(r).map(c => c.body.messages);
  assert.deepEqual(a, [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'PERSONA\n\n처음' }]);
  assert.equal(b[1].content, 'PERSONA\n\n처음'); assert.equal(b[3].content, 'PERSONA\n\n다음');
  assert.equal(r.events.filter(e => e.t === 'notice').length, 2);
});
test('Stop failure is fail-open', async () => {
  const r = await runSession({ prompts: ['안녕'], after: () => ({ httpStatus: 503 }), complete: () => reply('답') });
  assert.equal(ends(r)[0].data.ok, true); assert.equal(calls(r).length, 1);
});
test('Stop repair has already emitted first answer; bounded to one repair', async () => {
  let n = 0;
  const r = await runSession({ prompts: ['누구야?'], complete: () => reply(++n === 1 ? '나는 악당이야.' : '저는 다솔이에요.'),
    after: (body, events) => { assert.ok(events.some(e => e.t === 'text' && e.data.text === body.last_assistant_message)); return { decision: 'block', reason: '정체성을 고쳐 주세요.' }; } });
  assert.deepEqual(r.events.filter(e => e.t === 'text').map(e => e.data.text), ['나는 악당이야.', '저는 다솔이에요.']);
  assert.deepEqual(r.requests.filter(e => e.path.endsWith('/after')).map(e => e.body.stop_hook_active), [false,true]);
  assert.equal(calls(r).length, 2);
});
test('template drops persona, origin and notifications from stdin prompt', async () => {
  const r = await runSession({ prompts: [{ op: 'prompt', text: '알림', origin: { kind: 'notification' }, persona: 'dasol', notifications: [{ text: '별도 알림' }] }], complete: () => reply('답') });
  const b = r.requests[0].body;
  for (const key of ['origin','persona','notifications']) assert.equal(Object.hasOwn(b,key), false);
  assert.match(b.session_id, /^cv-orch01-verify-persona-/);
});
test('thin module does not carry before turn token to Stop', async () => {
  const r = await runSession({ prompts: ['안녕'], before: () => ({ elda: { turn_token: 'synthetic-turn-1' } }), complete: () => reply('답') });
  const after = r.requests.find(e => e.path.endsWith('/after')).body;
  assert.equal(Object.hasOwn(after, 'turn_token'), false);
  assert.equal(after.session_id, r.requests[0].body.session_id);
});
test('pilot stops after first failed turn instead of testing a history-reset second turn', async () => {
  const r = await runSession({ prompts: ['첫 턴', '후속 턴'], complete: () => ({ httpStatus: 400 }) });
  assert.equal(calls(r).length, 1); assert.deepEqual(r.notRunPrompts, ['후속 턴']);
  assert.equal(ends(r)[0].data.ok, false);
});
test('fixture Stop assertion is surfaced despite executor fail-open', async () => {
  const r = await rawRunSession({ prompts: ['첫 턴', '후속 턴'], complete: () => reply('답'),
    after: () => { throw new Error('Synthetic fixture failure'); } });
  assert.deepEqual(r.handlerErrors, [{ path: '/api/v1_0/turn/after', name: 'Error' }]);
  assert.equal(ends(r)[0].data.ok, true); assert.equal(calls(r).length, 1);
  assert.deepEqual(r.notRunPrompts, ['후속 턴']);
});
