import type { ChatRequest, ChatResponse, TokenUsage } from '../types/clova';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3600';

// 프론트는 항상 로컬 프록시만 호출한다 (CLOVA 직접 호출 금지).
export async function postChat(req: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/clova/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return (await res.json()) as ChatResponse;
}

export type StreamDone = {
  ok: boolean;
  finishReason?: string;
  usage?: TokenUsage;
  latencyMs?: number;
};

export type StreamCallbacks = {
  onToken: (text: string) => void;
  onDone: (meta: StreamDone) => void;
  onError: (msg: string) => void;
};

// SSE(event: token/done/error)를 fetch 스트림으로 소비.
export async function postChatStream(req: ChatRequest, cb: StreamCallbacks): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/clova/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (err) {
    cb.onError(err instanceof Error ? err.message : '요청 실패');
    return;
  }
  if (!res.ok || !res.body) {
    cb.onError(`HTTP ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let event = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!event || !data) continue;

      if (event === 'token') {
        try {
          cb.onToken(JSON.parse(data).text ?? '');
        } catch {
          /* skip malformed */
        }
      } else if (event === 'done') {
        try {
          cb.onDone(JSON.parse(data) as StreamDone);
        } catch {
          cb.onDone({ ok: true });
        }
      } else if (event === 'error') {
        try {
          cb.onError((JSON.parse(data) as { error?: string }).error ?? '스트림 에러');
        } catch {
          cb.onError('스트림 에러');
        }
      }
    }
  }
}
