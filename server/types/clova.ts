export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

// 프론트 → 프록시 요청 (CLAUDE.md POST /api/clova/chat 스펙)
export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
};

// 프록시 → 프론트 응답 (통일 포맷)
export type ChatResponse = {
  ok: boolean;
  provider: 'clova' | 'clova-openai';
  model: string;
  content: string;
  raw: unknown; // CLOVA 원문 (개발 중 Raw 표시용)
  latencyMs: number;
  error?: string;
};

export type ClovaAuthMode = 'legacy' | 'bearer';
