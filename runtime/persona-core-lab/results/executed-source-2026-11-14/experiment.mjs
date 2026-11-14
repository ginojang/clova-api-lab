import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Brain } from '../clova/provider.ts';
import { clean } from '../clova/common.ts';
import { runSession, reply, verifyVendor, here } from './runner.mjs';

const args = process.argv.slice(2);
assert.ok(args.length === 1 && ['--live', '--dry-run'].includes(args[0]), 'Use --live or --dry-run');
const live = args[0] === '--live';
const plan = JSON.parse(readFileSync(resolve(here, 'plan.json')));
assert.equal(plan.maxCalls, plan.personas.length * 2 * plan.scenarios.reduce((n,s) => n + s.prompts.length, 0));
assert.ok(plan.maxCalls <= 24);
if (live && process.env.CLOVA_BASE_URL) assert.equal(process.env.CLOVA_BASE_URL, 'https://clovastudio.stream.ntruss.com');
const outputDir = resolve(here, 'results'); mkdirSync(outputDir, { recursive: true });
const output = resolve(outputDir, `${plan.id}-${live ? 'live' : 'dry'}-${Date.now()}.json`);
assert.ok(!existsSync(output));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), live, scope: 'unchanged Core executor + fixture orchestrator + native CLOVA bridge; no production orchestrator/RAG/memory',
  plan, vendor: verifyVendor(), hashes: Object.fromEntries(['plan.json','runner.mjs','experiment.mjs','../clova/provider.ts','../clova/clova-model-config.ts'].map(p => [p, sha(resolve(here,p))])),
  calls: [], sessions: [], executionCompleted: false, semanticStatus: 'human_pending' };
const save = () => writeFileSync(output, JSON.stringify(clean(report), null, 2) + '\n', { mode: 0o600 });
save();
const brain = live ? new Brain(plan.model) : null;
let lastStarted = 0;
try {
  for (const persona of plan.personas) for (const variant of plan.order[persona.id]) for (const scenario of plan.scenarios) {
    const policy = `${persona.policy}\n${plan.commonPolicy}`;
    const session = { persona: persona.id, variant, scenario: scenario.id, status: 'running' };
    report.sessions.push(session); save();
    const result = await runSession({ prompts: scenario.prompts,
      system: variant === 'system' ? policy : '',
      before: () => variant === 'context' ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: policy } } : {},
      complete: async request => {
        assert.ok(report.calls.length < plan.maxCalls, 'API budget exhausted');
        assert.ok(!request.tools?.length, 'No tools in persona pilot');
        if (live) await new Promise(r => setTimeout(r, Math.max(0, plan.minIntervalMs - (Date.now() - lastStarted))));
        lastStarted = Date.now();
        const call = { id: report.calls.length + 1, persona: persona.id, variant, scenario: scenario.id,
          startedAt: new Date().toISOString(), messages: request.messages, status: 'attempted' };
        report.calls.push(call); save();
        try {
          const a = live ? await brain.call(request.messages, [], AbortSignal.timeout(60000), plan.generation)
            : { message: { content: '합성 응답: 의미 품질 평가에서 제외합니다.' }, finishReason: 'stop', usage: { input: 0, output: 0 } };
          Object.assign(call, { status: 'response', reply: a.message.content, finishReason: a.finishReason, usage: a.usage, durationMs: Date.now() - lastStarted }); save();
          const r = reply(a.message.content);
          r.choices[0].finish_reason = a.finishReason;
          r.usage = { prompt_tokens: a.usage.input, completion_tokens: a.usage.output };
          return r;
        } catch (e) {
          Object.assign(call, { status: 'error', error: { code: e.code ?? 'unknown', httpStatus: e.status ?? null, providerCode: e.providerCode ?? null }, durationMs: Date.now() - lastStarted }); save();
          // A non-retryable bridge response prevents the standard runner's automatic retry.
          return { httpStatus: 400, body: { error: { type: 'recorded_provider_error', message: 'See ledger; retry disabled' } } };
        }
      } });
    Object.assign(session, { status: 'finished', ...result }); save();
    console.log(JSON.stringify({ persona: persona.id, variant, scenario: scenario.id, calls: report.calls.length }));
    // Fail fast on infrastructure/auth/provider errors; retain all attempts and unfinished work.
    if (report.calls.some(c => c.status === 'error')) throw new Error('Provider error; remaining cases not run');
  }
  report.executionCompleted = report.calls.length === plan.maxCalls;
} catch (e) { report.failure = { message: e.message }; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); console.log(output); }
