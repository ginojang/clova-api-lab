import { useCallback, useEffect, useRef, useState } from 'react';

// 백엔드(hellcat) 부하 생성기 트리거 + 250ms 폴링.
// 실 측정은 LAN에서 p38 직타 — 브라우저 한계·EC2 경로 영향 없음.

type Op = 'embed' | 'rerank';
type Cfg = { op: Op; concurrency: number; batch: number; duration: number; corpusSize: number };

type Snap = {
  id: string;
  status: 'running' | 'done' | 'error';
  cfg: Cfg;
  target: string;
  elapsed: number;
  sent: number; done: number; inflight: number;
  ok: number; e429: number; eOther: number;
  p50: number; p95: number; p99: number;
  rpsAvg: number; rpsNow: number;
  hist: { rps: number[]; p50: number[]; p95: number[]; p99: number[] };
};

const API = '/giant/clova/api/tei-stress';

function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 220, h = 36;
  if (data.length < 2) {
    return (
      <svg width={w} height={h} className="text-slate-700">
        <line x1={0} y1={h - 1} x2={w} y2={h - 1} stroke="currentColor" />
      </svg>
    );
  }
  const m = Math.max(...data, 1);
  const step = w / Math.max(1, data.length - 1);
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / m) * (h - 2) - 1).toFixed(1)}`);
  return (
    <svg width={w} height={h}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function NumBig({ label, value, sub, tone = 'text-white' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950/70 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-mono text-3xl font-bold leading-tight ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function EldaStressView() {
  const [cfg, setCfg] = useState<Cfg>({ op: 'embed', concurrency: 64, batch: 8, duration: 30, corpusSize: 24 });
  const [snap, setSnap] = useState<Snap | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const r = await fetch(`${API}/state`);
      if (r.status === 404) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Snap;
      setSnap(j);
      if (j.status !== 'running') {
        setRunning(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 마운트 시 한 번 상태 확인(이미 돌고 있던 run에 연결)
  useEffect(() => {
    void (async () => {
      const r = await fetch(`${API}/state`);
      if (r.ok) {
        const j = (await r.json()) as Snap;
        setSnap(j);
        if (j.status === 'running') setRunning(true);
      }
    })();
  }, []);

  // running 중에는 250ms 폴링
  useEffect(() => {
    if (!running) return;
    pollRef.current = setInterval(fetchState, 250);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [running, fetchState]);

  async function start() {
    setError(null);
    try {
      const r = await fetch(`${API}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error === 'busy' ? `이미 실행 중(runId=${j.runningId}) — STOP 후 재시도` : (j.error ?? 'start failed'));
        return;
      }
      setRunning(true);
      void fetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function stop() {
    await fetch(`${API}/stop`, { method: 'POST' });
    void fetchState();
  }

  // 표시값
  const elapsed = snap?.elapsed ?? 0;
  const done = snap?.done ?? 0;
  const sent = snap?.sent ?? 0;
  const inflight = snap?.inflight ?? 0;
  const errs = (snap?.e429 ?? 0) + (snap?.eOther ?? 0);
  const errRate = done ? errs / done : 0;
  const hist = snap?.hist ?? { rps: [], p50: [], p95: [], p99: [] };
  const target = snap?.target ?? '—';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
        <div className="flex items-center gap-1">
          {(['embed', 'rerank'] as const).map((x) => (
            <button
              key={x}
              disabled={running}
              onClick={() => setCfg((c) => ({ ...c, op: x }))}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                cfg.op === x
                  ? 'border-violet-400 bg-violet-600 text-white'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
              } disabled:opacity-50`}
            >
              {x}
            </button>
          ))}
        </div>

        {([
          { k: 'concurrency', label: 'CONC', min: 1, max: 4096 },
          { k: 'batch', label: 'BATCH', min: 1, max: 512 },
          { k: 'duration', label: 'SEC', min: 0, max: 3600 },
          { k: 'corpusSize', label: 'CORPUS', min: 1, max: 24 },
        ] as const).map(({ k, label, min, max }) => (
          <label key={k} className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
            <input
              type="number" min={min} max={max} disabled={running}
              value={cfg[k]}
              onChange={(e) => setCfg((c) => ({ ...c, [k]: Math.max(min, Math.min(max, Number(e.target.value))) }))}
              className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-100 disabled:opacity-50"
            />
          </label>
        ))}

        <div className="ml-auto">
          {!running ? (
            <button
              onClick={start}
              className="rounded-lg border-2 border-violet-400 bg-gradient-to-br from-violet-500 to-fuchsia-700 px-6 py-2 text-base font-bold uppercase tracking-wider text-white shadow-lg shadow-violet-900/50 transition hover:-translate-y-0.5 hover:shadow-violet-900/70"
            >
              ▶ START
            </button>
          ) : (
            <button
              onClick={stop}
              className="rounded-lg border-2 border-rose-400 bg-gradient-to-br from-rose-500 to-red-700 px-6 py-2 text-base font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-900/50 animate-pulse"
            >
              ■ STOP
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-700/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <NumBig
          label="elapsed"
          value={`${elapsed.toFixed(1)}s`}
          sub={snap ? (snap.status === 'running' ? '진행 중' : snap.status === 'done' ? '완료' : '에러') : '대기'}
        />
        <NumBig label="done" value={done.toLocaleString()} sub={`sent ${sent.toLocaleString()}`} />
        <NumBig label="rps (avg)" value={(snap?.rpsAvg ?? 0).toFixed(1)} sub={`now ${(snap?.rpsNow ?? 0).toFixed(1)}`} tone="text-emerald-300" />
        <NumBig label="in-flight" value={`${inflight}`} sub={`of ${cfg.concurrency}`} tone={inflight === cfg.concurrency && running ? 'text-amber-300' : 'text-white'} />
        <NumBig label="errors" value={`${errs}`} sub={`429: ${snap?.e429 ?? 0} · other: ${snap?.eOther ?? 0}`} tone={errs ? 'text-rose-300' : 'text-white'} />
        <NumBig label="err rate" value={`${(errRate * 100).toFixed(2)}%`} tone={errRate > 0.01 ? 'text-rose-300' : 'text-emerald-300'} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">RPS (1s 샘플)</span>
            <span className="font-mono text-sm text-emerald-300">{(hist.rps.at(-1) ?? 0).toFixed(1)}</span>
          </div>
          <Spark data={hist.rps} color="#34d399" />
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">p50</span>
            <span className="font-mono text-sm text-violet-300">{snap?.p50 ?? 0}ms</span>
          </div>
          <Spark data={hist.p50} color="#a78bfa" />
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">p95</span>
            <span className="font-mono text-sm text-amber-300">{snap?.p95 ?? 0}ms</span>
          </div>
          <Spark data={hist.p95} color="#fbbf24" />
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">p99</span>
            <span className="font-mono text-sm text-rose-300">{snap?.p99 ?? 0}ms</span>
          </div>
          <Spark data={hist.p99} color="#fb7185" />
        </div>
      </div>

      <div className="text-[11px] text-slate-500">
        타깃 <span className="font-mono text-slate-400">{target}</span> · 발생기는{' '}
        <span className="text-slate-400">hellcat → LAN 직타</span> (undici Agent, conn 4096).
        브라우저는 트리거+250ms 폴링만 — 측정 오염 없음.
      </div>
    </div>
  );
}
