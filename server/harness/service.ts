import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clean, inside, secretFile, usageZero } from '../../runtime/clova/common.ts';
import { MODE2_PROVIDERS } from '../../runtime/clova/providers.ts';

export class LabError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type LabEvent = { cursor: number; ts: string; t: string; data: Record<string, any> };
type HarnessMode = '2' | '3';
type AdditionalProvider = typeof MODE2_PROVIDERS[number]['id'];
type ProviderId = 'clova' | AdditionalProvider;
type PendingApproval = { approvalId: string; tool: string; callId: string; input: unknown };
const artifactTools = ['artifact_list', 'artifact_read', 'artifact_write', 'artifact_undo'];
const maxTurns = 4;
type Session = {
  id: string; owner: string; mode: 'live' | 'scripted'; provider: ProviderId; model: string; harnessMode: HarnessMode;
  state: 'starting' | 'idle' | 'running' | 'awaiting_approval' | 'invalid' | 'closed';
  root: string; workspace: string; child: ChildProcessWithoutNullStreams;
  events: LabEvent[]; nextCursor: number; lastSeen: number; created: number;
  prompts: number; toolCalls: number; rounds: number; usage: ReturnType<typeof usageZero>;
  ready: Promise<void>; lastTurn: Record<string, any> | null; pendingApproval: PendingApproval | null; exit: Promise<void>;
};
export type LabOptions = {
  accessToken?: string; runtimeDir?: string; root?: string; apiKeyFile?: string;
  apiKey?: string; baseUrl?: string; idleMs?: number; lifetimeMs?: number;
  maxSessions?: number; timeoutMs?: number; maxPrompts?: number;
  providerKeyFiles?: Partial<Record<AdditionalProvider, string>>;
  providerBaseUrls?: Partial<Record<AdditionalProvider, string>>;
};

export class HarnessLab {
  private sessions = new Map<string, Session>();
  private tokenHash?: Buffer;
  private credentialDir?: string;
  private keyFile?: string;
  private timer: ReturnType<typeof setInterval>;
  readonly options: LabOptions;
  readonly runtimeDir: string;
  readonly root: string;

