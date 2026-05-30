import { Router } from 'express';
import { snapshot, startRun, stopRun, type StressCfg } from '../teiStress/runner.ts';

export const teiStressRouter = Router();

// POST /api/tei-stress/run — 부하 시작(단일 활성). { op, concurrency, batch, duration, corpusSize, target? }
teiStressRouter.post('/run', (req, res) => {
  const b = (req.body ?? {}) as Partial<StressCfg> & { target?: string };
  if (!b.op || (b.op !== 'embed' && b.op !== 'rerank')) {
    res.status(400).json({ ok: false, error: "op 필수 ('embed' | 'rerank')" });
    return;
  }
  const cfg: StressCfg = {
    op: b.op,
    concurrency: Math.max(1, Math.min(4096, Number(b.concurrency) || 32)),
    batch: Math.max(1, Math.min(512, Number(b.batch) || 8)),
    duration: Math.max(0, Math.min(3600, Number(b.duration) || 30)),
    corpusSize: Math.max(1, Math.min(1000, Number(b.corpusSize) || 24)),
  };
  const r = startRun(cfg, b.target);
  if (!r.ok) {
    res.status(409).json({ ok: false, error: 'busy', runningId: r.runningId });
    return;
  }
  res.json({ ok: true, runId: r.id, cfg });
});

// POST /api/tei-stress/stop — 활성 run 정지
teiStressRouter.post('/stop', (_req, res) => {
  res.json({ ok: stopRun() });
});

// GET /api/tei-stress/state — 최근 run의 라이브 스냅샷
teiStressRouter.get('/state', (_req, res) => {
  const s = snapshot();
  if (!s) {
    res.status(404).json({ ok: false, error: 'no run' });
    return;
  }
  res.json({ ok: true, ...s });
});
