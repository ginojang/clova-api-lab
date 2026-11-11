import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileContext, runtimeCapabilities } from './compiler.mjs';
import { compileStructuredContext } from './structured.mjs';
import { compileContextV2 } from './compiler-v2.mjs';
import { PolicySession, projectRoot } from './session.mjs';

const persona = { schemaVersion: 'lab.persona.v1', id: 'policy-unit', revision: 1, name: '단비', role: '차분한 안내자', style: { language: '한국어', tone: '해요체', verbosity: '짧게' }, boundaries: ['사용자의 선택을 존중한다.'] };
const cap = runtimeCapabilities('none');
test('compiler preserves complete evidence and excludes over-budget memory without truncating the persona', () => {
  const row = { kind: 'event', slot: 'session', thing: 'practice', value: '연습 모임', polarity: 'positive', state: 'active', revision: 2, evidence_pointer: 'memory://source/2', evidence_digest: 'proof' };
  const full = compileContext(persona, 'hash', [row], 16000, cap);
  assert.deepEqual(full.selectedItems, [row]); assert.ok(full.text.includes(row.evidence_pointer));
  assert.ok(full.text.includes('단비')); assert.ok(full.text.includes('webSearch'));
  const small = compileContext(persona, 'hash', [row], full.contextChars - 1, cap);
  assert.equal(small.selectedCount, 0); assert.equal(small.omittedCount, 1); assert.ok(!small.text.includes('memory://source/2'));
  assert.throws(() => compileContext(persona, 'hash', [], 64, cap), /exceed/);
  assert.equal(runtimeCapabilities('artifacts').webSearch, false); assert.equal(runtimeCapabilities('artifacts').artifacts, true);
});

