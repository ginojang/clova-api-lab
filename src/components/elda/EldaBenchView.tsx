import { useState } from 'react';
import { Badge, Metric, NotWired, Section } from './ui';

type SweepRow = {
  op: 'embed' | 'rerank';
  batch: number;
  concurrency: number;
  total: number;
  p50?: number;
  p95?: number;
  p99?: number;
  throughput?: number;
  errors?: number;
  rate429?: number;
  status: 'pending' | 'running' | 'done' | 'error';
};

const BATCH_OPTS = [1, 4, 16, 64];
const CONC_OPTS = [1, 4, 16];

export default function EldaBenchView() {
  const [op, setOp] = useState<'embed' | 'rerank'>('embed');
  const [batches, setBatches] = useState<number[]>([1, 4, 16, 64]);
  const [concs, setConcs] = useState<number[]>([1, 4]);
  const [perCell, setPerCell] = useState(100);
  const [rows, setRows] = useState<SweepRow[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (arr: number[], v: number, set: (xs: number[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort((a, b) => a - b));

  const cells = batches.flatMap((b) => concs.map((c) => ({ batch: b, concurrency: c })));

  const run = async () => {
    setBusy(true);
    const initial: SweepRow[] = cells.map(({ batch, concurrency }) => ({
      op, batch, concurrency, total: perCell, status: 'pending',
    }));
    setRows(initial);
    // TODO: 백엔드 연결 시 각 셀 실행 → /api/tei/{embed|rerank} 부하 발생기
    // 우선 형태만: 모든 셀을 error(미연결)로 표시
    setTimeout(() => {
      setRows(initial.map((r) => ({ ...r, status: 'error' })));
      setBusy(false);
    }, 300);
  };

  // 최고 처리량 셀 식별(향후 데이터 있을 때)
  const best = rows.filter((r) => r.throughput).sort((a, b) => (b.throughput ?? 0) - (a.throughput ?? 0))[0];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-xl border border-violet-700/50 bg-gradient-to-br from-violet-950/60 to-slate-900/40 p-5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">ELDA · Bench</div>
          <h1 className="text-xl font-bold text-white">배치·동시성 스윕</h1>
          <p className="mt-1 text-sm text-violet-200/80">
            (배치 크기 × 동시성) 그리드로 부하를 줘서 p50/p95/p99·throughput·429율 측정 →
            <span className="text-violet-300"> 최적 (batch, concurrency) 셀 탐색</span>이 목표.
          </p>
        </div>

        <NotWired />

        <Section title="설정">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">대상 op</label>
              <div className="flex gap-2">
                {(['embed', 'rerank'] as const).map((x) => (
                  <button
                    key={x}
                    onClick={() => setOp(x)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      op === x
                        ? 'border-violet-400 bg-violet-600 text-white shadow shadow-violet-900/40'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">배치 크기 후보</label>
              <div className="flex flex-wrap gap-1.5">
                {BATCH_OPTS.map((b) => (
                  <button
                    key={b}
                    onClick={() => toggle(batches, b, setBatches)}
                    className={`rounded border px-2 py-0.5 text-xs font-mono ${
                      batches.includes(b)
                        ? 'border-violet-400 bg-violet-700/60 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">동시성 후보</label>
              <div className="flex flex-wrap gap-1.5">
                {CONC_OPTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggle(concs, c, setConcs)}
                    className={`rounded border px-2 py-0.5 text-xs font-mono ${
                      concs.includes(c)
                        ? 'border-violet-400 bg-violet-700/60 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-400">셀당 요청 수
              <input
                type="number" min={10} max={5000} value={perCell}
                onChange={(e) => setPerCell(Math.max(10, Number(e.target.value)))}
                className="ml-2 w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200"
              />
            </label>
            <span className="text-xs text-slate-500">총 셀 {cells.length} · 총 요청 ≈ {cells.length * perCell}</span>
            <button
              onClick={run}
              disabled={busy || !cells.length}
              className="ml-auto rounded-lg border border-violet-400 bg-gradient-to-br from-violet-500 to-fuchsia-700 px-4 py-2 text-sm font-semibold text-white shadow shadow-violet-900/40 hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? '스윕 실행 중…' : '스윕 실행'}
            </button>
          </div>
        </Section>

        {rows.length > 0 && (
          <Section
            title="결과 매트릭스"
            hint={best ? `최고 throughput = ${best.throughput?.toFixed(1)} t/s @ batch=${best.batch}/conc=${best.concurrency}` : undefined}
          >
            <div className="overflow-auto rounded border border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">batch</th>
                    <th className="px-2 py-1.5 font-medium">conc</th>
                    <th className="px-2 py-1.5 font-medium">status</th>
                    <th className="px-2 py-1.5 text-right font-medium">p50 (ms)</th>
                    <th className="px-2 py-1.5 text-right font-medium">p95 (ms)</th>
                    <th className="px-2 py-1.5 text-right font-medium">p99 (ms)</th>
                    <th className="px-2 py-1.5 text-right font-medium">throughput (t/s)</th>
                    <th className="px-2 py-1.5 text-right font-medium">429율</th>
                    <th className="px-2 py-1.5 text-right font-medium">errors</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-800/70">
                      <td className="px-2 py-1.5 font-mono text-slate-300">{r.batch}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-300">{r.concurrency}</td>
                      <td className="px-2 py-1.5">
                        {r.status === 'done' && <Badge tone="emerald">DONE</Badge>}
                        {r.status === 'running' && <Badge tone="violet">RUN</Badge>}
                        {r.status === 'pending' && <Badge tone="slate">PEND</Badge>}
                        {r.status === 'error' && <Badge tone="rose">백엔드 미연결</Badge>}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.p50 ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.p95 ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.p99 ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.throughput?.toFixed(1) ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.rate429 != null ? `${(r.rate429 * 100).toFixed(1)}%` : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.errors ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric label="총 셀" value={`${rows.length}`} />
              <Metric label="완료" value={`${rows.filter((r) => r.status === 'done').length}`} />
              <Metric label="429율 평균" value="—" />
              <Metric label="최적 (b,c)" value={best ? `${best.batch}/${best.concurrency}` : '—'} tone="text-emerald-300" />
            </div>
          </Section>
        )}

        <Section title="튜닝 가이드 (해석)" hint="결과 채워지면 채택">
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
            <li>같은 batch에서 conc 늘려도 p95가 흔들리지 않으면 → 게이트웨이 admission 여유.</li>
            <li>p99가 batch 증가 시 비례 이상으로 튄다 → coalescing 윈도가 커지며 큐잉 시간 누적.</li>
            <li>429율 0이고 throughput 평탄 → admission lane 한도(<span className="font-mono">limit</span>) 더 키울 여지.</li>
            <li>워커 1/2 헬시 = 한 GPU 다운 — failover 후 throughput 절반/지연 2배 패턴이어야 정상.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
