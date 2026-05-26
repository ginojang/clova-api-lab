import type { ChatRequest, ChatResponse } from '../types/clova';

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