async function fixture(policy, outputs) {
  const base = join(projectRoot, '.local/policy-tests'); mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'case-'));
  const fixturePath = join(dir, 'persona.json'), script = join(dir, 'script.json');
  writeFileSync(fixturePath, JSON.stringify(persona));
  writeFileSync(script, JSON.stringify(outputs.map(content => ({ message: { role: 'assistant', content }, finishReason: 'stop', usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0 } }))));
  const session = new PolicySession({ dir: join(dir, 'process'), store: join(dir, 'memory.sqlite'), persona: fixturePath, policy, script });
  try { await session.ready(); return session; } catch (e) { await session.close(); throw e; }
}
test('guarded native Pi repairs once, emits exact model text, and excludes rejected draft and internal feedback from later history', async () => {
  const session = await fixture('guarded', ['네 이름은 단비야.', '저는 단비예요. 차근차근 도와드려요.', '먼저 작은 목표 하나를 정해 봐요.']);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 말해 줘.' });
    assert.equal(events.filter(e => e.t === 'model_context').length, 2);
    assert.equal(events.filter(e => e.t === 'policy_check').length, 2);
    assert.equal(events.find(e => e.t === 'text').data.text, '저는 단비예요. 차근차근 도와드려요.');
    assert.equal(events.find(e => e.t === 'turn_end').data.correctionAttempts, 1);
    assert.ok(!events.some(e => e.t === 'tool_call'));
    const next = await session.command({ op: 'prompt', text: '첫 행동은?' });
    const messages = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(!messages.includes('네 이름은 단비야.')); assert.ok(!messages.includes('직전 답변을 한 번만 수정'));
    assert.ok(messages.includes('저는 단비예요. 차근차근 도와드려요.'));
    assert.equal(next.find(e => e.t === 'turn_end').data.externalModelCalls, 0);
  } finally { await session.close(); }
});
test('a repeated violation is blocked after exactly two drafts and clears conversational history', async () => {
  const session = await fixture('guarded', ['네 이름은 단비야.', '네 이름은 단비야.', '준비를 시작해 봐요.']);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 말해 줘.' });
    assert.equal(events.filter(e => e.t === 'model_context').length, 2);
    assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'persona_violation');
    assert.ok(!events.some(e => e.t === 'text'));
    const next = await session.command({ op: 'prompt', text: '준비를 시작하자.' });
    assert.ok(!JSON.stringify(next.find(e => e.t === 'model_context').data.messages).includes('네 이름은 단비야.'));
  } finally { await session.close(); }
});
test('compiled condition preserves uncorrected model evidence, while baseline remains the original JSON anchor', async () => {
  for (const policy of ['baseline', 'compiled']) {
    const session = await fixture(policy, ['네 이름은 단비야.']);
    try {
      const events = await session.command({ op: 'prompt', text: '네 이름을 말해 줘.' });
      assert.equal(events.filter(e => e.t === 'model_context').length, 1);
      assert.equal(events.find(e => e.t === 'text').data.text, '네 이름은 단비야.');
      assert.equal(events.find(e => e.t === 'turn_end').data.correctionAttempts, 0);
      const system = events.find(e => e.t === 'model_context').data.systemPrompt;
      assert.equal(system.includes('OPERATOR PERSONA'), policy === 'baseline');
    } finally { await session.close(); }
  }
});
test('empty model output is an explicit failure, not a successful delivered response', async () => {
  const session = await fixture('compiled', ['   ']);
  try {
    const events = await session.command({ op: 'prompt', text: '오늘의 준비를 도와줘.' });
    assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'empty_response');
    assert.ok(!events.some(e => e.t === 'text'));
  } finally { await session.close(); }
});
test('v2 keeps whole-record memory budgeting and derives style without evaluation answers', () => {
  const row = { kind: 'fact', slot: 'local', thing: 'token', value: 'unique-source-value', state: 'active', evidence_pointer: 'source://unique' };
  const full = compileContextV2(persona, 'hash', [row], 16000, cap);
  assert.ok(full.text.includes('해요체')); assert.ok(full.text.includes('source://unique'));
  assert.equal(full.contextChars, [...full.text].length);
  const small = compileContextV2(persona, 'hash', [row], full.contextChars - 1, cap);
  assert.equal(small.omittedCount, 1); assert.ok(!small.text.includes('source://unique'));
});
test('v2 repairs a detected register violation with actual model text and tracks the added call', async () => {
  const session = await fixture('guarded-v2', ['저는 단비입니다. 작은 목표를 정하면 됩니다.', '저는 단비예요. 작은 목표 하나를 정해 보면 어떨까요?']);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름과 도와줄 방식을 알려줘.' });
    const checks = events.filter(e => e.t === 'policy_check');
    assert.equal(checks.length, 2); assert.equal(checks[0].data.repairNeeded, true); assert.equal(checks[1].data.repairNeeded, false);
    assert.equal(events.find(e => e.t === 'text').data.text, '저는 단비예요. 작은 목표 하나를 정해 보면 어떨까요?');
    assert.equal(events.find(e => e.t === 'turn_end').data.correctionModelCalls, 1);
    assert.equal(events.find(e => e.t === 'turn_end').data.turns, 2);
  } finally { await session.close(); }
});
test('v3 always writes in a fresh context and keeps only the accepted answer in conversation history', async () => {
  const session = await fixture('voiced-v3', ['저는 단비예요. 첫 초안이에요.', '저는 단비예요. 작은 목표 하나부터 정해 봐요.', '다음 초안이에요.', '차근차근 시작해 봐요.']);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름과 도와줄 방식을 알려줘.' });
    const contexts = events.filter(e => e.t === 'model_context').map(e => e.data);
    assert.equal(contexts.length, 2); assert.equal(contexts[1].phase, 'voice');
    assert.equal(contexts[1].messages.filter(m => m.role === 'assistant').length, 0);
    assert.equal(contexts[1].messages.filter(m => m.role === 'user').length, 1);
    assert.ok(contexts[1].systemPrompt.includes('너는 이름이'));
    assert.ok(JSON.stringify(contexts[1].messages).includes('첫 초안이에요.'));
    assert.equal(events.find(e => e.t === 'text').data.text, '저는 단비예요. 작은 목표 하나부터 정해 봐요.');
    const next = await session.command({ op: 'prompt', text: '다음 행동은?' });
    const history = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(!history.includes('첫 초안이에요.')); assert.ok(history.includes('작은 목표 하나부터 정해 봐요.'));
    assert.equal(next.find(e => e.t === 'turn_end').data.rewritingStrategy, 'fresh-context-always');
  } finally { await session.close(); }
});

