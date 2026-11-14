import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
const path = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(path));
if (!report.live || !report.executionCompleted) throw new Error('Completed live report required');
const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
const mapping = {};
const cases = report.sessions.map((session, index) => {
  const id = createHash('sha256').update(`${hash}:${index}`).digest('hex').slice(0,12);
  mapping[id] = { persona: session.persona, variant: session.variant, scenario: session.scenario };
  const persona = report.plan.personas.find(p => p.id === session.persona);
  const scenario = report.plan.scenarios.find(s => s.id === session.scenario);
  const calls = report.calls.filter(c => c.persona === session.persona && c.variant === session.variant && c.scenario === session.scenario);
  return { id, persona: { name: persona.name, policy: persona.policy + '\n' + report.plan.commonPolicy }, rubric: scenario.rubric,
    turns: calls.map((c,i) => ({ user: scenario.prompts[i], assistant: c.reply, operationalStatus: c.status, finishReason: c.finishReason })) };
}).sort((a,b) => a.id.localeCompare(b.id));
writeFileSync(resolve(dirname(path), 'blind-review-packet.json'), JSON.stringify({ sourceSha256: hash, scope: 'AI review, not human gold. Packaging condition withheld.', cases }, null, 2)+'\n');
writeFileSync(resolve(dirname(path), 'blind-review-mapping.json'), JSON.stringify({ sourceSha256: hash, mapping }, null, 2)+'\n');
