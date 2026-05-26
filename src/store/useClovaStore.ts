import { create } from 'zustand';
import type { ChatRequest, ChatResponse } from '../types/clova';
import { postChat } from '../api/proxyClient';

type ClovaState = {
  // 파라미터
  model: string;
  systemPrompt: string;
  userInput: string;
  temperature: number;
  topP: number;
  maxTokens: number;

  // 실행 결과
  loading: boolean;
  lastRequest: ChatRequest | null;
  lastResponse: ChatResponse | null;

  set: <K extends keyof ClovaState>(key: K, value: ClovaState[K]) => void;
  run: () => Promise<void>;
};

export const useClovaStore = create<ClovaState>((set, get) => ({
  model: 'HCX-003',
  systemPrompt: '너는 테스트용 AI다.',
  userInput: '안녕?',
  temperature: 0.7,
  topP: 0.8,
  maxTokens: 512,

  loading: false,
  lastRequest: null,
  lastResponse: null,

  set: (key, value) => set({ [key]: value } as Partial<ClovaState>),

  run: async () => {
    const s = get();
    if (s.loading || !s.userInput.trim()) return;

    const request: ChatRequest = {
      model: s.model,
      messages: [
        ...(s.systemPrompt.trim()
          ? [{ role: 'system' as const, content: s.systemPrompt }]
          : []),
        { role: 'user' as const, content: s.userInput },
      ],
      temperature: s.temperature,
      topP: s.topP,
      maxTokens: s.maxTokens,
      stream: false,
    };

    set({ loading: true, lastRequest: request, lastResponse: null });
    try {
      const lastResponse = await postChat(request);
      set({ lastResponse });
    } catch (err) {
      set({
        lastResponse: {
          ok: false,
          provider: 'clova',
          model: s.model,
          content: '',
          raw: null,
          latencyMs: 0,
          error: err instanceof Error ? err.message : '요청 실패',
        },
      });
    } finally {
      set({ loading: false });
    }
  },
}));