  constructor(options: LabOptions = {}) {
    this.options = options;
    let token = options.accessToken;
    if (!token && process.env.CLOVA_LAB_ACCESS_TOKEN_FILE) {
      try { token = secretFile(process.env.CLOVA_LAB_ACCESS_TOKEN_FILE); } catch { /* disabled until configured */ }
    }
    if (token && token.length >= 32) this.tokenHash = createHash('sha256').update(token).digest();
    this.runtimeDir = options.runtimeDir ?? process.env.CLOVA_RUNTIME_DIR ?? resolve('server-dist/clova');
    this.root = options.root ?? process.env.CLOVA_LAB_DIR ?? join(homedir(), '.local/share/clova-api-lab/harness');
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const s of this.sessions.values()) {
        if (now - s.lastSeen > (options.idleMs ?? 15 * 60000) || now - s.created > (options.lifetimeMs ?? 60 * 60000)) {
          void this.remove(s);
        }
      }
    }, 10000);
    this.timer.unref();
  }

  authenticate(bearer: string | undefined) {
    if (!this.tokenHash) throw new LabError(503, '테스트 접속 설정이 아직 준비되지 않았습니다.');
    const supplied = bearer?.startsWith('Bearer ') ? bearer.slice(7) : '';
    if (!supplied || supplied.length > 256 || !timingSafeEqual(createHash('sha256').update(supplied).digest(), this.tokenHash)) {
      throw new LabError(401, '테스트 전용 접속 링크로 열어 주세요.');
    }
  }

  private apiKeyFile() {
    if (this.keyFile) return this.keyFile;
    const file = this.options.apiKeyFile ?? process.env.CLOVA_API_KEY_FILE;
    if (file) {
      try { secretFile(file); } catch { throw new LabError(503, '서버의 CLOVA 키 파일 설정을 확인해 주세요.'); }
      this.keyFile = resolve(file);
    } else {
      const key = this.options.apiKey ?? process.env.CLOVA_API_KEY;
      if (!key) throw new LabError(503, '서버에 CLOVA API 키가 없습니다. 무료 연결 확인을 선택해 주세요.');
      this.credentialDir = mkdtempSync(join(tmpdir(), 'clova-lab-key-'));
      this.keyFile = join(this.credentialDir, 'credential');
      writeFileSync(this.keyFile, key, { mode: 0o600, flag: 'wx' });
      secretFile(this.keyFile); // Register exact-value redaction in the parent process too.
    }
    return this.keyFile;
  }

  private configuration(provider: ProviderId): { configured: boolean; unavailableReason?: string } {
    if (provider === 'clova') {
      const file = this.options.apiKeyFile ?? process.env.CLOVA_API_KEY_FILE;
      if (!file) return (this.options.apiKey ?? process.env.CLOVA_API_KEY)?.trim()
        ? { configured: true }
        : { configured: false, unavailableReason: '서버에 CLOVA API 키가 등록되지 않았습니다.' };
      try { secretFile(file); return { configured: true }; }
      catch { return { configured: false, unavailableReason: 'CLOVA_API_KEY_FILE의 파일 내용과 권한(600)을 확인해 주세요.' }; }
    }
    const descriptor = MODE2_PROVIDERS.find(item => item.id === provider)!;
    const file = this.options.providerKeyFiles?.[provider] ?? process.env[descriptor.keyFileEnv];
    if (!file) return { configured: false, unavailableReason: `서버에 ${descriptor.keyFileEnv}이 등록되지 않았습니다.` };
    try { secretFile(file); return { configured: true }; }
    catch { return { configured: false, unavailableReason: `${descriptor.keyFileEnv}의 파일 내용과 권한(600)을 확인해 주세요.` }; }
  }

  private providerEnvironment(provider: ProviderId): NodeJS.ProcessEnv {
    if (provider === 'clova') return {
      CLOVA_API_KEY_FILE: this.apiKeyFile(),
      CLOVA_BASE_URL: this.options.baseUrl ?? process.env.CLOVA_BASE_URL ?? 'https://clovastudio.stream.ntruss.com',
    };
    const descriptor = MODE2_PROVIDERS.find(item => item.id === provider)!;
    const configuration = this.configuration(provider);
    if (!configuration.configured) throw new LabError(503, configuration.unavailableReason!);
    const baseUrl = this.options.providerBaseUrls?.[provider] ?? process.env[descriptor.baseUrlEnv];
    return {
      [descriptor.keyFileEnv]: resolve((this.options.providerKeyFiles?.[provider] ?? process.env[descriptor.keyFileEnv])!),
      ...(baseUrl ? { [descriptor.baseUrlEnv]: baseUrl } : {}),
    };
  }

  info() {
    const providers = [{
      id: 'clova', label: 'NAVER CLOVA', models: [{ id: 'HCX-005', label: 'HCX-005' }],
      ...this.configuration('clova'), validationStatus: 'not_verified', harnessModes: ['2', '3'],
    }, ...MODE2_PROVIDERS.map(provider => ({
      id: provider.id, label: provider.label, models: provider.models,
      ...this.configuration(provider.id), validationStatus: 'not_verified', harnessModes: provider.supportedHarnessModes,
    }))];
    return {
      liveAvailable: providers[0].configured, providers,
      models: ['HCX-005'], maxSessions: this.options.maxSessions ?? 2,
      harness: 'langgraph', harnessModes: ['2', '3'], defaultHarnessMode: '3',
      tools: artifactTools.map(name => `clova__${name}`), toolCallLimits: { clova__artifact_undo: 1 },
      maxTurns, maxTokens: 2048, temperature: 0, timeoutMs: this.options.timeoutMs ?? 120000,
      maxPrompts: this.options.maxPrompts ?? 20, idleMinutes: (this.options.idleMs ?? 900000) / 60000,
    };
  }

  private add(s: Session, t: string, data: Record<string, any> = {}, ts = new Date().toISOString()) {
    s.events.push({ cursor: s.nextCursor++, ts, t, data: clean(data) as Record<string, any> });
    if (s.events.length > 1200) s.events.shift();
  }

  async create(owner: string, mode: unknown, model: unknown, harnessMode: unknown = '3', provider: unknown = 'clova') {
    if (mode !== 'live' && mode !== 'scripted') throw new LabError(400, '실제 API 또는 무료 연결 확인을 선택해 주세요.');
    if (harnessMode !== '2' && harnessMode !== '3') throw new LabError(400, '모드 2 또는 모드 3을 선택해 주세요.');
    const descriptor = MODE2_PROVIDERS.find(item => item.id === provider);
    if (provider !== 'clova' && !descriptor) throw new LabError(400, '지원하지 않는 공급자입니다.');
    if (descriptor && harnessMode !== '2') throw new LabError(400, '추가 API 비교는 모드 2에서만 사용할 수 있습니다.');
    if (descriptor && mode !== 'live') throw new LabError(400, '추가 API는 실제 API 테스트를 선택해 주세요. 무료 연결 확인은 공통 고정 응답을 사용합니다.');
    if (mode === 'live' && (provider === 'clova' ? model !== 'HCX-005' : !descriptor!.models.some(item => item.id === model))) {
      throw new LabError(400, '해당 공급자에서 지원하지 않는 모델입니다.');
    }
    const providerId = provider as ProviderId;
    if (this.sessions.size >= (this.options.maxSessions ?? 2)) throw new LabError(429, '진행 중인 테스트가 가득 찼습니다. 기존 테스트를 종료해 주세요.');
    if ([...this.sessions.values()].some(s => s.owner === owner)) throw new LabError(409, '기존 테스트를 먼저 종료해 주세요.');
    const entry = join(this.runtimeDir, 'langgraph.mjs');
    if (!existsSync(entry)) throw new LabError(503, '실행 파일이 없습니다. build:clova-runtime을 먼저 실행해 주세요.');
    let systemPrompt: string;
    try {
      systemPrompt = JSON.parse(readFileSync(join(this.runtimeDir, 'fixtures/comparison.json'), 'utf8')).systemPrompt;
      if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) throw new Error('Missing system prompt');
    } catch { throw new LabError(503, '공통 하네스 프로필을 확인해 주세요.'); }
    const providerEnv = mode === 'live' ? this.providerEnvironment(providerId) : {};
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const root = mkdtempSync(join(this.root, 'session-'));
    const workspace = join(root, 'workspace');
    mkdirSync(workspace, { mode: 0o700 });
    const actualModel = mode === 'live' ? (providerId === 'clova' ? `clova:${model}` : String(model)) : `scripted:${join(this.runtimeDir, 'fixtures/brain.json')}`;
    const profile = join(root, 'profile.json');
    writeFileSync(profile, JSON.stringify({
      maxTurns, timeoutMs: this.options.timeoutMs ?? 120000,
      toolCallLimits: { clova__artifact_undo: 1 },
      servers: [{ name: 'clova', command: [process.execPath, join(this.runtimeDir, 'mcp.mjs'), 'mcp', '--workspace', workspace],
        env: { CLOVA_MCP_ALLOWED_TOOLS: artifactTools.join(',') }, allowedTools: artifactTools }],
      system: systemPrompt,
    }), { mode: 0o600 });
    const child = spawn(process.execPath, ['--max-old-space-size=256', entry, '--events', '--workspace', workspace,
      '--model', actualModel, '--config', profile, '--approve', harnessMode === '2' ? 'ask' : 'never', '--records', join(root, 'records')], {
      cwd: this.runtimeDir, stdio: 'pipe',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
        ...providerEnv },
    });
    let readyResolve!: () => void;
    let readyReject!: (e: Error) => void;
    const ready = new Promise<void>((yes, no) => { readyResolve = yes; readyReject = no; });
    const s: Session = {
      id: randomUUID(), owner, mode, provider: providerId, harnessMode, model: mode === 'live' ? actualModel : 'scripted', state: 'starting', root, workspace,
      child, events: [], nextCursor: 1, created: Date.now(), lastSeen: Date.now(), prompts: 0,
      toolCalls: 0, rounds: 0, usage: usageZero(), ready, lastTurn: null, pendingApproval: null,
      exit: new Promise<void>(r => child.once('close', () => r())),
    };
    this.sessions.set(s.id, s); // Reserve capacity before the first await.
    const startupTimer = setTimeout(() => readyReject(new LabError(504, '실행기 시작 시간이 초과됐습니다.')), 15000);
    child.stdin.on('error', () => {});
    child.stderr.resume();
    child.on('error', () => readyReject(new LabError(503, '실행기를 시작하지 못했습니다.')));
    createInterface({ input: child.stdout }).on('line', line => {
      try {
        const e = JSON.parse(line);
        if (e.v !== 1 || typeof e.t !== 'string' || !e.data) return;
        this.add(s, e.t, e.data, e.ts);
        if (e.t === 'ready') { s.state = 'idle'; readyResolve(); }
        if (e.t === 'turn_start') s.state = 'running';
        if (e.t === 'approval' && s.harnessMode === '2') {
          s.pendingApproval = clean(e.data) as PendingApproval;
          s.state = 'awaiting_approval';
        }
        if (e.t === 'turn_end') {
          s.lastTurn = clean(e.data) as Record<string, any>;
          s.pendingApproval = null;
          for (const k of Object.keys(s.usage) as (keyof typeof s.usage)[]) s.usage[k] += e.data.usage?.[k] ?? 0;
          s.toolCalls += e.data.toolCalls ?? 0;
          s.rounds += e.data.turns ?? 0;
        }
        if (e.t === 'idle') { s.state = e.data.requiresRestart ? 'invalid' : 'idle'; s.pendingApproval = null; }
      } catch { this.add(s, 'error', { message: '실행기 응답을 읽을 수 없습니다.' }); }
    });
    child.once('close', () => {
      s.state = 'closed';
      s.pendingApproval = null;
      this.add(s, 'runner_closed', { message: '테스트 실행기가 종료됐습니다. 새 테스트를 시작해 주세요.' });
      readyReject(new LabError(503, '실행기가 시작 중 종료됐습니다.'));
    });
    try { await ready; return this.snapshot(s); }
    catch (e) { await this.remove(s); throw e; }
    finally { clearTimeout(startupTimer); }
  }

  private get(owner: string, id: string) {
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner) throw new LabError(404, '테스트가 종료되었거나 만료됐습니다. 새로 시작해 주세요.');
    return s;
  }

  private snapshot(s: Session, after = 0) {
    return {
      id: s.id, mode: s.mode, provider: s.provider, model: s.model, state: s.state,
      harness: 'langgraph', harnessMode: s.harnessMode, approval: s.harnessMode === '2' ? 'ask' : 'never',
      pendingApproval: s.pendingApproval ? structuredClone(s.pendingApproval) : null,
      usage: { ...s.usage }, toolCalls: s.toolCalls, rounds: s.rounds, prompts: s.prompts,
      maxPrompts: this.options.maxPrompts ?? 20, lastTurn: s.lastTurn,
      cursor: s.nextCursor - 1, events: s.events.filter(e => e.cursor > after),
    };
  }

  state(owner: string, id: string, after = 0) { return this.snapshot(this.get(owner, id), after); }
  prompt(owner: string, id: string, text: unknown) {
    const s = this.get(owner, id);
    if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw new LabError(400, '요청은 1~6000자로 입력해 주세요.');
    if (s.state !== 'idle') throw new LabError(409, '실행 중이거나 종료된 테스트입니다. 상태를 확인해 주세요.');
    if (s.prompts >= (this.options.maxPrompts ?? 20)) throw new LabError(429, '이 테스트의 요청 상한에 도달했습니다. 결과를 저장하고 새로 시작해 주세요.');
    s.state = 'running'; s.prompts++; s.lastSeen = Date.now(); s.lastTurn = null;
    this.add(s, 'user_prompt', { text });
    s.child.stdin.write(JSON.stringify({ op: 'prompt', text }) + '\n');
    return { ok: true };
  }
  approve(owner: string, id: string, approvalId: unknown, allow: unknown, reason?: unknown) {
    const s = this.get(owner, id);
    if (s.harnessMode !== '2') throw new LabError(409, '모드 3에서는 승인을 요청하지 않습니다.');
    if (typeof approvalId !== 'string' || typeof allow !== 'boolean' ||
        (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000))) {
      throw new LabError(400, '승인 식별자와 허용 여부를 확인해 주세요. 사유는 1000자 이하여야 합니다.');
    }
    if (s.state !== 'awaiting_approval' || s.pendingApproval?.approvalId !== approvalId) {
      throw new LabError(409, '대기 중인 승인이 아닙니다. 최신 상태를 확인해 주세요.');
    }
    s.pendingApproval = null; s.state = 'running'; s.lastSeen = Date.now();
    this.add(s, 'approval_decision', { approvalId, allow, ...(reason !== undefined ? { reason } : {}) });
    s.child.stdin.write(JSON.stringify({ op: 'approve', approvalId, allow, ...(reason !== undefined ? { reason } : {}) }) + '\n');
    return { ok: true };
  }
  interrupt(owner: string, id: string) {
    const s = this.get(owner, id);
    if (s.state === 'running' || s.state === 'awaiting_approval') {
      s.pendingApproval = null; s.state = 'running';
      s.child.stdin.write('{"op":"interrupt"}\n');
    }
    return { ok: true };
  }
  files(owner: string, id: string) {
    const s = this.get(owner, id);
    return readdirSync(s.workspace, { withFileTypes: true }).filter(d => d.isFile() && !d.name.endsWith('.tmp')).map(d => {
      const info = statSync(join(s.workspace, d.name));
      return { name: d.name, bytes: info.size, modifiedAt: info.mtime.toISOString() };
    });
  }
  file(owner: string, id: string, path: unknown) {
    const s = this.get(owner, id);
    let full: string;
    try { full = inside(s.workspace, path); } catch { throw new LabError(400, '작업장 안의 파일만 확인할 수 있습니다.'); }
    if (!existsSync(full)) throw new LabError(404, '파일이 없습니다.');
    const stat = statSync(full);
    if (!stat.isFile() || stat.size > 1048576) throw new LabError(400, '1 MiB 이하 파일만 확인할 수 있습니다.');
    return { name: path, text: readFileSync(full, 'utf8'), bytes: stat.size };
  }
  report(owner: string, id: string) {
    const s = this.get(owner, id);
    return clean({ ...this.snapshot(s), files: this.files(owner, id), exportedAt: new Date().toISOString() });
  }
  async close(owner: string, id: string) { await this.remove(this.get(owner, id)); }
  private async remove(s: Session) {
    if (!this.sessions.has(s.id)) return;
    s.state = 'closed';
    s.pendingApproval = null;
    s.child.stdin.end();
    s.child.kill('SIGTERM');
    const timer = setTimeout(() => s.child.kill('SIGKILL'), 3000);
    await s.exit;
    clearTimeout(timer);
    this.sessions.delete(s.id);
    rmSync(s.root, { recursive: true, force: true });
  }
  async dispose() {
    clearInterval(this.timer);
    await Promise.all([...this.sessions.values()].map(s => this.remove(s)));
    if (this.credentialDir) rmSync(this.credentialDir, { recursive: true, force: true });
  }
}
