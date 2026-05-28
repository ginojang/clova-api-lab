import { Fragment, useMemo, useState } from 'react';
import { useClovaStore } from '../store/useClovaStore';
import { runBench, aggregate, type BenchRow } from '../bench/runner';
import { BENCH_SUITE } from '../bench/suite';

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${tone ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function CheckBadge({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="text-slate-600">—</span>;
  return pass ? (
    <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300">PASS</span>
  ) : (
    <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">FAIL</span>
  );
}

export default function BenchPanel() {
  const { model, temperature, topP } = useClovaStore();
  const [repeats, setRepeats] = useState(1);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rows, setRows] = useState<BenchRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const agg = useMemo(() => (rows.length ? aggregate(rows) : null), [rows]);

  const run = async () => {
    setRunning(true);
    setRows([]);
    setExpanded(null);
    const total = Math.max(1, repeats) * BENCH_SUITE.length;
    setProgress({ done: 0, total });
    const collected: BenchRow[] = [];
    try {
      await runBench({
        model,
        temperature,
        topP,
        repeats,
        onProgress: (done, total, row) => {
          collected.push(row);
          setRows([...collected]);
          setProgress({ done, total });
        },
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {running ? `실행 중… ${progress.done}/${progress.total}` : '벤치 실행'}
        </button>
        <label className="flex items-center gap-1 text-xs text-slate-400">
          반복
          <input
            type="number"
            min={1}
            max={20}
            value={repeats}
            onChange={(e) => setRepeats(Math.max(1, Number(e.target.value)))}
            className="w-14 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-100"
          />
        </label>
        <span className="text-xs text-slate-500">
          모델 <span className="font-mono text-slate-300">{model}</span> · {BENCH_SUITE.length}개 프롬프트
        </span>
      </div>

      {agg && (
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
          <Stat label="호출" value={`${agg.totalCalls}`} />
          <Stat
            label="통과율"
            value={`${Math.round(agg.passRate * 100)}% (${agg.passCount}/${agg.checkedCount})`}
            tone={agg.passRate === 1 ? 'text-emerald-300' : 'text-amber-300'}
          />
          <Stat label="지연 p50" value={`${agg.latencyP50}ms`} />
          <Stat label="지연 p95" value={`${agg.latencyP95}ms`} />
          <Stat label="평균 tok/s" value={`${agg.avgTokensPerSec}`} />
          <Stat
            label="에러/잘림"
            value={`${agg.errors}/${agg.truncatedCount}`}
            tone={agg.errors ? 'text-red-300' : 'text-slate-100'}
          />
        </div>
      )}

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
            {rows.map((r, i) => {
              const key = `${r.id}-${r.round}-${i}`;
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => setExpanded(expanded === key ? null : key)}
                    className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-900/50"
                  >
                    <td className="px-2 py-1.5">
                      <span className="text-slate-500">{r.category}</span>{' '}
                      <span className="text-slate-200">{r.label}</span>
                      {repeats > 1 && <span className="text-slate-600"> #{r.round}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.ok ? <CheckBadge pass={r.checkPass} /> : <span className="text-red-400">{r.error}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.latencyMs}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.tokensPerSec ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-400">
                      {r.promptTokens ?? '—'}/{r.completionTokens ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={r.truncated ? 'text-amber-400' : 'text-slate-400'}>
                        {r.finishReason ?? '—'}
                      </span>
                    </td>
                  </tr>
                  {expanded === key && (
                    <tr className="bg-slate-900/80">
                      <td colSpan={6} className="px-3 py-2 whitespace-pre-wrap text-slate-300">
                        {r.content || '(빈 응답)'}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                  "벤치 실행"을 누르면 프롬프트 세트를 돌려 지연·토큰·판정을 측정한다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
