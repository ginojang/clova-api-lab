import type { ResultSetHeader } from 'mysql2';
import { getPool } from '../db/pool.ts';
import { callClovaChat } from '../services/clovaService.ts';
import { BENCH_SUITE } from './suite.ts';
import { evaluateCheck } from './checks.ts';
import { judgeOutput } from './judge.ts';

export type BenchConfig = {
  model: string;
  temperature: number;
  topP: number;
  repeats: number;
};

type RoundStat = {
  ok: boolean;
  latencyMs: number;
  tps: number | null;
  completion: number | null;
  truncated: boolean;
  checkPass: boolean | null;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

// bench_run 행을 만들고 백그라운드로 실행. runId 즉시 반환.
export async function startRun(cfg: BenchConfig): Promise<number> {
  const pool = getPool();
  if (!pool) throw new Error('DB unavailable');

  const [ins] = await pool.query<ResultSetHeader>(
    `INSERT INTO bench_run (created_at, provider, model, temperature, top_p, repeats, prompt_count, status)
     VALUES (NOW(), 'clova', ?, ?, ?, ?, ?, 'running')`,
    [cfg.model, cfg.temperature, cfg.topP, cfg.repeats, BENCH_SUITE.length],
  );
  const runId = ins.insertId;

  void executeRun(runId, cfg).catch(async (e) => {
    try {
      await pool.query(`UPDATE bench_run SET status='error', note=? WHERE id=?`, [
        String(e?.message ?? e).slice(0, 2000),
        runId,
      ]);
    } catch {
      /* ignore */
    }
  });

  return runId;
}

async function executeRun(runId: number, cfg: BenchConfig): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const rounds = Math.max(1, cfg.repeats);
  const stats: RoundStat[] = [];
  // 프롬프트별 round=1 결과(평가 대상)
  const judgeTargets = new Map<
    string,
    { promptId: string; resultId: number; content: string; finishReason?: string; label: string; system?: string; user: string; category: string }
  >();

  for (let round = 1; round <= rounds; round++) {
    for (const p of BENCH_SUITE) {
      const out = await callClovaChat({
        model: cfg.model,
        messages: [
          ...(p.system ? [{ role: 'system' as const, content: p.system }] : []),
          { role: 'user' as const, content: p.user },
        ],
        temperature: cfg.temperature,
        topP: cfg.topP,
        maxTokens: p.maxTokens ?? 256,
        stream: false,
      });

      const completion = out.usage?.completionTokens ?? null;
      const tps =
        out.ok && completion && out.latencyMs > 0
          ? Math.round((completion / out.latencyMs) * 1000 * 10) / 10
          : null;
      const truncated = out.finishReason === 'length';
      const checkPass = out.ok ? evaluateCheck(out.content, out.finishReason, p.check) : null;

      const [ins] = await pool.query<ResultSetHeader>(
        `INSERT INTO bench_result
          (run_id, prompt_id, label, category, round, ok, latency_ms, prompt_tokens, completion_tokens,
           tokens_per_sec, finish_reason, truncated, check_kind, check_pass, content, error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          runId,
          p.id,
          p.label,
          p.category,
          round,
          out.ok ? 1 : 0,
          out.latencyMs,
          out.usage?.promptTokens ?? null,
          completion,
          tps,
          out.finishReason ?? null,
          truncated ? 1 : 0,
          p.check.kind,
          checkPass === null ? null : checkPass ? 1 : 0,
          out.content ?? '',
          out.error ?? null,
        ],
      );

      stats.push({ ok: out.ok, latencyMs: out.latencyMs, tps, completion, truncated, checkPass });

      if (round === 1) {
        judgeTargets.set(p.id, {
          promptId: p.id,
          resultId: ins.insertId,
          content: out.content ?? '',
          finishReason: out.finishReason,
          label: p.label,
          system: p.system,
          user: p.user,
          category: p.category,
        });
      }
    }
  }

  // 집계
  const okStats = stats.filter((s) => s.ok);
  const latencies = okStats.map((s) => s.latencyMs).sort((a, b) => a - b);
  const tpsVals = okStats.map((s) => s.tps).filter((x): x is number => x != null);
  const checked = stats.filter((s) => s.checkPass !== null);
  const passCount = checked.filter((s) => s.checkPass).length;

  await pool.query(
    `UPDATE bench_run SET total_calls=?, errors=?, truncated=?, latency_p50=?, latency_p95=?,
       avg_tok_s=?, total_completion_tokens=?, pass_count=?, checked_count=?, pass_rate=? WHERE id=?`,
    [
      stats.length,
      stats.length - okStats.length,
      stats.filter((s) => s.truncated).length,
      percentile(latencies, 50),
      percentile(latencies, 95),
      tpsVals.length ? Math.round((tpsVals.reduce((a, b) => a + b, 0) / tpsVals.length) * 10) / 10 : 0,
      okStats.reduce((a, s) => a + (s.completion ?? 0), 0),
      passCount,
      checked.length,
      checked.length ? passCount / checked.length : 0,
      runId,
    ],
  );

  // 항목별 Claude 평가 (동시 3개)
  const targets = [...judgeTargets.values()];
  await mapLimit(targets, 3, async (t) => {
    const evaluation = await judgeOutput({
      label: t.label,
      system: t.system,
      user: t.user,
      output: t.content,
      finishReason: t.finishReason,
    });
    await pool.query(
      `INSERT INTO bench_evaluation (run_id, result_id, prompt_id, category, judge, judge_model, evaluation, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [runId, t.resultId, t.promptId, t.category, 'claude-cli', process.env.CLAUDE_JUDGE_MODEL ?? '', evaluation],
    );
  });

  await pool.query(`UPDATE bench_run SET status='done' WHERE id=?`, [runId]);
}
