import type { ChatRequest } from '../types/clova';
import { postChat } from '../api/proxyClient';
import { BENCH_SUITE, type BenchPrompt, type CheckSpec } from './suite';

export type BenchRow = {
  id: string;
  label: string;
  category: string;
  round: number;
  ok: boolean;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  tokensPerSec?: number;
  finishReason?: string;
  truncated: boolean;
  checkPass: boolean | null; // null = 호출 실패로 판정 불가
  content: string;
  error?: string;
};

export type BenchAggregate = {
  totalCalls: number;
  errors: number;
  errorRate: number;
  latencyP50: number;
  latencyP95: number;
  avgTokensPerSec: number;
  totalCompletionTokens: number;
  passCount: number;
  checkedCount: number;
  passRate: number;
  truncatedCount: number;
};

export type BenchRunOptions = {
  model: string;
  temperature: number;
  topP: number;
  repeats: number;
  onProgress?: (done: number, total: number, row: BenchRow) => void;
};

function stripCodeFence(s: string): string {
  return s.replace(/```(?:json)?/gi, '').trim();
}

// 강제 단일 라벨 비교용 정규화: 따옴표/공백/마침표 제거.
function normalizeLabel(s: string): string {
  return s
    .trim()
    .replace(/^["'`]+|["'`.\s]+$/g, '')
    .replace(/\s+/g, '');
}

function evaluateCheck(content: string, finishReason: string | undefined, check: CheckSpec): boolean {
  switch (check.kind) {
    case 'nonempty':
      return content.trim().length > 0;
    case 'notTruncated':
      return finishReason !== 'length' && content.trim().length > 0;
    case 'includesAny':
      return check.values.some((v) => content.includes(v));
    case 'equalsOneOf': {
      const norm = normalizeLabel(content);
      return check.values.some((v) => normalizeLabel(v) === norm);
    }
    case 'json':
      try {
        JSON.parse(stripCodeFence(content));
        return true;
      } catch {
        return false;
      }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function runOne(p: BenchPrompt, round: number, opts: BenchRunOptions): Promise<BenchRow> {
  const req: ChatRequest = {
    model: opts.model,
    messages: [
      ...(p.system ? [{ role: 'system' as const, content: p.system }] : []),
      { role: 'user' as const, content: p.user },
    ],
    temperature: opts.temperature,
    topP: opts.topP,
    maxTokens: p.maxTokens ?? 256,
    stream: false,
  };

  const res = await postChat(req);
  const completionTokens = res.usage?.completionTokens;
  const tokensPerSec =
    res.ok && completionTokens && res.latencyMs > 0
      ? Math.round((completionTokens / res.latencyMs) * 1000 * 10) / 10
      : undefined;

  return {
    id: p.id,
    label: p.label,
    category: p.category,
    round,
    ok: res.ok,
    latencyMs: res.latencyMs,
    promptTokens: res.usage?.promptTokens,
    completionTokens,
    tokensPerSec,
    finishReason: res.finishReason,
    truncated: res.finishReason === 'length',
    checkPass: res.ok ? evaluateCheck(res.content, res.finishReason, p.check) : null,
    content: res.content,
    error: res.error,
  };
}

export function aggregate(rows: BenchRow[]): BenchAggregate {
  const okRows = rows.filter((r) => r.ok);
  const latencies = okRows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const tps = okRows.map((r) => r.tokensPerSec).filter((x): x is number => x != null);
  const checked = rows.filter((r) => r.checkPass !== null);
  const passCount = checked.filter((r) => r.checkPass).length;

  return {
    totalCalls: rows.length,
    errors: rows.length - okRows.length,
    errorRate: rows.length ? (rows.length - okRows.length) / rows.length : 0,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    avgTokensPerSec: tps.length ? Math.round((tps.reduce((a, b) => a + b, 0) / tps.length) * 10) / 10 : 0,
    totalCompletionTokens: okRows.reduce((a, r) => a + (r.completionTokens ?? 0), 0),
    passCount,
    checkedCount: checked.length,
    passRate: checked.length ? passCount / checked.length : 0,
    truncatedCount: rows.filter((r) => r.truncated).length,
  };
}

// 순차 실행(레이트리밋 회피). round 마다 전체 스위트를 1회 돈다.
export async function runBench(opts: BenchRunOptions): Promise<BenchRow[]> {
  const rounds = Math.max(1, opts.repeats);
  const total = rounds * BENCH_SUITE.length;
  const rows: BenchRow[] = [];
  let done = 0;

  for (let r = 1; r <= rounds; r++) {
    for (const p of BENCH_SUITE) {
      const row = await runOne(p, r, opts);
      rows.push(row);
      done += 1;
      opts.onProgress?.(done, total, row);
    }
  }
  return rows;
}
