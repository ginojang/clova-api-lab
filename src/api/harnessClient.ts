const API = `${import.meta.env.VITE_API_BASE ?? 'http://localhost:3600'}/api/harness`;
const ACCESS = 'clova-harness-access';
const CLIENT = 'clova-harness-client';
const SESSION = 'clova-harness-session';

// This is a narrowly scoped test-access capability, never a CLOVA API credential.
export function loadAccess() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const incoming = fragment.get('access');
  if (incoming) {
    sessionStorage.setItem(ACCESS, incoming);
    fragment.delete('access');
    const hash = fragment.toString();
    history.replaceState(null, '', `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`);
  }
  return sessionStorage.getItem(ACCESS) ?? '';
}
export function setAccess(token: string) { sessionStorage.setItem(ACCESS, token.trim()); }
export function savedSession() { return sessionStorage.getItem(SESSION); }
export function rememberSession(id: string | null) { if (id) sessionStorage.setItem(SESSION, id); else sessionStorage.removeItem(SESSION); }
function clientId() {
  let id = sessionStorage.getItem(CLIENT);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(CLIENT, id); }
  return id;
}
export class HarnessHttpError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function harnessRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init, cache: 'no-store', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${loadAccess()}`,
      'X-Harness-Client': clientId(), ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({ error: `서버 응답 오류 (${res.status})` }));
  if (!res.ok) throw new HarnessHttpError(body.error ?? `요청 실패 (${res.status})`, res.status);
  return body as T;
}

export type HarnessProviderId = 'clova' | 'groq' | 'openrouter' | 'zai';
export type HarnessProvider = { id: HarnessProviderId; label: string; models: { id: string; label: string }[]; configured: boolean; validationStatus: 'not_verified'; harnessModes: ('2' | '3')[]; unavailableReason?: string };
export type HarnessInfo = { liveAvailable: boolean; models: string[]; providers: HarnessProvider[]; maxTurns: number; timeoutMs: number; maxPrompts: number; idleMinutes: number; harness?: 'langgraph' };
export type HarnessEvent = { cursor: number; ts: string; t: string; data: Record<string, unknown> };
export type HarnessSnapshot = {
  id: string; mode: 'live' | 'scripted'; model: string; provider: HarnessProviderId;
  harnessMode: '2' | '3'; harness: 'langgraph'; approval: 'ask' | 'never';
  pendingApproval: { approvalId: string; tool: string; callId: string; input: unknown } | null;
  state: 'starting' | 'idle' | 'running' | 'awaiting_approval' | 'invalid' | 'closed';
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  toolCalls: number; rounds: number; prompts: number; maxPrompts: number;
  cursor: number; events: HarnessEvent[];
  lastTurn: { ok: boolean; durationMs: number; endReason: string } | null;
};
export type HarnessFile = { name: string; bytes: number; modifiedAt: string };