const packet = reply => JSON.stringify({ self_name: '단비', speaking_style: '해요체', can_web_search: false, can_schedule_notifications: false, can_attend_in_person: false, approved_facts: ['metadata-only-marker'], uncertainties: [], next_action: '', reply });
test('structured Pi delivers only exact generated reply and never replays metadata in conversation', async () => {
  const reply = '  저는 단비예요. 차근차근 시작해 봐요.  ';
  const session = await fixture('structured-v5', [packet(reply), packet('작은 목표를 정해 봐요.')]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름은?' });
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    assert.equal(events.find(e => e.t === 'model_context').data.responseFormat.type, 'json');
    assert.equal(events.find(e => e.t === 'text').data.text, reply);
    assert.equal(events.find(e => e.t === 'structured_reply').data.semanticVerified, false);
    assert.equal(events.find(e => e.t === 'turn_end').data.correctionAttempts, 0);
    const next = await session.command({ op: 'prompt', text: '다음 행동은?' });
    const history = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(history.includes(reply)); assert.ok(!history.includes('metadata-only-marker'));
  } finally { await session.close(); }
});
test('structured metadata does not repair or hide a semantically wrong reply', async () => {
  const session = await fixture('structured-v5', [packet('네 이름은 단비야.')]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름은?' });
    assert.equal(events.find(e => e.t === 'text').data.text, '네 이름은 단비야.');
    assert.equal(events.find(e => e.t === 'policy_check').data.repairNeeded, true);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
  } finally { await session.close(); }
});
test('invalid structured output is retained as raw evidence and cannot produce user text', async () => {
  const session = await fixture('structured-v5', ['{"reply":"저는 단비예요."}', packet('다시 시작해 봐요.')]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름은?' });
    assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'structured_invalid');
    assert.ok(!events.some(e => e.t === 'text'));
    assert.equal(events.find(e => e.t === 'structured_reply_invalid').data.rawContent, '{"reply":"저는 단비예요."}');
    const next = await session.command({ op: 'prompt', text: '다시 시작해 줘.' });
    assert.ok(!JSON.stringify(next.find(e => e.t === 'model_context').data.messages).includes('저는 단비예요.'));
  } finally { await session.close(); }
});
test('structured suffix remains inside the budget and omits only complete memory records', () => {
  const row = { kind: 'fact', slot: 'local', thing: 'token', value: 'unique-source-value', state: 'active', evidence_pointer: 'source://unique' };
  const full = compileStructuredContext(persona, 'hash', [row], 16000, cap);
  assert.equal(full.contextChars, [...full.text].length); assert.equal(full.contextBudget, 16000);
  const small = compileStructuredContext(persona, 'hash', [row], full.contextChars - 1, cap);
  assert.equal(small.omittedCount, 1); assert.ok(!small.text.includes('source://unique'));
  assert.ok(small.contextChars <= small.contextBudget);
});

test('task-aware structured contract derives explicit self-name from the current prompt without rendering an injected prefix', async () => {
  const session = await fixture('structured-v6', [packet('저는 단비예요. 한 문장을 읽어 봐요.'), packet('한 번 천천히 읽어 봐요.')]);
  try {
    const first = await session.command({ op: 'prompt', text: '네 이름을 밝히고 읽기 준비를 도와줘.' });
    const schema = first.find(e => e.t === 'model_context').data.responseFormat.schema;
    assert.ok(schema.properties.reply.description.includes('첫 문장에서 너 자신의 이름이 "단비"'));
    assert.equal(first.find(e => e.t === 'text').data.text, '저는 단비예요. 한 문장을 읽어 봐요.');
    const next = await session.command({ op: 'prompt', text: '다음 연습은?' });
    assert.ok(next.find(e => e.t === 'model_context').data.responseFormat.schema.properties.reply.description.includes('불필요한 자기소개를 반복하지 않는다'));
    assert.equal(next.find(e => e.t === 'turn_end').data.correctionAttempts, 0);
  } finally { await session.close(); }
});

test('demonstrations reach provider input but never become actual conversation or approved memories', async () => {
  const session = await fixture('structured-v7', [packet('저는 단비예요. 먼저 천천히 해 봐요.'), packet('조금씩 해 봐요.')]);
  try {
    const first = await session.command({ op: 'prompt', text: '네 이름을 밝히고 시작을 도와줘.' });
    const context = first.find(e => e.t === 'model_context').data;
    assert.equal(context.demonstrationCount, 4); assert.ok(context.demonstrationChars > 0);
    assert.equal(context.providerMessages.filter(m => m.role === 'assistant').length, 2);
    assert.ok(JSON.stringify(context.providerMessages).includes('[가상 예시 1]'));
    assert.ok(!JSON.stringify(context.messages).includes('[가상 예시 1]'));
    assert.equal(first.find(e => e.t === 'text').data.text, '저는 단비예요. 먼저 천천히 해 봐요.');
    const next = await session.command({ op: 'prompt', text: '다음에는?' });
    const nextContext = next.find(e => e.t === 'model_context').data;
    assert.equal(nextContext.providerMessages.filter(m => m.role === 'assistant').length, 3);
    assert.ok(!JSON.stringify(nextContext.messages).includes('[가상 예시 1]'));
    const recall = await session.command({ op: 'recall' });
    assert.deepEqual(recall.find(e => e.t === 'memories').data.items, []);
  } finally { await session.close(); }
});

