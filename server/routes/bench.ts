import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../db/pool.ts';
import { startRun } from '../bench/runner.ts';

export const benchRouter = Router();

// POST /api/bench/run — 서버측 배치 실행 시작(비동기). { runId } 반환.
benchRouter.post('/run', async (req, res) => {
  if (!getPool()) {
    res.status(503).json({ ok: false, error: 'DB 비활성 — 벤치 영속화 불가' });
    return;
  }
  const { model, temperature, topP, repeats } = req.body ?? {};
  if (!model) {
    res.status(400).json({ ok: false, error: 'model 은 필수입니다.' });
    return;
  }
  try {
    const runId = await startRun({
      model: String(model),
      temperature: Number(temperature ?? 0.5),
      topP: Number(topP ?? 0.8),
      repeats: Math.max(1, Number(repeats ?? 1)),
    });
    res.json({ ok: true, runId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// GET /api/bench/runs — 최근 배치 목록
benchRouter.get('/runs', async (_req, res) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ ok: false, error: 'DB 비활성' });
    return;
  }
  const [runs] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM bench_run ORDER BY id DESC LIMIT 50`,
  );
  res.json({ ok: true, runs });
});

// GET /api/bench/runs/:id — 배치 1건 + 결과 + Claude 평가
benchRouter.get('/runs/:id', async (req, res) => {
  const pool = getPool();
  if (!pool) {
    res.status(503).json({ ok: false, error: 'DB 비활성' });
    return;
  }
  const id = Number(req.params.id);
  const [runs] = await pool.query<RowDataPacket[]>(`SELECT * FROM bench_run WHERE id=?`, [id]);
  if (!runs.length) {
    res.status(404).json({ ok: false, error: 'run not found' });
    return;
  }
  const [results] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM bench_result WHERE run_id=? ORDER BY id`,
    [id],
  );
  const [evaluations] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM bench_evaluation WHERE run_id=? ORDER BY id`,
    [id],
  );
  res.json({ ok: true, run: runs[0], results, evaluations });
});
