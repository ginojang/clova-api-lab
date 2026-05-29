import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useClovaStore } from '../store/useClovaStore';
import {
  startBenchRun,
  listBenchRuns,
  getBenchRun,
  type BenchRunConfig,
} from '../api/proxyClient';
import type { BenchRunRow, BenchRunDetail } from '../types/bench';

const num = (x: string | number | null | undefined): number => (x == null ? 0 : Number(x));

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${tone ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function CheckBadge({ pass }: { pass: number | null }) {
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
  const [runs, setRuns] = useState<BenchRunRow[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [detail, setDetail] = useState<BenchRunDetail | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshRuns = useCallback(async () => setRuns(await listBenchRuns()), []);

  // 최초 진입: 목록을 불러오고 가장 최근 배치를 자동 선택(실행 안 눌러도 보이게).
  useEffect(() => {
    void (async () => {
      const rs = await listBenchRuns();
      setRuns(rs);
      setRunId((prev) => prev ?? rs[0]?.id ?? null);
    })();
  }, []);

  // runId 가 정해지면 detail 폴링(완료되면 정지)
  useEffect(() => {
    if (runId == null) return;
    let stop = false;
    const tick = async () => {
      const d = await getBenchRun(runId);
      if (stop) return;
      setDetail(d);
      if (d && (d.run.status === 'done' || d.run.status === 'error')) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        void refreshRuns();
      }
    };
    void tick();
    pollRef.current = setInterval(tick, 2000);
    return () => {
      stop = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [runId, refreshRuns]);

  const running = detail?.run.status === 'running' || (runId != null && !detail);

  const run = async () => {
    setError(null);
    setExpanded(null);
    const cfg: BenchRunConfig = { model, temperature, topP, repeats };
    const res = await startBenchRun(cfg);
    if (!res.ok || !res.runId) {
      setError(res.error ?? '실행 실패');
      return;
    }
    setDetail(null);
    setRunId(res.runId);
  };

  const r = detail?.run;
  const evalByPrompt = new Map((detail?.evaluations ?? []).map((e) => [e.prompt_id, e]));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {running ? '실행 중…' : '벤치 실행'}
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
          모델 <span className="font-mono text-slate-300">{model}</span>
        </span>

        <select
          value={runId ?? ''}
          onChange={(e) => setRunId(e.target.value ? Number(e.target.value) : null)}
          className="ml-auto max-w-[280px] rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
        >
          <option value="">과거 배치 불러오기…</option>
          {runs.map((x) => (
            <option key={x.id} value={x.id}>
              #{x.id} {x.model} · {Math.round(num(x.pass_rate) * 100)}% · {x.status} ·{' '}
              {String(x.created_at).replace('T', ' ').slice(5, 16)}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="text-sm text-red-400">에러: {error}</div>}
      {running && <div className="text-xs text-emerald-400">배치 실행 중 — 결과/Claude 평가가 점진적으로 채워진다…</div>}

      {r && (
        <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
          <Stat label="상태" value={r.status} tone={r.status === 'done' ? 'text-emerald-300' : r.status === 'error' ? 'text-red-300' : 'text-amber-300'} />
          <Stat
            label="통과율"
            value={`${Math.round(num(r.pass_rate) * 100)}% (${num(r.pass_count)}/${num(r.checked_count)})`}
            tone={num(r.pass_rate) === 1 ? 'text-emerald-300' : 'text-amber-300'}
          />
          <Stat label="지연 p50" value={`${num(r.latency_p50)}ms`} />
          <Stat label="지연 p95" value={`${num(r.latency_p95)}ms`} />
          <Stat label="평균 tok/s" value={`${num(r.avg_tok_s)}`} />
          <Stat label="에러/잘림" value={`${num(r.errors)}/${num(r.truncated)}`} tone={num(r.errors) ? 'text-red-300' : 'text-slate-100'} />
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
            {(detail?.results ?? []).map((row) => {
              const key = `${row.id}`;
              const ev = evalByPrompt.get(row.prompt_id);
              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => setExpanded(expanded === key ? null : key)}
                    className="cursor-pointer border-t border-slate-800/70 hover:bg-slate-900/50"
                  >
                    <td className="px-2 py-1.5">
                      <span className="text-slate-500">{row.category}</span>{' '}
                      <span className="text-slate-200">{row.label}</span>
                      {num(r?.repeats) > 1 && <span className="text-slate-600"> #{row.round}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {row.ok ? <CheckBadge pass={row.check_pass} /> : <span className="text-red-400">{row.error}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{row.latency_ms}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-300">{row.tokens_per_sec ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-slate-400">
                      {row.prompt_tokens ?? '—'}/{row.completion_tokens ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={row.truncated ? 'text-amber-400' : 'text-slate-400'}>
                        {row.finish_reason ?? '—'}
                      </span>
                    </td>
                  </tr>
                  {expanded === key && (
                    <tr className="bg-slate-900/80">
                      <td colSpan={6} className="px-3 py-2">
                        <div className="mb-2">
                          <div className="mb-1 text-[10px] uppercase tracking-wide text-sky-500">질문</div>
                          {row.system_prompt && (
                            <div className="mb-1 whitespace-pre-wrap text-slate-400">
                              <span className="text-slate-600">[system] </span>
                              {row.system_prompt}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap text-slate-300">{row.user_prompt ?? '(이전 배치 — 질문 미저장)'}</div>
                        </div>
                        <div className="mb-2">
                          <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">모델 출력</div>
                          <div className="whitespace-pre-wrap text-slate-300">{row.content || '(빈 응답)'}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-500">Claude 평가</div>
                          <div className="rounded border border-slate-800 bg-slate-950/60 p-3">
                            {ev ? (
                              <div className="prose prose-invert prose-sm max-w-none prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5">
                                <ReactMarkdown>{ev.evaluation}</ReactMarkdown>
                              </div>
                            ) : (
                              <span className="text-slate-500">
                                {row.round === 1 ? '(평가 생성 중…)' : '(평가는 라운드1만)'}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!detail?.results?.length && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-600">
                  "벤치 실행"으로 서버측 배치를 돌리면 결과·Claude 평가가 DB에 저장되고 여기에 표시된다. 과거 배치도 위 드롭다운에서 불러온다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
