import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { getPool } from '../db/pool.ts';
import { callClovaChat } from '../services/clovaService.ts';
import { BENCH_SUITE, type BenchPrompt } from './suite.ts';
import { judgeOutput } from './judge.ts';

// 진행 중인 모델(메모리). 재시작 시 초기화.
const runningModels = new Set<string>();
export function isModelRunning(model: string): boolean {
  return runningModels.has(model);
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

// Claude 평가의 최종 판정 추출(자기정정 대비 — '최종판정' 우선, 없으면 마지막 '판정').
function parseVerdict(text: string): 'PASS' | 'FAIL' | null {
  const fin = [...text.matchAll(/최종\s*판정\s*[:：]\s*(PASS|FAIL)/gi)];
  if (fin.length) return fin[fin.length - 1][1].toUpperCase() as 'PASS' | 'FAIL';
  const any = [...text.matchAll(/판정\s*[:：]\s*(PASS|FAIL)/gi)];
  return any.length ? (any[any.length - 1][1].toUpperCase() as 'PASS' | 'FAIL') : null;
}

// 모델의 미평가(verdict NULL 또는 셀 없음) 프롬프트만 계산해 upsert. 비동기 백그라운드.
export async function startMissing(model: string): Promise<{ pending: number; running: boolean }> {
  const pool = getPool();
  if (!pool) throw new Error('DB unavailable');

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT prompt_id FROM bench_cell WHERE model=? AND verdict IS NOT NULL`,
    [model],
  );
  const done = new Set(rows.map((r) => r.prompt_id as string));
  const missing = BENCH_SUITE.filter((p) => !done.has(p.id));

  if (!missing.length || runningModels.has(model)) {
    return { pending: missing.length, running: runningModels.has(model) };
  }

  runningModels.add(model);
  void (async () => {
    try {
      await mapLimit(missing, 3, (p) => computeCell(model, p));
    } finally {
      runningModels.delete(model);
    }
  })();

  return { pending: missing.length, running: true };
}

async function computeCell(model: string, p: BenchPrompt): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const out = await callClovaChat({
    model,
    messages: [
      ...(p.system ? [{ role: 'system' as const, content: p.system }] : []),
      { role: 'user' as const, content: p.user },
    ],
    temperature: 0.5,
    topP: 0.8,
    maxTokens: p.maxTokens ?? 1024,
    stream: false,
  });

  const completion = out.usage?.completionTokens ?? null;
  const tps =
    out.ok && completion && out.latencyMs > 0
      ? Math.round((completion / out.latencyMs) * 1000 * 10) / 10
      : null;

  let evaluation: string | null = null;
  let verdict: 'PASS' | 'FAIL' | null = null;
  if (out.ok) {
    evaluation = await judgeOutput({
      label: p.label,
      system: p.system,
      user: p.user,
      output: out.content,
      finishReason: out.finishReason,
    });
    verdict = parseVerdict(evaluation);
  }

  await pool.query<ResultSetHeader>(
    `INSERT INTO bench_cell
      (model, prompt_id, label, category, system_prompt, user_prompt, ok, latency_ms, prompt_tokens,
       completion_tokens, tokens_per_sec, finish_reason, truncated, verdict, judge, judge_model,
       evaluation, content, error, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())
     ON DUPLICATE KEY UPDATE
       label=VALUES(label), category=VALUES(category), system_prompt=VALUES(system_prompt),
       user_prompt=VALUES(user_prompt), ok=VALUES(ok), latency_ms=VALUES(latency_ms),
       prompt_tokens=VALUES(prompt_tokens), completion_tokens=VALUES(completion_tokens),
       tokens_per_sec=VALUES(tokens_per_sec), finish_reason=VALUES(finish_reason),
       truncated=VALUES(truncated), verdict=VALUES(verdict), judge=VALUES(judge),
       judge_model=VALUES(judge_model), evaluation=VALUES(evaluation), content=VALUES(content),
       error=VALUES(error), updated_at=NOW()`,
    [
      model,
      p.id,
      p.label,
      p.category,
      p.system ?? null,
      p.user,
      out.ok ? 1 : 0,
      out.latencyMs,
      out.usage?.promptTokens ?? null,
      completion,
      tps,
      out.finishReason ?? null,
      out.finishReason === 'length' ? 1 : 0,
      verdict,
      'claude-cli',
      process.env.CLAUDE_JUDGE_MODEL ?? '',
      evaluation,
      out.content ?? '',
      out.error ?? null,
    ],
  );
}
