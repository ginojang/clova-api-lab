import { clovaBodyFault } from './provider-errors.ts';
import { readFileSync } from 'node:fs';
import { Fault, secretFile, usageZero, type Answer, type Message, type Tool, type ToolCall } from './common.ts';
import {OpenAIProvider} from './openai-provider.ts';
import {clovaGenerationConfig, type ClovaGenerationOptions} from './clova-model-config.ts';

export class Brain {
  model: string;
  private script?: Answer[];
  private index = 0;
  private key?: string;
  private compatible?: OpenAIProvider;
  constructor(model: string) {
    this.model = model;
    if (model.startsWith('scripted:')) {
      this.script = JSON.parse(readFileSync(model.slice(9), 'utf8'));
      if (!Array.isArray(this.script) || !this.script.length) throw new Fault('configuration', 'script must be a nonempty response array');
    } else if (/^(groq|openrouter|zai):/.test(model)) {
      this.compatible = new OpenAIProvider(model);
    } else {
      if (!/^clova:[A-Za-z0-9_-]+$/.test(model)) throw new Fault('configuration', 'model must be clova:<model>, an approved mode 2 candidate, or scripted:<file>');
      this.key = secretFile(process.env.CLOVA_API_KEY_FILE);
    }
  }
  reset() { this.index = 0; }
  async call(messages: Message[], tools: Tool[], signal: AbortSignal, generation: ClovaGenerationOptions = {}): Promise<Answer> {
    if (generation.responseFormat !== undefined && this.model !== 'clova:HCX-007') throw new Fault('invalid_argument', 'responseFormat is supported only by clova:HCX-007');
    if (generation.thinkingEffort !== undefined && this.model !== 'clova:HCX-007') throw new Fault('invalid_argument', 'thinkingEffort is supported only by clova:HCX-007');
    if (this.compatible) return this.compatible.call(messages, tools, signal, generation);
    signal.throwIfAborted();
    const maxTokens = generation.maxTokens ?? 2048;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 2048) throw new Fault('invalid_argument', 'maxTokens must be an integer from 1 to 2048');
    if (tools.length && maxTokens < 1024) throw new Fault('invalid_argument', 'CLOVA function calling requires maxTokens of at least 1024');
    if (this.script) {
      const answer = this.script[this.index++ % this.script.length];
      return structuredClone({ ...answer, usage: { ...usageZero(), ...answer.usage } });
    }
    const nativeGeneration = clovaGenerationConfig(this.model, generation, tools.length);
    const base = new URL(process.env.CLOVA_BASE_URL ?? 'https://clovastudio.stream.ntruss.com');
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname))) throw new Fault('configuration', 'CLOVA_BASE_URL requires HTTPS (loopback HTTP is allowed for tests)');
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    let response: Response;
    try { response = await fetch(new URL(`/v3/chat-completions/${this.model.slice(6)}`, base), {
      method: 'POST', signal: requestSignal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ messages, ...nativeGeneration,
        ...(tools.length ? { tools: tools.map(t => ({ type: 'function', function: {
          name: t.name,
          // MCP/compatibility clients may omit a description; native CLOVA requires one.
          // Preserve meaningful caller text and normalize only the outbound request.
          description: typeof t.description === 'string' && t.description.trim() ? t.description : t.name,
          parameters: t.inputSchema,
        } })) } : {}) }),
    }); } catch {
      if (requestSignal.aborted) {
        if (signal.aborted && signal.reason?.name !== 'TimeoutError') throw new Fault('interrupted', 'CLOVA request was cancelled');
        throw new Fault('timeout', 'CLOVA request exceeded its time limit', 504);
      }
      throw new Fault('api_error', 'CLOVA connection failed', 502);
    }
    if (!response.ok) { await response.body?.cancel(); throw new Fault('api_error', `CLOVA HTTP ${response.status}`, response.status); }
    let body: { status?: {code?: string}; result?: { message?: Message; finishReason?: string; usage?: {promptTokens?: number; completionTokens?: number} } };
    try { body = await response.json(); }
    catch {
      if (requestSignal.aborted) throw new Fault(signal.aborted && signal.reason?.name !== 'TimeoutError' ? 'interrupted' : 'timeout', 'CLOVA response was interrupted', 504);
      throw new Fault('api_error', 'CLOVA response is not valid JSON', 502);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Fault('api_error', 'invalid CLOVA response', 502);
    if (body.status?.code !== undefined && body.status.code !== '20000') throw clovaBodyFault(body.status.code);
    const r = body.result;
    if (!r?.message || r.message.role !== 'assistant' || typeof r.message.content !== 'string') throw new Fault('api_error', 'invalid CLOVA response');
    if (!['stop','length','tool_calls'].includes(r.finishReason ?? '')) throw new Fault('api_error', 'unsupported CLOVA finish reason');
    if (r.finishReason === 'tool_calls' && !r.message.toolCalls?.length) throw new Fault('api_error', 'tool_calls response is empty');
    const u = r.usage;
    if (!u || !Number.isFinite(u.promptTokens) || !Number.isFinite(u.completionTokens) || u.promptTokens! < 0 || u.completionTokens! < 0) throw new Fault('api_error', 'CLOVA response has no valid token usage');
    const usage = { input: u.promptTokens!, output: u.completionTokens!, cacheRead: 0, cacheWrite: 0 };
    try { if (r.message.toolCalls !== undefined) r.message.toolCalls = normalizeToolCalls(r.message.toolCalls); }
    catch (e) { if (e instanceof Fault) e.usage = usage; throw e; }
    // Native thinkingContent is provider-internal and must never be replayed as conversation.
    const message: Message = { role: 'assistant', content: r.message.content, ...(r.message.toolCalls !== undefined ? { toolCalls: r.message.toolCalls } : {}) };
    return { message, finishReason: r.finishReason!, usage };
  }
}


/** A live HCX-005 response can contain arguments:null alongside valid calls.
 * Treat this as an empty argument object; the MCP tool validates required fields
 * and returns a repairable invalid_argument instead of losing the whole turn.
 */
export function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) throw new Fault('api_error', 'CLOVA toolCalls must be an array');
  const ids = new Set<string>();
  return value.map(c => {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) || c.type !== 'function' || typeof c.function?.name !== 'string') throw new Fault('api_error', 'invalid CLOVA tool call identity');
    ids.add(c.id);
    let args: unknown = c.function.arguments ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { throw new Fault('api_error', 'CLOVA tool arguments contain invalid JSON'); }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Fault('api_error', 'CLOVA tool arguments must be an object');
    return { id: c.id, type: 'function', function: { name: c.function.name, arguments: args as Record<string, unknown> } };
  });
}
