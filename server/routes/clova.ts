import { Router } from 'express';
import type { ChatRequest, ChatResponse } from '../types/clova.ts';
import { callClovaChat } from '../services/clovaService.ts';

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
    error: result.error,
  };

  // 업스트림 실패도 프론트가 Raw로 확인할 수 있게 200으로 감싸 전달(에러는 payload.ok로 판별).
  res.status(200).json(payload);
});
