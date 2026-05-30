import { useEffect, useRef, useState } from 'react';

// 극한 스트레스 — 한 페이지. 클라이언트가 concurrency만큼 워커를 띄워 fetch loop.
// 백엔드 프록시 /api/tei/{embed|rerank} 가 p38 게이트웨이로 포워드한다고 가정.

const CORPUS = [
  '전면간판 LED 모듈 재질', '채널간판 조립 방법', '돌출간판 이격 규정',
  '간판 글자 폰트와 색상', '간판 설치 안전 가이드', '아크릴 마감재 처리',
  '알루미늄 복합판 가공', '간판 야간 조명 효율', '간판 도면 표준 양식',
  '간판 허가 신청 절차', '전기 공사 안전 점검', '간판 청소 유지보수',
  '도시 경관 가이드라인', '간판 디자인 트렌드', '한국 전통 간판 양식',
  '카페 간판 사례 분석', '편의점 간판 표준', '음식점 간판 폰트',
  '바닥 표지판 설치', '벽면 간판 부착 방법', '간판 부식 방지 처리',
  '전광판 픽셀 피치', '비전기 간판 시인성', '간판 도장 작업 절차',
];

type Cfg = { op: 'embed' | 'rerank'; concurrency: number; batch: number; duration: number; corpusSize: number };

type Live = {
  startTs: number;
  sent: number; done: number; inflight: number;
  ok: number; e429: number; eOther: number;
  latencies: number[]; rolling: number[];
  lastSampleTs: number; lastSampleDone: number;
  histRps: number[]; histP50: number[]; histP95: number[]; histP99: number[];
};

