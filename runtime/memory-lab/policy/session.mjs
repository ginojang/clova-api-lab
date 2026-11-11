import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean } from '../../clova/common.ts';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pause = ms => new Promise(r => setTimeout(r, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function descendants(pid, result = new Set()) {
  if (!pid || result.has(pid)) return result;
  result.add(pid);
  try { for (const child of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number)) descendants(child, result); } catch {}
  return result;
}

export class PolicySession {
  constructor({ dir, store, persona, policy, script, model = 'clova:HCX-005', maxTokens = 1024, minCallIntervalMs = 0, onEvent = () => {} }) {
    this.dir = dir; this.events = []; this.pids = new Set(); this.stderr = ''; this.exited = false;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const args = [join(projectRoot, 'runtime/memory-lab/pi/cli.mjs'), '--store', store, '--principal', 'policy-eval-user', '--conversation', 'policy-eval-session', '--persona', persona, '--tools', 'none', '--policy', policy, '--max-tokens', String(maxTokens), '--max-turns', (policy.startsWith('guarded') || policy === 'voiced-v3') ? '2' : '1', '--context-chars', '16000', '--min-call-interval-ms', String(minCallIntervalMs)];
    args.push(...(script ? ['--script', script] : ['--model', model]));
    this.proc = spawn(process.execPath, args, { cwd: projectRoot, stdio: 'pipe', env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', CLOVA_API_KEY_FILE: process.env.CLOVA_API_KEY_FILE, CLOVA_BASE_URL: 'https://clovastudio.stream.ntruss.com' } });
    this.proc.stdin.on('error', () => {});
    this.proc.stderr.on('data', b => { this.stderr = (this.stderr + b).slice(-12000); });
    this.exit = new Promise(done => {
      this.proc.on('error', () => { this.spawnError = true; });
      this.proc.once('close', code => { this.exited = true; this.code = code; done(); });
    });
    createInterface({ input: this.proc.stdout }).on('line', line => {
      try { const event = JSON.parse(line); this.events.push(event); onEvent(event); }
      catch { this.badEvent = true; }
    });
  }
  sample() { for (const pid of descendants(this.proc.pid)) this.pids.add(pid); if (this.info?.mcpPid) this.pids.add(this.info.mcpPid); }
  send(value) { if (!this.exited) this.proc.stdin.write(JSON.stringify(value) + '\n'); }
  async ready() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const event = this.events.find(e => e.t === 'ready');
      if (event) { this.info = event.data; this.sample(); return this; }
      if (this.exited) throw new Error('Worker startup failed: ' + clean(this.stderr));
      await pause(10);
    }
    throw new Error('Worker ready timed out');
  }
  async command(command) {
    const start = this.events.length; let cursor = start;
    this.send(command);
    const deadline = Date.now() + 140000;
    while (Date.now() < deadline) {
      this.sample();
      while (cursor < this.events.length) {
        const event = this.events[cursor++];
        if (event.t === 'approval') this.send({ op: 'approve', approvalId: event.data.approvalId, allow: ['remember', 'forget'].includes(command.op) });
        if (event.t === 'idle') { this.persist(); return this.events.slice(start, cursor); }
      }
      if (this.exited) throw new Error('Worker exited during ' + command.op);
      await pause(10);
    }
    this.send({ op: 'interrupt' });
    throw new Error('Worker command timed out');
  }
  persist() {
    writeFileSync(join(this.dir, 'events.jsonl'), this.events.map(e => JSON.stringify(clean(e))).join('\n') + '\n', { mode: 0o600 });
    if (this.stderr) writeFileSync(join(this.dir, 'stderr.txt'), String(clean(this.stderr)), { mode: 0o600 });
  }
  async close() {
    if (this.closed) return; this.closed = true; this.sample(); this.proc.stdin.end();
    const kill = setTimeout(() => { for (const pid of [...this.pids].reverse()) try { process.kill(pid, 'SIGKILL'); } catch {} }, 6000);
    try { await this.exit; } finally { clearTimeout(kill); }
    await pause(50); this.persist();
    const remainingPids = [...this.pids].filter(alive);
    for (const pid of remainingPids) try { process.kill(pid, 'SIGKILL'); } catch {}
    this.cleanup = { exitCode: this.code, remainingPids, jsonlValid: !this.badEvent, sequenceValid: this.events.every((e, i) => e.seq === i + 1) };
    assert.equal(this.code, 0); assert.deepEqual(remainingPids, []); assert.ok(this.cleanup.jsonlValid && this.cleanup.sequenceValid);
  }
}