test('composed Pi displays only model-written parts with declared separators and retains the exact raw JSON', async () => {
  const parts = { identity: ' 저는 단비예요. ', acknowledgement: '처음이라 막막하셨군요.', answer: '', next_step: '한 단어를 천천히 읽어 봐요.' };
  const raw = JSON.stringify({ ...JSON.parse(packet('')), reply: parts });
  const expected = Object.values(parts).filter(x => x.length > 0).join('\n\n');
  const session = await fixture('composed-v8', [raw, raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 말해주고 읽기 연습을 도와줘.' });
    const decoded = events.find(e => e.t === 'structured_reply').data;
    assert.equal(decoded.rawContent, raw); assert.deepEqual(decoded.rendering.parts, parts);
    assert.equal(decoded.semanticVerified, false);
    assert.equal(events.find(e => e.t === 'text').data.text, expected);
    assert.equal(events.find(e => e.t === 'model_context').data.demonstrationCount, 0);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    const next = await session.command({ op: 'prompt', text: '한 번 더 도와줘.' });
    const history = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(history.includes(JSON.stringify(expected).slice(1, -1)));
    assert.ok(!history.includes('metadata-only-marker'));
  } finally { await session.close(); }
});

test('enacted Pi logs its support plan but displays only generated parts and never replays the plan', async () => {
  const parts = { identity: ' 저는 단비예요. ', acknowledgement: '순서가 헷갈리셨군요.', answer: '', next_step: '카드 한 장을 뒤집고 그림을 확인해 봐요. 순서를 천천히 익힐 수 있어요.' };
  const support_plan = { target: 'plan-only-card-marker', operation: '카드 뒤집기', completion_cue: '그림 확인', persona_choice: '침착하게 작은 확인부터 돕기', reason: '순서를 익히기' };
  const raw = JSON.stringify({ ...JSON.parse(packet('')), support_plan, reply: parts });
  const expected = Object.values(parts).filter(x => x.length > 0).join('\n\n');
  const session = await fixture('enacted-v9', [raw, raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 말해주고 순서를 연습하게 도와줘.' });
    const decoded = events.find(e => e.t === 'structured_reply').data;
    assert.equal(decoded.rawContent, raw);
    assert.deepEqual(decoded.metadata.support_plan, support_plan);
    assert.equal(decoded.semanticVerified, false);
    assert.equal(events.find(e => e.t === 'text').data.text, expected);
    const context = events.find(e => e.t === 'model_context').data;
    assert.deepEqual(context.responseFormat.schema.properties.support_plan.required, Object.keys(support_plan));
    assert.equal(context.demonstrationCount, 0);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    assert.equal(events.find(e => e.t === 'turn_end').data.correctionAttempts, 0);
    const next = await session.command({ op: 'prompt', text: '한 번 더 도와줘.' });
    const history = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(history.includes(JSON.stringify(expected).slice(1, -1)));
    assert.ok(!history.includes('plan-only-card-marker'));
    assert.ok(!history.includes('metadata-only-marker'));
  } finally { await session.close(); }
});

test('enacted invalid plan is preserved as evidence without a fallback answer or another model call', async () => {
  const raw = JSON.stringify({ ...JSON.parse(packet('')), support_plan: { target: 'incomplete' }, reply: { identity: '저는 단비예요.', acknowledgement: '', answer: '', next_step: '' } });
  const session = await fixture('enacted-v9', [raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 알려줘.' });
    assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'structured_invalid');
    assert.equal(events.find(e => e.t === 'structured_reply_invalid').data.rawContent, raw);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    assert.equal(events.filter(e => e.t === 'text').length, 0);
  } finally { await session.close(); }
});

test('slim Pi uses only the native reply contract and replays exact visible words without synthetic metadata', async () => {
  const parts = { identity: ' 저는 단비예요. ', acknowledgement: '', answer: '직접 알림을 보내지는 못해요.', next_step: '적힌 첫 단어를 소리 내어 읽어 봐요. 어디서 멈추는지 알 수 있어요.' };
  const raw = JSON.stringify({ reply: parts });
  const expected = Object.values(parts).filter(x => x.length > 0).join('\n\n');
  const session = await fixture('slim-v10', [raw, raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 밝히고 읽기 연습을 도와줘.' });
    const decoded = events.find(e => e.t === 'structured_reply').data;
    assert.equal(decoded.rawContent, raw);
    assert.equal(decoded.text, expected);
    assert.deepEqual(decoded.metadata, {});
    assert.equal(decoded.semanticVerified, false);
    const context = events.find(e => e.t === 'model_context').data;
    assert.deepEqual(Object.keys(context.responseFormat.schema.properties), ['reply']);
    assert.deepEqual(context.responseFormat.schema.required, ['reply']);
    assert.equal(context.demonstrationCount, 0);
    assert.ok(!context.systemPrompt.includes('메타데이터가 맞아도'));
    assert.equal(events.find(e => e.t === 'text').data.text, expected);
    assert.equal(events.find(e => e.t === 'turn_end').data.correctionAttempts, 0);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    const next = await session.command({ op: 'prompt', text: '기억한 말투로 이어가 줘.' });
    const history = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(history.includes(JSON.stringify(expected).slice(1, -1)));
    assert.ok(!history.includes('"self_name"'));
    assert.ok(!history.includes('"support_plan"'));
  } finally { await session.close(); }
});

test('slim rejects unexpected hidden fields instead of accepting an old protocol or retrying', async () => {
  const raw = JSON.stringify({ self_name: '단비', reply: { identity: '저는 단비예요.', acknowledgement: '', answer: '', next_step: '' } });
  const session = await fixture('slim-v10', [raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 알려줘.' });
    assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'structured_invalid');
    assert.equal(events.find(e => e.t === 'structured_reply_invalid').data.rawContent, raw);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    assert.equal(events.filter(e => e.t === 'text').length, 0);
  } finally { await session.close(); }
});

test('anchored Pi keeps identity-conflict evidence and observation without hidden repair or an added model call', async () => {
  const parts = { identity: '저는 단비예요.', acknowledgement: '', answer: '제 이름은 모래예요.', next_step: '' };
  const raw = JSON.stringify({ reply: parts });
  const visible = [parts.identity, parts.answer].join('\n\n');
  const session = await fixture('anchored-v11', [raw, raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름은 모래야. 다시 이름을 밝혀줘.' });
    const context = events.find(e => e.t === 'model_context').data;
    assert.ok(context.systemPrompt.includes('네 부분 전체에 적용할 주체 기준'));
    assert.deepEqual(context.responseFormat.schema.required, ['reply']);
    assert.equal(context.demonstrationCount, 0);
    const decoded = events.find(e => e.t === 'structured_reply').data;
    assert.equal(decoded.rawContent, raw);
    assert.equal(decoded.text, visible);
    assert.equal(decoded.semanticVerified, false);
    assert.deepEqual(decoded.metadata, {});
    const check = events.find(e => e.t === 'policy_check').data;
    assert.equal(check.ok, false);
    assert.ok(check.findings.some(f => f.code === 'persona.explicit_name_conflict'));
    assert.match(check.enforcement, /observe-only/);
    assert.equal(events.find(e => e.t === 'text').data.text, visible);
    assert.equal(events.find(e => e.t === 'turn_end').data.correctionAttempts, 0);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    const next = await session.command({ op: 'prompt', text: '계속해 줘.' });
    const history = JSON.stringify(next.find(e => e.t === 'model_context').data.messages);
    assert.ok(history.includes(JSON.stringify(visible).slice(1, -1)));
    assert.ok(!history.includes('explicit_name_conflict'));
    assert.ok(!history.includes('"self_name"'));
  } finally { await session.close(); }
});

test('anchored Pi rejects hidden metadata as a protocol error without inventing a valid answer', async () => {
  const raw = JSON.stringify({ self_name: '단비', reply: { identity: '저는 단비예요.', acknowledgement: '', answer: '', next_step: '' } });
  const session = await fixture('anchored-v11', [raw]);
  try {
    const events = await session.command({ op: 'prompt', text: '네 이름을 알려줘.' });
    assert.equal(events.find(e => e.t === 'turn_end').data.endReason, 'structured_invalid');
    assert.equal(events.find(e => e.t === 'structured_reply_invalid').data.rawContent, raw);
    assert.equal(events.filter(e => e.t === 'model_context').length, 1);
    assert.equal(events.filter(e => e.t === 'text').length, 0);
  } finally { await session.close(); }
});