const blank = (): Live => ({
  startTs: 0, sent: 0, done: 0, inflight: 0, ok: 0, e429: 0, eOther: 0,
  latencies: [], rolling: [], lastSampleTs: 0, lastSampleDone: 0,
  histRps: [], histP50: [], histP95: [], histP99: [],
});

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function Spark({ data, color, max }: { data: number[]; color: string; max?: number }) {
  const w = 220, h = 36;
  if (data.length < 2) return <svg width={w} height={h} className="text-slate-700"><line x1={0} y1={h} x2={w} y2={h} stroke="currentColor" /></svg>;
  const m = max ?? Math.max(...data, 1);
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
  const [cfg, setCfg] = useState<Cfg>({ op: 'embed', concurrency: 32, batch: 8, duration: 30, corpusSize: CORPUS.length });
  const [running, setRunning] = useState(false);
  const [, force] = useState(0);
  const liveRef = useRef<Live>(blank());
  const stopRef = useRef(false);

  // 초당 샘플링 + 강제 리렌더(refs 변동 반영)
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      const L = liveRef.current;
      const now = performance.now();
      const dt = (now - (L.lastSampleTs || L.startTs)) / 1000;
      const dDone = L.done - L.lastSampleDone;
      const rps = dt > 0 ? dDone / dt : 0;
      L.lastSampleTs = now; L.lastSampleDone = L.done;
      // rolling latency: 최근 3000개만 유지
      if (L.rolling.length > 3000) L.rolling = L.rolling.slice(-3000);
      const sorted = [...L.rolling].sort((a, b) => a - b);
      L.histRps.push(rps);
      L.histP50.push(pct(sorted, 50));
      L.histP95.push(pct(sorted, 95));
      L.histP99.push(pct(sorted, 99));
      for (const k of ['histRps', 'histP50', 'histP95', 'histP99'] as const) {
        if (L[k].length > 120) L[k].shift();
      }
      force((t) => t + 1);
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  async function start() {
    stopRef.current = false;
    liveRef.current = { ...blank(), startTs: performance.now(), lastSampleTs: performance.now() };
    setRunning(true);

    const inputs = CORPUS.slice(0, Math.max(1, cfg.corpusSize));
    const pick = (n: number) => Array.from({ length: n }, () => inputs[Math.floor(Math.random() * inputs.length)]);

    const fire = async () => {
      const L = liveRef.current;
      const bodyTexts = pick(cfg.batch);
      const body = cfg.op === 'embed'
        ? { model: 'BAAI/bge-m3', input: bodyTexts }
        : { model: 'BAAI/bge-reranker-v2-m3', query: bodyTexts[0], texts: bodyTexts.slice(1).length ? bodyTexts.slice(1) : [bodyTexts[0]] };
      L.sent++; L.inflight++;
      const t0 = performance.now();
      try {
        const res = await fetch(`/giant/clova/api/tei/${cfg.op}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const lat = performance.now() - t0;
        L.latencies.push(lat); L.rolling.push(lat);
        if (res.status === 429) L.e429++;
        else if (!res.ok) L.eOther++;
        else L.ok++;
      } catch {
        L.eOther++;
      } finally {
        L.inflight--; L.done++;
      }
    };

    async function worker() {
      while (!stopRef.current) {
        const elapsed = (performance.now() - liveRef.current.startTs) / 1000;
        if (cfg.duration > 0 && elapsed >= cfg.duration) break;
        await fire();
      }
    }

    const workers = Array.from({ length: cfg.concurrency }, () => worker());
    await Promise.all(workers);
    setRunning(false);
  }

  function stop() { stopRef.current = true; }

  const L = liveRef.current;
  const elapsed = L.startTs ? (performance.now() - L.startTs) / 1000 : 0;
  const sorted = [...L.rolling].sort((a, b) => a - b);
  const p50 = pct(sorted, 50), p95 = pct(sorted, 95), p99 = pct(sorted, 99);
  const avgRps = elapsed > 0 ? L.done / elapsed : 0;
  const errRate = L.done ? (L.e429 + L.eOther) / L.done : 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      {/* 컨트롤 — 한 줄 */}
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

        {[
          { k: 'concurrency', label: 'CONC', min: 1, max: 1000, step: 1 },
          { k: 'batch', label: 'BATCH', min: 1, max: 256, step: 1 },
          { k: 'duration', label: 'SEC', min: 0, max: 600, step: 1 },
          { k: 'corpusSize', label: 'CORPUS', min: 1, max: CORPUS.length, step: 1 },
        ].map(({ k, label, min, max }) => (
          <label key={k} className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
            <input
              type="number" min={min} max={max} disabled={running}
              value={cfg[k as keyof Cfg] as number}
              onChange={(e) => setCfg((c) => ({ ...c, [k]: Math.max(min, Math.min(max, Number(e.target.value))) }))}
              className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-100 disabled:opacity-50"
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

      {/* 대형 메트릭 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <NumBig label="elapsed" value={`${elapsed.toFixed(1)}s`} sub={running ? '… 진행' : L.startTs ? '정지' : '대기'} />
        <NumBig label="done" value={L.done.toLocaleString()} sub={`sent ${L.sent.toLocaleString()}`} />
        <NumBig label="rps (avg)" value={avgRps.toFixed(1)} sub={`now ${(L.histRps.at(-1) ?? 0).toFixed(1)}`} tone="text-emerald-300" />
        <NumBig label="in-flight" value={`${L.inflight}`} sub={`of ${cfg.concurrency}`} tone={L.inflight === cfg.concurrency && running ? 'text-amber-300' : 'text-white'} />
        <NumBig label="errors" value={`${L.e429 + L.eOther}`} sub={`429: ${L.e429} · other: ${L.eOther}`} tone={L.e429 + L.eOther ? 'text-rose-300' : 'text-white'} />
        <NumBig label="err rate" value={`${(errRate * 100).toFixed(2)}%`} tone={errRate > 0.01 ? 'text-rose-300' : 'text-emerald-300'} />
      </div>

      {/* 지연·RPS 시계열 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">RPS</span>
            <span className="font-mono text-sm text-emerald-300">{(L.histRps.at(-1) ?? 0).toFixed(1)}</span>
          </div>
          <Spark data={L.histRps} color="#34d399" />
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">p50</span>
            <span className="font-mono text-sm text-violet-300">{p50.toFixed(0)}ms</span>
          </div>
          <Spark data={L.histP50} color="#a78bfa" />
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">p95</span>
            <span className="font-mono text-sm text-amber-300">{p95.toFixed(0)}ms</span>
          </div>
          <Spark data={L.histP95} color="#fbbf24" />
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/70 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">p99</span>
            <span className="font-mono text-sm text-rose-300">{p99.toFixed(0)}ms</span>
          </div>
          <Spark data={L.histP99} color="#fb7185" />
        </div>
      </div>

      <div className="text-[11px] text-slate-500">
        클라이언트(브라우저)에서 발생기 동작. 정확한 극한치는 hellcat·LAN의 백엔드 부하 생성기 연결 후 측정. 백엔드 프록시 <span className="font-mono">/api/tei/*</span> 미연결이면 모든 요청이 errors로 잡힌다.
      </div>
    </div>
  );
}
