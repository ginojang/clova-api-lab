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

export type StreamHandlers = {
  onToken: (text: string) => void;
  onMeta: (m: { finishReason?: string; usage?: TokenUsage }) => void;
  onEnd: () => void;
  onError: (msg: string, raw?: unknown) => void;
};

// 하나의 SSE 블록(event:/data:)을 파싱해 핸들러로 분배. signal[DONE]이면 true.
function handleSseBlock(block: string, h: StreamHandlers): boolean {
  let event = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event || !data) return false;

  if (event === 'signal') return data.includes('[DONE]');

  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    return false;
  }

  if (event === 'token') {
    h.onToken(parsed?.message?.content ?? '');
  } else if (event === 'result') {
    h.onMeta({
      finishReason: parsed?.finishReason ?? undefined,
      usage: parsed?.usage
        ? {
            promptTokens: parsed.usage.promptTokens,
            completionTokens: parsed.usage.completionTokens,
            totalTokens: parsed.usage.totalTokens,
          }
        : undefined,
    });
  }
  return false;
}

// CLOVA v3 SSE를 읽어 토큰 델타/메타/종료를 콜백으로 전달.
export async function streamClovaChat(
  req: ChatRequest,
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const { url, headers } = buildEndpoint(req.model);
  headers['Accept'] = 'text/event-stream';

  const payload = {
    messages: req.messages,
    temperature: req.temperature,
    topP: req.topP,
    maxTokens: req.maxTokens,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    h.onError(err instanceof Error ? err.message : 'fetch failed');
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    let raw: unknown = text;
    try {
      raw = JSON.parse(text);
    } catch {
      /* keep string */
    }
    h.onError(`CLOVA ${response.status}`, raw);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (handleSseBlock(block, h)) {
          ended = true;
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    h.onError(err instanceof Error ? err.message : 'stream error');
    return;
  }

  if (!ended) {
    // 일부 응답은 [DONE] 없이 스트림이 닫힐 수 있음
  }
  h.onEnd();
}
