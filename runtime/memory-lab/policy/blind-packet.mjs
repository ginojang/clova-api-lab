#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { inside } from '../../clova/common.ts';
import { projectRoot } from './session.mjs';

const [sourceArg, packetArg, mappingArg] = process.argv.slice(2);
assert.ok(sourceArg && packetArg && mappingArg, 'Usage: node blind-packet.mjs SOURCE PACKET MAPPING');
const local = path => inside(projectRoot, relative(projectRoot, resolve(path)));
const source = local(sourceArg), packetPath = local(packetArg), mapPath = local(mappingArg);
assert.ok(!existsSync(packetPath) && !existsSync(mapPath), 'Do not overwrite review evidence');
const raw = readFileSync(source), report = JSON.parse(raw);
assert.ok(report.executionCompleted, 'Only packetize a finished experiment');
const packet = { schemaVersion: 1, instructions: 'Score with the fixed rubric using verbatim response evidence. Variant and draft/repair status are hidden. Independent AI review is not human assessment. Surface guard checks are not semantic truth.', rubric: { scale: report.plan.rubric.scale, axes: report.plan.rubric.axes, criticalFailures: report.plan.rubric.criticalFailures }, items: [] };
const salt = randomBytes(24).toString('hex');
const mapping = { salt, source: relative(projectRoot, source), sha256: createHash('sha256').update(raw).digest('hex'), items: [] };
for (const group of report.groups) for (const row of group.steps) for (const phase of ['draft', 'repair']) {
  const text = phase === 'draft' ? row.draftText : row.repairText;
  if (text === null) continue;
  const key = `${group.personaKey}/${group.variant}/${row.scenarioId}/${phase}`;
  const id = createHash('sha256').update(salt + '\0' + key).digest('hex').slice(0, 14);
  const persona = report.plan.personas.find(p => p.key === group.personaKey).persona;
  packet.items.push({ id, persona, prompt: row.prompt, scoredAxes: row.scoredAxes, activeMemories: row.activeMemorySnapshot, text });
  mapping.items.push({ id, personaKey: group.personaKey, variant: group.variant, scenarioId: row.scenarioId, phase, delivered: row.deliveredText === text });
}
packet.items.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(packetPath, JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 });
writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n', { mode: 0o600 });
process.stdout.write(JSON.stringify({ items: packet.items.length, packet: relative(projectRoot, packetPath) }) + '\n');
