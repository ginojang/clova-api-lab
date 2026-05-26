import { Router } from 'express';
import type { HealthResponse } from '../types/health.ts';

export const healthRouter = Router();

// GET /health — 프록시 생존 확인용. hellcat/EC2 헬스체크가 이 엔드포인트를 친다.
healthRouter.get('/health', (_req, res) => {
  const body: HealthResponse = {
    ok: true,
    service: 'clova-api-lab',
    time: new Date().toISOString(),
  };
  res.json(body);
});
