#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Brain } from '../../clova/provider.ts';
import { clean, inside } from '../../clova/common.ts';
import { projectRoot as root } from './session.mjs';
import { voiceRequest } from './voice.mjs';
import { runtimeCapabilities } from './compiler.mjs';
import { inspectResponseV2 } from './guard-v2.mjs';
import { anchoredUser } from './tail.mjs';
import { responseContract, decodeStructuredReply } from './structured.mjs';
import { focusedContract, decodeFocusedReply, taskContract } from './focused.mjs';
import { brainRequest } from '../pi/provider-bridge.mjs';

const args = process.argv.slice(2); assert.ok(args.includes('--live'));
const output = inside(root, relative(root, resolve(args[args.indexOf('--output') + 1]))); assert.ok(!existsSync(output));
const source = resolve(root, 'runtime/memory-lab/results/policy-v2-live-2026-11-11.json');
const sourceRaw = readFileSync(source), previous = JSON.parse(sourceRaw);
assert.ok(previous.executionCompleted);
const allCases = [ ['calm', 'name_tone_pressure'], ['calm', 'restart_reject_draft_recall'], ['calm', 'capabilities_worry_action'] ];
const requestedCase = args.includes('--case') ? args[args.indexOf('--case') + 1] : null;
const cases = requestedCase ? allCases.filter(c => c[1] === requestedCase) : allCases; assert.ok(cases.length);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'clova:HCX-005';
assert.ok(['clova:HCX-005', 'clova:HCX-007'].includes(model));
const generation = { maxTokens: Number(args.includes('--max-tokens') ? args[args.indexOf('--max-tokens') + 1] : 1024), ...(args.includes('--thinking') ? { thinkingEffort: args[args.indexOf('--thinking') + 1] } : {}) };
const report = { kind: 'development replay of actual drafts; not end-to-end or heldout', startedAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(sourceRaw).digest('hex'), source: relative(root, source), model, maxCalls: cases.length, minCallIntervalMs: 10000, parameters: { ...generation, temperature: 0, tools: [] }, requests: 0, usageComplete: true, rows: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const brain = new Brain(report.model), capabilities = runtimeCapabilities('none');
let last = 0;
const save = () => writeFileSync(output, JSON.stringify(clean(report), null, 2) + '\n', { mode: 0o600 });
try {
  for (const [personaKey, scenarioId] of cases) {
    const row = previous.groups.find(g => g.personaKey === personaKey && g.variant === 'guarded-v2').steps.find(s => s.scenarioId === scenarioId);
    const persona = previous.plan.personas.find(p => p.key === personaKey).persona;
    const request = voiceRequest({ persona, prompt: row.prompt, draft: row.draftText, memories: row.activeMemorySnapshot, capabilities });
    let messages = [{ role: 'system', content: request.system }, { role: 'user', content: request.user }];
    if (args.includes('--original')) messages = brainRequest(structuredClone(row.apiAttemptLog[0].context.messages)).messages;
    if (args.includes('--tail')) {
      messages = brainRequest(structuredClone(row.apiAttemptLog[0].context.messages)).messages;
      const i = messages.findLastIndex(m => m.role === 'user'); assert.ok(i >= 0);
      messages[i] = { ...messages[i], content: anchoredUser({ prompt: row.prompt, persona, capabilities }) };
    }
    const structured = args.includes('--structured') || args.includes('--focused') || args.includes('--task-schema');
    const callGeneration = structured ? { ...generation, responseFormat: args.includes('--task-schema') ? taskContract(persona, capabilities, row.prompt) : args.includes('--focused') ? focusedContract(persona, capabilities, row.prompt) : responseContract(persona, capabilities) } : generation;
    if (structured) {
      messages = brainRequest(structuredClone(row.apiAttemptLog[0].context.messages)).messages;
      messages[0].content += '\n필수 JSON 계약을 채우고 reply 필드에 실제 사용자에게 보낼 자연스러운 답변을 작성한다. 다른 필드는 사용자에게 표시되지 않는다. 사용자에게 물은 이름과 사실은 reply에도 빠짐없이 포함한다. 메타데이터가 맞아도 reply의 말투와 사실을 따로 지켜야 한다.';
    }
    await new Promise(r => setTimeout(r, Math.max(0, last + report.minCallIntervalMs - Date.now())));
    last = Date.now(); report.requests++;
    const trial = { personaKey, scenarioId, strategy: args.includes('--task-schema') ? 'task-aware-full-contract' : args.includes('--focused') ? 'focused-visible-reply-contract' : args.includes('--structured') ? 'native-structured-persona-contract' : args.includes('--original') ? 'original-context-generation-configuration' : args.includes('--tail') ? 'tail-boundary-instruction-original-context' : 'fresh-writer', request: {messages, generation: callGeneration}, draft: row.draftText, startedAt: new Date(last).toISOString() }; report.rows.push(trial); save();
    const answer = await brain.call(messages, [], AbortSignal.timeout(120000), callGeneration);
    trial.answer = answer; trial.durationMs = Date.now() - last;
    for (const k of Object.keys(report.usage)) report.usage[k] += answer.usage[k] ?? 0;
    trial.decoded = structured ? args.includes('--focused') ? decodeFocusedReply(answer.message.content) : decodeStructuredReply(answer.message.content, persona, capabilities) : null;
    trial.inspection = inspectResponseV2({ text: trial.decoded?.text ?? answer.message.content, prompt: row.prompt, persona, memories: row.activeMemorySnapshot, capabilities });
    save(); process.stdout.write(JSON.stringify({ scenarioId, text: trial.decoded?.text ?? answer.message.content, findings: trial.inspection.findings }) + '\n');
  }
  report.completed = true;
} catch (error) { if (!report.rows.at(-1)?.answer) report.usageComplete = false; report.error = String(clean(error.message)); report.completed = false; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); }
