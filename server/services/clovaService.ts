import type { ChatRequest, ClovaAuthMode, TokenUsage } from '../types/clova.ts';

type ClovaCallResult = {
  ok: boolean;
  status: number;
  content: string;
  raw: unknown;
  latencyMs: number;
  usage?: TokenUsage;
  finishReason?: string;
  error?: string;
};

const BASE_URL = () =>
  process.env.CLOVA_BASE_URL ?? 'https://clovastudio.stream.ntruss.com';

const authMode = (): ClovaAuthMode =>
  (process.env.CLOVA_AUTH_MODE as ClovaAuthMode) ?? 'legacy';

/**
 * 인증 방식별 엔드포인트 + 헤더를 만든다.
 *  - legacy : X-NCP-CLOVASTUDIO-API-KEY + X-NCP-APIGW-API-KEY, /testapp/v1/chat-completions/{model}
 *  - bearer : Authorization: Bearer <key>, /v3/chat-completions/{model} (현행 CLOVA Studio)
 */
function buildEndpoint(model: string) {
  const base = BASE_URL().replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (authMode() === 'bearer') {
    headers['Authorization'] = `Bearer ${process.env.CLOVA_API_KEY ?? ''}`;
    const path = process.env.CLOVA_CHAT_PATH ?? '/v3/chat-completions';
    return { url: `${base}${path}/${model}`, headers };
  }

  headers['X-NCP-CLOVASTUDIO-API-KEY'] = process.env.CLOVA_API_KEY ?? '';
  headers['X-NCP-APIGW-API-KEY'] = process.env.CLOVA_APIGW_API_KEY ?? '';
  const path = process.env.CLOVA_CHAT_PATH ?? '/testapp/v1/chat-completions';
  return { url: `${base}${path}/${model}`, headers };
}

// CLOVA 응답 본문에서 assistant content를 최대한 견고하게 추출.
function extractContent(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const j = json as Record<string, any>;
  return (
    j.result?.message?.content ?? // CLOVA chat-completions
    j.result?.outputText ?? // legacy completions
    j.choices?.[0]?.message?.content ?? // OpenAI 호환
    ''
  );
}

function extractUsage(json: unknown): TokenUsage | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const j = json as Record<string, any>;
  const u = j.result?.usage ?? j.usage; // CLOVA: result.usage / OpenAI: usage
  if (!u) return undefined;
  return {
    promptTokens: u.promptTokens ?? u.prompt_tokens,
    completionTokens: u.completionTokens ?? u.completion_tokens,
    totalTokens: u.totalTokens ?? u.total_tokens,
  };
}

function extractFinishReason(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const j = json as Record<string, any>;
  return j.result?.finishReason ?? j.choices?.[0]?.finish_reason;
}

export async function callClovaChat(req: ChatRequest): Promise<ClovaCallResult> {
  const startedAt = Date.now();
  const { url, headers } = buildEndpoint(req.model);

  const payload = {
    messages: req.messages,
    temperature: req.temperature,
    topP: req.topP,
    maxTokens: req.maxTokens,
    ...(req.stream ? { stream: true } : {}),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let raw: unknown = rawText;
    try {
      raw = JSON.parse(rawText);
    } catch {
      /* 비-JSON 응답은 문자열 그대로 둔다 */
    }

    return {
      ok: response.ok,
      status: response.status,
      content: response.ok ? extractContent(raw) : '',
      raw,
      latencyMs: Date.now() - startedAt,
      usage: extractUsage(raw),
      finishReason: extractFinishReason(raw),
      error: response.ok ? undefined : `CLOVA ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      content: '',
      raw: null,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'fetch failed',
    };
  }
}
