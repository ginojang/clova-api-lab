import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../db/pool.ts';
import { startMissing, isModelRunning } from '../bench/runner.ts';
import { BENCH_SUITE } from '../bench/suite.ts';

export const benchRouter = Router();

// 프롬프트 세트 메타(프론트가 미평가 항목까지 행으로 표시).
benchRouter.get('/suite', (_req, res) => {
  res.json({
    ok: true,
    prompts: BENCH_SUITE.map((p) => ({
      id: p.id,
      label: p.label,
      category: p.category,
      system: p.system ?? null,
      user: p.user,
    })),
  });
});

// POST /run {model} — 미평가 셀만 채운다(이미 평가된 건 재호출 안 함).
benchRouter.post('/run', async (req, res) => {
  if (!getPool()) {
    res.status(503).json({ ok: false, error: 'DB 비활성' });
    return;
  }
  const model = String(req.body?.model ?? '').trim();
  if (!model) {
    res.status(400).json({ ok: false, error: 'model 은 필수입니다.' });
    return;
  }
  try {
    const { pending, running } = await startMissing(model);
    res.json({ ok: true, model, pending, running });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /cells?model=X — 해당 모델의 셀(평가 결과). running 플래그 포함.
benchRouter.get('/cells', async (req, res) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ ok: false, error: 'DB 비활성' });
    return;
  }
  const model = String(req.query.model ?? '').trim();
  if (!model) {
    res.status(400).json({ ok: false, error: 'model 쿼리 필수' });
    return;
  }
  const [cells] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM bench_cell WHERE model=? ORDER BY id`,
    [model],
  );
  res.json({
    ok: true,
    model,
    total: BENCH_SUITE.length,
    running: isModelRunning(model),
    cells,
  });
});

// GET /models — 셀이 있는 모델 목록.
benchRouter.get('/models', async (_req, res) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ ok: false, error: 'DB 비활성' });
    return;
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT model, COUNT(*) AS n FROM bench_cell GROUP BY model ORDER BY MAX(updated_at) DESC`,
  );
  res.json({ ok: true, models: rows });
});
