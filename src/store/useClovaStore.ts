import { create } from 'zustand';
import type { ChatRequest, ChatResponse } from '../types/clova';
import { postChat, postChatStream } from '../api/proxyClient';

export type Mode = 'bench' | 'llm' | 'vision' | 'fsm' | 'chat';

type ClovaState = {
  mode: Mode;

  // 파라미터
  model: string;
  systemPrompt: string;
  userInput: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  stream: boolean;

  // 실행 결과
  loading: boolean;
  lastRequest: ChatRequest | null;
  lastResponse: ChatResponse | null;
  streamingText: string; // 스트리밍 중 누적 텍스트(라이브 표시)
  ttftMs: number | null; // time-to-first-token

  set: <K extends keyof ClovaState>(key: K, value: ClovaState[K]) => void;
  run: () => Promise<void>;
};

export const useClovaStore = create<ClovaState>((set, get) => ({
  mode: 'bench',

  model: 'HCX-005',
  systemPrompt: '너는 테스트용 AI다.',
  userInput: '안녕?',
  temperature: 0.7,
  topP: 0.8,
  maxTokens: 512,
  stream: true,

  loading: false,
  lastRequest: null,
  lastResponse: null,
  streamingText: '',
  ttftMs: null,

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
      stream: s.stream,
    };

    set({
      loading: true,
      lastRequest: request,
      lastResponse: null,
      streamingText: '',
      ttftMs: null,
    });

    if (s.stream) {
      const start = performance.now();
      let acc = '';
      let ttft: number | null = null;
      await postChatStream(request, {
        onToken: (text) => {
          if (ttft === null) {
            ttft = Math.round(performance.now() - start);
            set({ ttftMs: ttft });
          }
          acc += text;
          set({ streamingText: acc });
        },
        onDone: (meta) => {
          set({
            lastResponse: {
              ok: true,
              provider: 'clova',
              model: s.model,
              content: acc,
              raw: { streamed: true, finishReason: meta.finishReason, usage: meta.usage },
              latencyMs: meta.latencyMs ?? Math.round(performance.now() - start),
              usage: meta.usage,
              finishReason: meta.finishReason,
            },
          });
        },
        onError: (msg) => {
          set({
            lastResponse: {
              ok: false,
              provider: 'clova',
              model: s.model,
              content: acc,
              raw: null,
              latencyMs: Math.round(performance.now() - start),
              error: msg,
            },
          });
        },
      });
      set({ loading: false });
      return;
    }

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
