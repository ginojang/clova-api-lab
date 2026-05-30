import { useState } from 'react';
import { Badge, NotWired, Section } from './ui';

type EmbedRow = { input: string; latencyMs?: number; dim?: number; norm?: number; preview?: number[] };

const SAMPLE = ['전면간판 LED 재질', '채널간판 조립', '고려청자 색감'].join('\n');

export default function EldaEmbedView() {
  const [text, setText] = useState(SAMPLE);
  const [model, setModel] = useState('BAAI/bge-m3');
  const [rows, setRows] = useState<EmbedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inputs = text.split('\n').map((s) => s.trim()).filter(Boolean);

  const run = async () => {
    setError(null); setBusy(true); setRows(inputs.map((s) => ({ input: s })));
    try {
      const t0 = performance.now();
      const res = await fetch('/giant/clova/api/tei/embed', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: inputs }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const dt = performance.now() - t0;
      const embs: number[][] = data.embeddings ?? [];
      setRows(inputs.map((s, i) => ({
        input: s, latencyMs: Math.round(dt / inputs.length),
        dim: embs[i]?.length, preview: embs[i]?.slice(0, 8),
        norm: embs[i] ? Math.sqrt(embs[i].reduce((a, b) => a + b * b, 0)) : undefined,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  // 코사인 행렬(결과 있을 때만)
  const matrix = (() => {
    const E = rows.map((r) => r.preview).filter(Boolean) as number[][];
    if (E.length < 2 || !E[0]) return null;
    const cos = (a: number[], b: number[]) => {
      const d = a.reduce((s, v, i) => s + v * b[i], 0);
      const n = Math.sqrt(a.reduce((s, v) => s + v * v, 0)) * Math.sqrt(b.reduce((s, v) => s + v * v, 0));
      return d / (n + 1e-12);
    };
    return E.map((a) => E.map((b) => cos(a, b)));
  })();

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-xl border border-violet-700/50 bg-gradient-to-br from-violet-950/60 to-slate-900/40 p-5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">ELDA · Embed</div>
          <h1 className="text-xl font-bold text-white">임베딩 테스터</h1>
          <p className="mt-1 text-sm text-violet-200/80">한 줄당 하나의 입력. 결과로 지연·dim·벡터 프리뷰·쌍별 코사인.</p>
        </div>

        <NotWired />

        <Section title="입력" hint="한 줄 = 하나의 input">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="h-40 w-full resize-none rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
              placeholder="전면간판 LED 재질&#10;채널간판 조립"
            />
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-400">모델</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-sm text-slate-200"
              >
                <option>BAAI/bge-m3</option>
              </select>
              <button
                onClick={run}
                disabled={busy || !inputs.length}
                className="mt-auto rounded-lg border border-violet-400 bg-gradient-to-br from-violet-500 to-fuchsia-700 px-4 py-2 text-sm font-semibold text-white shadow shadow-violet-900/40 hover:-translate-y-0.5 disabled:opacity-50"
              >
                {busy ? '요청 중…' : `임베딩 요청 (${inputs.length}개)`}
              </button>
            </div>
          </div>
        </Section>

        {error && (
          <div className="rounded border border-rose-700/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
            에러: {error}
          </div>
        )}

        {rows.length > 0 && (
          <Section title="결과 — 행별">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 font-medium">입력</th>
                  <th className="px-2 py-1.5 text-right font-medium">지연</th>
                  <th className="px-2 py-1.5 text-right font-medium">dim</th>
                  <th className="px-2 py-1.5 text-right font-medium">‖v‖</th>
                  <th className="px-2 py-1.5 font-medium">vector preview (앞 8)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-800/70">
                    <td className="px-2 py-1.5 text-slate-200">{r.input}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.latencyMs ?? '—'}{r.latencyMs ? 'ms' : ''}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.dim ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{r.norm ? r.norm.toFixed(3) : '—'}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-400">
                      {r.preview ? `[${r.preview.map((v) => v.toFixed(3)).join(', ')}, …]` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {matrix && (
          <Section title="쌍별 코사인 (vector preview 기반)" hint="대각=1.0">
            <table className="text-left text-xs">
              <tbody>
                {matrix.map((row, i) => (
                  <tr key={i}>
                    <td className="pr-2 font-mono text-slate-500">{i}</td>
                    {row.map((v, j) => {
                      const tone = v > 0.85 ? 'bg-emerald-900/50 text-emerald-200' : v > 0.5 ? 'bg-violet-900/40 text-violet-200' : 'bg-slate-900 text-slate-400';
                      return (
                        <td key={j} className={`px-2 py-1 font-mono ${tone}`}>{v.toFixed(3)}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500"><Badge tone="slate">참고</Badge> 코사인은 8차원 프리뷰만 사용. 진짜 1024-dim은 백엔드 연결 후 정확해진다.</p>
          </Section>
        )}
      </div>
    </div>
  );
}
