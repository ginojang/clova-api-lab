import { Fragment, useCallback, useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { useClovaStore } from '../store/useClovaStore';
import { startBenchRun, getBenchCells, listBenchModels, getBenchSuite } from '../api/proxyClient';
import type { BenchCell, SuitePrompt, ModelStat } from '../types/bench';

const num = (x: string | number | null | undefined): number => (x == null ? 0 : Number(x));

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${tone ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

// 판정은 Claude 상세 평가의 PASS/FAIL을 따른다.
function VerdictBadge({ cell, pending }: { cell?: BenchCell; pending: boolean }) {
  if (!cell) return <span className="text-[10px] text-slate-500">{pending ? '평가중…' : '미평가'}</span>;
  if (!cell.ok) return <span className="text-[10px] text-red-400">{cell.error ?? 'ERROR'}</span>;
  if (cell.verdict === 'PASS')
    return <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">PASS</span>;
  if (cell.verdict === 'FAIL')
    return <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">FAIL</span>;
  return <span className="text-[10px] text-slate-500">—</span>;
}

const mdComponents: Components = {
  h1: ({ node: _n, ...p }) => <div className="mt-3 mb-1 text-xs font-bold text-slate-100" {...p} />,
  h2: ({ node: _n, ...p }) => <div className="mt-3 mb-1 text-xs font-bold text-slate-100" {...p} />,
  h3: ({ node: _n, ...p }) => <div className="mt-2 mb-1 text-xs font-semibold text-slate-200" {...p} />,
};

function spaceMarkdown(md: string): string {
  return md
    .replace(/^(#{1,6} .+)$/gm, '\n$1\n')
    .replace(/^(\*\*[^*\n]+\*\*:?)\s*$/gm, '\n$1\n')
    .replace(/^([ \t]*[-*] .+)$/gm, '$1\n');
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export default function BenchPanel() {
  const { model, set } = useClovaStore();
  const [suite, setSuite] = useState<SuitePrompt[]>([]);
  const [cells, setCells] = useState<BenchCell[]>([]);
  const [running, setRunning] = useState(false);
  const [models, setModels] = useState<ModelStat[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getBenchSuite().then(setSuite);
  }, []);

  useEffect(() => {
    void listBenchModels().then(setModels);
  }, [running]);

  const load = useCallback(async () => {
    const { cells, running } = await getBenchCells(model);
    setCells(cells);
    setRunning(running);
  }, [model]);

  // 모델 변경 시 셀 로드(재호출 아님 — DB 조회만).
  useEffect(() => {
    void load();
  }, [load]);

  // 진행 중이면 폴링.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [running, load]);

  const run = async () => {
    setError(null);
    const r = await startBenchRun(model);
    if (!r.ok) {
      setError(r.error ?? '실행 실패');
      return;
    }
    setRunning(true);
    void load();
  };

  const cellBy = new Map(cells.map((c) => [c.prompt_id, c]));
  const evaluated = cells.filter((c) => c.verdict === 'PASS' || c.verdict === 'FAIL');
  const passCount = cells.filter((c) => c.verdict === 'PASS').length;
  const lat = cells.filter((c) => c.ok).map((c) => num(c.latency_ms)).sort((a, b) => a - b);
  const tps = cells.filter((c) => c.ok && c.tokens_per_sec != null).map((c) => num(c.tokens_per_sec));
  const missingCount = suite.length - cells.filter((c) => c.verdict != null).length;

  const modelOptions = Array.from(new Set([model, ...models.map((m) => m.model)]));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {running ? '실행 중…' : `미평가 ${missingCount}개 실행`}
        </button>

        <label className="flex items-center gap-1 text-xs text-slate-400">
          모델
          <select
            value={model}
            onChange={(e) => set('model', e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-slate-200"
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-slate-500">
          (왼쪽 Model 입력칸에서 새 모델 추가 가능 — 미평가 항목만 채워진다)
        </span>
      </div>

      {error && <div className="text-sm text-red-400">에러: {error}</div>}
      {running && <div className="text-xs text-emerald-400">미평가 항목 평가 중 — 점진적으로 채워진다…</div>}

      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        <Stat label="평가됨" value={`${evaluated.length}/${suite.length}`} />
        <Stat
          label="통과율"
          value={evaluated.length ? `${Math.round((passCount / evaluated.length) * 100)}% (${passCount}/${evaluated.length})` : '—'}
          tone={evaluated.length && passCount === evaluated.length ? 'text-emerald-300' : 'text-amber-300'}
        />
        <Stat label="지연 p50" value={lat.length ? `${percentile(lat, 50)}ms` : '—'} />
        <Stat label="지연 p95" value={lat.length ? `${percentile(lat, 95)}ms` : '—'} />
        <Stat
          label="평균 tok/s"
          value={tps.length ? `${Math.round((tps.reduce((a, b) => a + b, 0) / tps.length) * 10) / 10}` : '—'}
        />
        <Stat label="미평가" value={`${missingCount}`} tone={missingCount ? 'text-amber-300' : 'text-slate-100'} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-900 text-slate-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">카테고리 / 프롬프트</th>
              <th className="px-2 py-1.5 font-medium">판정</th>
              <th className="px-2 py-1.5 text-right font-medium">지연</th>
              <th className="px-2 py-1.5 text-right font-medium">tok/s</th>
              <th className="px-2 py-1.5 text-right font-medium">토큰(p/c)</th>
              <th className="px-2 py-1.5 font-medium">finish</th>
            </tr>
          </thead>
          <tbody>
            {suite.map((p) => {
              const c = cellBy.get(p.id);
              const key = p.id;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => setExpanded(expanded === key ? null : key)}
                    className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-900/50"
                  >
                    <td className="px-2 py-1.5">
                      <span className="text-slate-500">{p.category}</span>{' '}
                      <span className="text-slate-200">{p.label}</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <VerdictBadge cell={c} pending={running} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{c?.latency_ms ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{c?.tokens_per_sec ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-400">
                      {c ? `${c.prompt_tokens ?? '—'}/${c.completion_tokens ?? '—'}` : '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={c?.finish_reason === 'length' ? 'text-amber-400' : 'text-slate-400'}>
                        {c?.finish_reason ?? '—'}
                      </span>
                    </td>
                  </tr>
                  {expanded === key && (
                    <tr className="bg-slate-900/80">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="mb-2">
                          <div className="mb-1 text-[10px] uppercase tracking-wide text-sky-500">질문</div>
                          {p.system && (
                            <div className="mb-1 whitespace-pre-wrap text-slate-400">
                              <span className="text-slate-600">[system] </span>
                              {p.system}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap text-slate-300">{p.user}</div>
                        </div>
                        {c ? (
                          <>
                            <div className="mb-2">
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">모델 출력</div>
                              <div className="whitespace-pre-wrap text-slate-300">{c.content || '(빈 응답)'}</div>
                            </div>
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-500">평가 상세</div>
                              <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                                {c.evaluation ? (
                                  <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-1">
                                    <ReactMarkdown components={mdComponents}>
                                      {spaceMarkdown(c.evaluation)}
                                    </ReactMarkdown>
                                  </div>
                                ) : (
                                  <span className="text-slate-500">{c.ok ? '(평가 없음)' : `에러: ${c.error}`}</span>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-500">아직 평가 안 됨 — "미평가 N개 실행"으로 채운다.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!suite.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                  로딩 중…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
