export type ChatRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stream?: boolean;
};

export type ChatResponse = {
  ok: boolean;
  provider: 'clova' | 'clova-openai';
  model: string;
  content: string;
  raw: unknown;
  latencyMs: number;
  error?: string;
};
