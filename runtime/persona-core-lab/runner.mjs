import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
export function verifyVendor() {
  const manifest = JSON.parse(readFileSync(resolve(here, 'vendor/manifest.json')));
  for (const [file, expected] of Object.entries(manifest.files)) {
    const actual = createHash('sha256').update(readFileSync(resolve(here, 'vendor', file))).digest('hex');
    if (actual !== expected) throw new Error(`Vendor snapshot changed: ${file}`);
  }
  return manifest;
}

// Runs the unchanged Core executor. Only loopback fixtures replace orchestrator/gateway.
// No production memory writes, MCP tools, inherited hooks, or inherited gateway credentials.
export async function runSession({ prompts, system = '', before = () => ({}), after = () => ({}), complete,
  timeoutMs = 180000, hookTimeoutMs = 5000, stopOnFailure = true }) {
  verifyVendor();
  mkdirSync(resolve(root, '.local/persona-core-lab'), { recursive: true });
  const dir = mkdtempSync(resolve(root, '.local/persona-core-lab/run-'));
  writeFileSync(resolve(dir, 'system.txt'), system);
  const requests = [], events = [], handlerErrors = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push({ path: req.url, body });
      const handler = req.url === '/api/v1_0/turn/before' ? before
        : req.url === '/api/v1_0/turn/after' ? after
        : req.url === '/v1/chat/completions' ? complete : null;
      if (!handler) throw new Error('Unknown route');
      const result = await handler(body, events);
      res.writeHead(result?.httpStatus ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result?.httpStatus ? result.body ?? {} : result));
    } catch (error) {
      handlerErrors.push({ path: req.url, name: error.name });
      // Test infrastructure exceptions must not expose secrets or provider responses.
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'lab_failure', message: 'See experiment ledger' } }));
    }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME,
    ELDA_MODEL: `openai-compat:HCX-007@${url}/v1`, ELDA_WORKSPACE: dir,
    ELDA_SYSTEM: resolve(dir, 'system.txt'), ELDA_HOOKS: resolve(here, 'vendor/eldacore-hooks.ts'),
    ELDA_ORCH_URL: url, ELDA_SESSION_PREFIX: 'cv-orch01-verify-persona-',
    ELDA_HISTORY: '1', ELDA_MAX_TURNS: '2', ELDA_MAX_TOKENS: '1024', ELDA_BRAIN_ALLOW: '',
    ELDA_HOOK_TIMEOUT_MS_UserPromptSubmit: String(hookTimeoutMs), ELDA_HOOK_TIMEOUT_MS_Stop: String(hookTimeoutMs),
    ELDA_HOOK_FAIL_REPLY: '지금은 답변을 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요.' };
  const child = spawn(process.execPath, [resolve(here, 'vendor/src/main.ts')], { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', index = 0, parseError, failedTurn = false;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const ev = JSON.parse(line); events.push(ev);
      if (ev.t === 'turn_end' && !ev.data.ok) failedTurn = true;
      if (ev.t === 'ready' || ev.t === 'idle') {
        if (index < prompts.length && !(stopOnFailure && failedTurn) && handlerErrors.length === 0) {
          const prompt = prompts[index++];
          child.stdin.write(JSON.stringify(typeof prompt === 'string' ? { op: 'prompt', text: prompt } : prompt) + '\n');
        } else child.stdin.end();
      }
    } catch (e) { parseError = e; child.kill(); }
  });
  try {
    await new Promise((yes, no) => {
      const timer = setTimeout(() => { child.kill(); no(new Error('Executor timeout')); }, timeoutMs);
      child.once('error', e => { clearTimeout(timer); no(e); });
      child.once('close', code => { clearTimeout(timer); code === 0 && !parseError ? yes() : no(parseError ?? new Error(`Executor exit ${code}`)); });
    });
    return { events, requests, stderr, handlerErrors, notRunPrompts: prompts.slice(index), sentPrompts: index };
  } finally { child.kill(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
}

export const reply = text => ({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 0, completion_tokens: 0 } });
