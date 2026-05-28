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

export type TokenUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatResponse = {
  ok: boolean;
  provider: 'clova' | 'clova-openai';
  model: string;
  content: string;
  raw: unknown;
  latencyMs: number;
  usage?: TokenUsage;
  finishReason?: string;
  error?: string;
};
