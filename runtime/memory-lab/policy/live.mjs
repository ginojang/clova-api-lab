#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inside, clean, secretFile } from '../../clova/common.ts';
import { PolicySession, projectRoot as root } from './session.mjs';
import { decodeComposedReply } from './composed.mjs';
import { decodeEnactedReply } from './enacted.mjs';
import { responseContract } from './structured.mjs';
import { runtimeCapabilities } from './compiler.mjs';
import { clovaGenerationConfig } from '../../clova/clova-model-config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
assert.ok(args.includes('--live'), 'Pass --live to make real model API calls');
assert.ok(args.every((a, i) => a === '--live' || ['--output', '--plan'].includes(a) || ['--output', '--plan'].includes(args[i - 1])), 'Unknown option');
secretFile(process.env.CLOVA_API_KEY_FILE);
if (process.env.CLOVA_BASE_URL) assert.equal(new URL(process.env.CLOVA_BASE_URL).origin, 'https://clovastudio.stream.ntruss.com');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const planPath = inside(root, relative(root, resolve(option('--plan', join(here, 'eval-plan.json'))))), plan = JSON.parse(readFileSync(planPath, 'utf8'));
const output = inside(root, relative(root, resolve(option('--output', join(here, '../results/policy-live-2026-11-11.json')))));
assert.ok(!existsSync(output), 'Preserve old evidence: choose a new output path');
const runDir = inside(root, `.local/policy-live/${Date.now()}-${process.pid}`);
mkdirSync(runDir, { recursive: true, mode: 0o700 });
const prompts = plan.steps.filter(s => s.op === 'prompt').length;
assert.equal(prompts * plan.personas.length * plan.variants.length, plan.budget.draftCalls);
const callLimit = plan.budget.maxPlannedTotalCalls;
assert.ok(Number.isSafeInteger(callLimit) && callLimit >= 1 && callLimit <= 60); assert.ok([1024, 2048].includes(plan.generation.maxTokens));
assert.ok(['clova:HCX-005', 'clova:HCX-007'].includes(plan.model));
const profiles = Object.fromEntries(plan.variants.map(variant => [variant, plan.executionProfiles?.[variant] ?? { model: plan.model, policy: variant }]));
const hasExtraCall = policy => policy.startsWith('guarded') || policy === 'voiced-v3';
const isComposed = policy => ['composed-v8', 'enacted-v9'].includes(policy);
const isStructured = policy => policy.startsWith('structured-') || isComposed(policy);
const decodeComposition = policy => policy === 'enacted-v9' ? decodeEnactedReply : decodeComposedReply;
for (const profile of Object.values(profiles)) {
  assert.ok(['clova:HCX-005', 'clova:HCX-007'].includes(profile.model));
  assert.ok(['baseline', 'compiled', 'guarded', 'compiled-v2', 'guarded-v2', 'voiced-v3', 'structured-v5', 'structured-v6', 'structured-v7', 'composed-v8', 'enacted-v9'].includes(profile.policy));
}
assert.ok(plan.budget.draftCalls + Object.values(profiles).filter(p => hasExtraCall(p.policy)).length * plan.personas.length * prompts <= callLimit);
const report = { schemaVersion: 1, runId: plan.id, startedAt: new Date().toISOString(), model: new Set(Object.values(profiles).map(p => p.model)).size > 1 ? 'per-execution-profile' : plan.model, executionProfiles: profiles, framework: 'pi', synthetic: false, provider: 'NAVER CLOVA Studio official HTTPS', planSha256: hash(planPath), plan, rawArtifacts: relative(root, runDir), sourceSnapshots: {}, callLimit, modelRequests: 0, responses: 0, knownUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, usageComplete: true, cost: null, groups: [], executionCompleted: false };
for (const name of ['policy/live.mjs', 'policy/session.mjs', 'policy/compiler.mjs', 'policy/guard.mjs', 'policy/guard-v2.mjs', 'policy/compiler-v2.mjs', 'policy/register.mjs', 'policy/voice.mjs', 'policy/structured.mjs', 'policy/focused.mjs', 'policy/demonstrated.mjs', 'policy/composed.mjs', 'policy/enacted.mjs', 'policy/acceptance-v9.mjs', 'policy/blind-packet.mjs', 'policy/summarize.mjs', '../clova/common.ts', relative(resolve(here, '..'), planPath), 'pi/cli.mjs', 'pi/store.mjs', 'pi/provider-bridge.mjs', '../clova/provider.ts', '../clova/clova-model-config.ts']) {
  const source = resolve(here, '..', name), target = join(runDir, 'source', name.replace('../', 'parent/'));
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, readFileSync(source));
  report.sourceSnapshots[name] = { sha256: hash(source), path: relative(root, target) };
}
const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(clean(report), null, 2) + '\n', { mode: 0o600 }); };
let lastStarted = 0, fatal;
const pause = ms => new Promise(r => setTimeout(r, ms));
const onEvent = event => {
  if (event.t === 'model_context') {
    report.modelRequests++; lastStarted = Date.parse(event.data.callStartedAt);
  }
  if (event.t === 'model_response') {
    if (event.data.ok) report.responses++;
    if (event.data.usage) for (const key of Object.keys(report.knownUsage)) report.knownUsage[key] += event.data.usage[key] ?? 0;
    else report.usageComplete = false;
  }
};
try {
  for (const persona of plan.personas) for (const variant of plan.executionOrder[persona.key]) {
    const profile = profiles[variant];
    const dir = join(runDir, persona.key, variant); mkdirSync(dir, { recursive: true });
    const fixture = join(dir, 'persona.json'); writeFileSync(fixture, JSON.stringify(persona.persona, null, 2) + '\n');
    const group = { responseFormatScope: ['structured-v6', 'structured-v7', 'composed-v8', 'enacted-v9'].includes(profile.policy) ? 'per prompt: exact native schema in apiAttemptLog.context.responseFormat' : 'group nativeGeneration', personaKey: persona.key, variant, model: profile.model, policy: profile.policy, nativeGeneration: clovaGenerationConfig(profile.model, { maxTokens: plan.generation.maxTokens, ...(profile.policy === 'structured-v5' ? { responseFormat: responseContract(persona.persona, runtimeCapabilities('none')) } : {}) }, 0), personaHash: hash(fixture), steps: [], operations: [], processes: [], completed: false };
    report.groups.push(group); save();
    let session, processIndex = 0;
    const start = async () => {
      // Source edits during a trial invalidate the comparison; abort before another call.
      for (const [name, snapshot] of Object.entries(report.sourceSnapshots)) assert.equal(hash(resolve(here, '..', name)), snapshot.sha256, 'Source changed during run');
      session = new PolicySession({ dir: join(dir, `process-${++processIndex}`), store: join(dir, 'memory.sqlite'), persona: fixture, policy: profile.policy, model: profile.model, maxTokens: plan.generation.maxTokens, minCallIntervalMs: plan.budget.minCallIntervalMs, onEvent });
      group.processes.push({ artifactDir: relative(root, session.dir) });
      await session.ready(); assert.equal(session.info.syntheticOnly, false); assert.equal(session.info.model, profile.model);
    };
    const close = async () => { if (session) { try { await session.close(); } finally { group.processes.at(-1).cleanup = session.cleanup ?? null; save(); } } };
    try {
      await start();
      for (const step of plan.steps) {
        if (step.op === 'restart') { await close(); await start(); group.operations.push({ op: 'restart', history: 'empty; same persisted scoped store' }); continue; }
        if (step.op !== 'prompt') {
          const command = step.op === 'remember' ? { op: 'remember', memory: step.memory } : { op: 'observe', turnId: step.turnId, text: step.text };
          const events = await session.command(command);
          assert.ok(!events.some(e => e.t === 'error'), 'Memory operation failed');
          if (step.op === 'remember') assert.ok(events.some(e => e.t === 'memory_result' && e.data.ok), 'Memory was not committed');
          group.operations.push({ ...command, events, history: step.op === 'remember' ? 'cleared after approved non-idempotent memory commit' : 'unchanged' }); save(); continue;
        }
        const reserved = hasExtraCall(profile.policy) ? 2 : 1;
        assert.ok(report.modelRequests + reserved <= callLimit, 'Insufficient bounded call budget');
        const recall = await session.command({ op: 'recall' });
        const activeMemorySnapshot = recall.find(e => e.t === 'memories')?.data.items;
        assert.ok(activeMemorySnapshot);
        await pause(Math.max(0, lastStarted + plan.budget.minCallIntervalMs - Date.now()));
        const events = await session.command({ op: 'prompt', text: step.text });
        const end = events.find(e => e.t === 'turn_end')?.data;
        const attempts = events.filter(e => e.t === 'model_context').map(e => {
          const response = events.find(r => r.t === 'model_response' && r.data.requestIndex === e.data.requestIndex);
          return { context: e.data, response: response?.data ?? null, startedAt: e.ts, finishedAt: response?.ts ?? null, latencyMs: response ? Date.parse(response.ts) - Date.parse(e.ts) : null };
        });
        const deliveredText = events.filter(e => e.t === 'text').map(e => e.data.text).join('');
        const decoded = events.find(e => e.t === 'structured_reply')?.data;
        const row = { deliverySource: isComposed(profile.policy) ? 'exact model-generated reply parts joined with two newlines; no generated words added by renderer' : isStructured(profile.policy) ? 'exact parsed model JSON reply field' : 'exact model content', rawDraftContent: attempts[0]?.response?.content ?? null, structuredMetadata: decoded?.metadata ?? null, rendering: decoded?.rendering ?? null, postProcessing: isStructured(profile.policy) ? 'parse/render only; no semantic repair' : profile.policy === 'voiced-v3' ? 'fresh-context-always' : 'same-history-if-violation', scenarioId: step.id, prompt: step.text, scoredAxes: step.scoredAxes, activeMemorySnapshot, draftText: isStructured(profile.policy) ? decoded?.text ?? null : attempts[0]?.response?.content ?? null, repairText: attempts[1]?.response?.content ?? null, deliveredText: deliveredText || null, deliveryStatus: end?.ok ? 'delivered' : end?.endReason === 'persona_violation' ? 'blocked' : 'error', policyChecks: events.filter(e => e.t === 'policy_check').map(e => e.data), apiAttemptLog: attempts, turnEnd: end ?? null, errors: events.filter(e => e.t === 'error').map(e => e.data), historyAfter: end?.ok ? 'accepted conversation; repair internals removed' : 'cleared by worker' };
        group.steps.push(row); save();
        assert.ok(end && attempts.length <= reserved, 'Unexpected model call count');
        for (const attempt of attempts) {
          assert.equal(attempt.context.omittedCount, 0, 'Context budget omitted a memory');
          assert.equal(attempt.context.selectedCount, activeMemorySnapshot.length, 'Conditions differ in selected memories');
        }
        if (deliveredText) assert.equal(deliveredText, isComposed(profile.policy) ? decodeComposition(profile.policy)(attempts.at(-1).response.content, persona.persona, runtimeCapabilities('none')).text : isStructured(profile.policy) ? JSON.parse(attempts.at(-1).response.content).reply : attempts.at(-1)?.response?.content, 'Delivered text must be exact model output');
        assert.ok(events.every(e => !['tool_call', 'tool_result', 'approval'].includes(e.t)), 'Dialogue invoked a tool');
        if (end.endReason !== 'completed' && end.endReason !== 'persona_violation') throw new Error('Recorded model/operational failure: ' + end.endReason);
        process.stdout.write(JSON.stringify({ persona: persona.key, variant, scenario: step.id, delivery: row.deliveryStatus, requests: report.modelRequests, repairs: end.correctionAttempts }) + '\n');
      }
      group.completed = true;
    } finally { await close(); }
  }
  report.executionCompleted = true;
} catch (error) { fatal = error; report.error = String(clean(error.message)); }
finally {
  report.finishedAt = new Date().toISOString();
  const rows = report.groups.flatMap(g => g.steps);
  report.summary = { attemptedPrompts: rows.length, delivered: rows.filter(r => r.deliveryStatus === 'delivered').length, blocked: rows.filter(r => r.deliveryStatus === 'blocked').length, errors: rows.filter(r => r.deliveryStatus === 'error').length, repairs: rows.reduce((s, r) => s + (r.turnEnd?.correctionAttempts ?? 0), 0) };
  save(); process.stdout.write(JSON.stringify({ output: relative(root, output), executionCompleted: report.executionCompleted, modelRequests: report.modelRequests, ...report.summary }) + '\n');
}
if (fatal) process.exitCode = 1;
