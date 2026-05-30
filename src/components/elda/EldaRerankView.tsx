import { useState } from 'react';
import { Badge, NotWired, Section } from './ui';

type Ranked = { idx: number; orig: number; score: number; text: string };

const SAMPLE_QUERY = '전면간판 재질';
const SAMPLE_DOCS = [
  '전면간판은 LED 모듈 + 아크릴 마감재가 표준이다.',
  '채널간판은 글자를 입체로 조립한다.',
  '고려청자는 비취색이 특징이다.',
  '돌출간판은 도로 폭 이격 규정이 있다.',
  '전면간판 표면은 알루미늄 복합판을 자주 쓴다.',
].join('\n');

export default function EldaRerankView() {
  const [query, setQuery] = useState(SAMPLE_QUERY);
  const [text, setText] = useState(SAMPLE_DOCS);
  const [model, setModel] = useState('BAAI/bge-reranker-v2-m3');
  const [topN, setTopN] = useState(5);
  const [results, setResults] = useState<Ranked[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const docs = text.split('\n').map((s) => s.trim()).filter(Boolean);

  const run = async () => {
    setError(null); setBusy(true); setResults([]); setLatency(null);
    try {
      const t0 = performance.now();
      const res = await fetch('/giant/clova/api/tei/rerank', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, query, texts: docs, top_n: topN }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { index: number; score: number }[];
      setLatency(Math.round(performance.now() - t0));
      setResults(data.map((r, k) => ({ idx: k, orig: r.index, score: r.score, text: docs[r.index] })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const maxScore = results.length ? Math.max(...results.map((r) => r.score), 1) : 1;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-xl border border-violet-700/50 bg-gradient-to-br from-violet-950/60 to-slate-900/40 p-5">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">ELDA · Rerank</div>
          <h1 className="text-xl font-bold text-white">리랭커 테스터</h1>
          <p className="mt-1 text-sm text-violet-200/80">cross-encoder가 질의-문서 쌍을 점수화. 결과는 score 내림차순.</p>
        </div>

        <NotWired />

        <Section title="입력">
          <label className="mb-1 block text-xs text-slate-400">질의 (query)</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
          />
          <label className="mb-1 block text-xs text-slate-400">문서 — 한 줄 = 하나</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-36 w-full resize-none rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-slate-400">모델
              <select value={model} onChange={(e) => setModel(e.target.value)} className="ml-2 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200">
                <option>BAAI/bge-reranker-v2-m3</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">top_n
              <input type="number" min={1} max={50} value={topN} onChange={(e) => setTopN(Math.max(1, Number(e.target.value)))} className="ml-2 w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200" />
            </label>
            <button
              onClick={run}
              disabled={busy || !docs.length || !query.trim()}
              className="ml-auto rounded-lg border border-violet-400 bg-gradient-to-br from-violet-500 to-fuchsia-700 px-4 py-2 text-sm font-semibold text-white shadow shadow-violet-900/40 hover:-translate-y-0.5 disabled:opacity-50"
            >
              {busy ? '요청 중…' : `리랭크 요청 (${docs.length}개)`}
            </button>
          </div>
        </Section>

        {error && (
          <div className="rounded border border-rose-700/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">에러: {error}</div>
        )}

        {results.length > 0 && (
          <Section title="결과 — 재배치 + 점수" hint={latency != null ? `latency ${latency}ms` : undefined}>
            <ol className="space-y-2">
              {results.map((r) => (
                <li key={r.idx} className="rounded border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span className="font-mono text-violet-300">#{r.idx + 1}</span>
                    <Badge tone="slate">원위치 {r.orig + 1}</Badge>
                    <span className="font-mono text-slate-300">score {r.score.toFixed(4)}</span>
                    <div className="ml-2 h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
                      <div className="h-full rounded bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${Math.max(2, (r.score / maxScore) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-sm text-slate-200">{r.text}</div>
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </div>
  );
}
