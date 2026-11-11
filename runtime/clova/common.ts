import { readFileSync, statSync, realpathSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export class Fault extends Error {
  code: string; status?: number; usage?: Usage;
  providerCode?: string; apiError?: string; retryable?: boolean;
  constructor(code: string, message: string, status?: number) { super(message); this.code = code; this.status = status; }
}
export function secretFile(path: string | undefined): string {
  if (!path) throw new Fault('configuration', 'CLOVA_API_KEY_FILE is required');
  const s = statSync(path);
  if (!s.isFile() || (s.mode & 0o777) !== 0o600) throw new Fault('configuration', 'credential file must have mode 600');
  const key = readFileSync(path, 'utf8').trim();
  if (!key) throw new Fault('configuration', 'credential file is empty');
  secrets.add(key); return key;
}
const secrets = new Set<string>();
function redactBasicCredential(match: string, encoded: string): string {
  // RFC 7617 encodes user-id + ':' + password. Outside an explicit auth header,
  // require that shape so ordinary prose such as "basic cord-knot" survives.
  // https://www.rfc-editor.org/rfc/rfc7617#section-2
  const decoded = Buffer.from(encoded, 'base64');
  const canonical = decoded.toString('base64').replace(/=+$/, '');
  return decoded.includes(0x3a) && canonical === encoded.replace(/=+$/, '') ? 'Authorization ***' : match;
}
export function redact(text: string): string {
  for (const key of secrets) text = text.split(key).join('***');
  return text
    // Explicit header context remains sensitive even for malformed credentials.
    .replace(/(\b(?:Proxy-)?Authorization\b["']?\s*[:=]\s*["']?)(?:Basic|Bearer)\s+[^\s"']+/gi, '$1***')
    .replace(/\bBearer\s+\S+/gi, 'Authorization ***')
    .replace(/\bBasic\s+([A-Za-z0-9+/]+={0,2})(?![A-Za-z0-9+/_=-])/gi, redactBasicCredential)
    .replace(/\b(?:sk-|pk-|rk-|ghp_|gho_|github_pat_|glpat-|xox[baprs]-|AKIA)[\w-]+/g, '***')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***')
    .replace(/((?:password|secret|token|api[_-]?key|PGPASSWORD)\s*[=:]\s*)[^\s,;]+/gi, '$1***')
    .replace(/(https?:\/\/[^\s/:]+:)[^\s@]+@/g, '$1***@');
}
export function clean(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, /(?:^pass$|password|passwd|passphrase|secret|token|api[_-]?key|auth|cookie|credential|private[_-]?key)/i.test(k) && typeof v !== 'boolean' && !/tokens/i.test(k) ? '***' : clean(v)]));
  return value;
}
export function inside(root: string, path: unknown): string {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw new Fault('invalid_argument', 'path must be a nonempty workspace-relative string');
  if (isAbsolute(path)) throw new Fault('denied', 'absolute path is forbidden; use a workspace-relative path');
  const base = realpathSync(root), full = resolve(base, path);
  let probe = full;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const resolved = resolve(realpathSync(probe), relative(probe, full));
  const rel = relative(base, resolved);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Fault('denied', 'path escapes workspace');
  return resolved;
}
export function text(value: unknown, name: string, max = 100000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Fault('invalid_argument', `${name} must be nonempty text, at most ${max} characters`);
  return value;
}
export function number(value: unknown, name: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Fault('invalid_argument', `${name} must be ${min}..${max}; received ${JSON.stringify(value)}`);
  return value;
}
export const usageZero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export type Usage = ReturnType<typeof usageZero>;
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: Record<string, unknown> } };
export type Message = { role: 'system'|'user'|'assistant'|'tool'; content: string; toolCalls?: ToolCall[]; toolCallId?: string; providerReasoning?: {reasoning?: string; reasoningContent?: string; reasoningDetails?: unknown[]} };
export type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> };
export type Answer = { message: Message; usage: Usage; finishReason: string };
