import { Router } from 'express';
import type { ChatRequest, ChatResponse, TokenUsage } from '../types/clova.ts';
import { callClovaChat, streamClovaChat } from '../services/clovaService.ts';

export const clovaRouter = Router();

// POST /api/clova/chat — 프론트 요청을 받아 CLOVA로 프록시.
clovaRouter.post('/chat', async (req, res) => {
  const body = req.body as ChatRequest;

  if (!body?.model || !Array.isArray(body?.messages)) {
    res.status(400).json({
      ok: false,
      error: 'model 과 messages[] 는 필수입니다.',
    });
    return;
  }

  const result = await callClovaChat(body);

  const payload: ChatResponse = {
    ok: result.ok,
    provider: 'clova',
    model: body.model,
    content: result.content,
    raw: result.raw,
    latencyMs: result.latencyMs,
    usage: result.usage,
    finishReason: result.finishReason,
    error: result.error,
  };

  // 업스트림 실패도 프론트가 Raw로 확인할 수 있게 200으로 감싸 전달(에러는 payload.ok로 판별).
  res.status(200).json(payload);
});

// POST /api/clova/chat/stream — SSE로 토큰 델타를 프론트에 흘려준다.
clovaRouter.post('/chat/stream', async (req, res) => {
  const body = req.body as ChatRequest;

  if (!body?.model || !Array.isArray(body?.messages)) {
    res.status(400).json({ ok: false, error: 'model 과 messages[] 는 필수입니다.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx 버퍼링 비활성(즉시 flush)
  });

  const started = Date.now();
  const ac = new AbortController();
  // 클라이언트 연결이 끊기면 업스트림 취소. (req 'close'는 본문 수신 완료 시에도
  // 발생해 즉시 abort되므로 응답 측 res 'close'를 사용한다.)
  res.on('close', () => ac.abort());

  let finishReason: string | undefined;
  let usage: TokenUsage | undefined;
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  await streamClovaChat(
    body,
    {
      onToken: (text) => {
        if (text) send('token', { text });
      },
      onMeta: (m) => {
        finishReason = m.finishReason;
        usage = m.usage;
      },
      onEnd: () => {
        send('done', { ok: true, finishReason, usage, latencyMs: Date.now() - started });
        res.end();
      },
      onError: (msg, raw) => {
        send('error', { ok: false, error: msg, raw });
        res.end();
      },
    },
    ac.signal,
  );
});
