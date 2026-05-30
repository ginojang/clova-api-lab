import { Badge, Metric, NotWired, Section } from './ui';

// p38 게이트웨이 라이브 상태(연결 시 GET /api/tei/health · /stats · /models).
// 현재는 알려진 좌표·계약만 표시(랜딩 + sanity board).
export default function EldaStatusView() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="rounded-xl border border-violet-700/50 bg-gradient-to-br from-violet-950/60 to-slate-900/40 p-5 shadow-lg shadow-violet-900/30">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">
            ELDA · Status
          </div>
          <h1 className="text-xl font-bold text-white">TEI 게이트웨이 상태</h1>
          <p className="mt-1 text-sm text-violet-200/80">
            ELDA 추론 인프라(임베딩·리랭킹) — p38 가동, bf109 대기.
          </p>
        </div>

        <NotWired />

        <Section title="p38 (192.168.0.18:8000)" hint="embed + rerank — Infinity 2-GPU fan-out">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            <Metric label="status" value="—" tone="text-slate-500" />
            <Metric label="workers" value="—/—" />
            <Metric label="embed model" value="bge-m3" />
            <Metric label="rerank model" value="bge-rr-v2-m3" />
            <Metric label="embed dim" value="1024" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Metric label="embed admission" value="—" />
            <Metric label="rerank admission" value="—" />
            <Metric label="embed in-flight" value="—" />
            <Metric label="rerank in-flight" value="—" />
          </div>
        </Section>

        <Section title="라이브 데이터" hint="새로고침 시 GET /api/tei/{health,stats,models}">
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled
              className="rounded border border-violet-700/60 bg-violet-900/40 px-3 py-1.5 text-xs font-semibold text-violet-300 opacity-60"
            >
              새로고침 (프록시 대기)
            </button>
            <span className="text-xs text-slate-500">자동 폴링 5초(연결 시 활성화)</span>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto rounded border border-slate-800 bg-slate-950/80 p-3 text-[11px] text-slate-400">
{`{
  // GET /api/tei/health
  "status": "—",
  "workers_healthy": "—",
  "workers_total": "—"
}`}
          </pre>
        </Section>

        <Section title="다른 호스트">
          <ul className="space-y-1 text-sm text-slate-300">
            <li>
              <span className="text-amber-300">bf109</span>{' '}
              <span className="font-mono text-xs">192.168.0.10</span> — Intenter(Qwen2.5-0.5B FFT vLLM){' '}
              <Badge tone="amber">IDLE</Badge> · SFT 가중치 대기
            </li>
            <li>
              <span className="text-sky-300">spitfire</span>{' '}
              <span className="font-mono text-xs">192.168.0.2:5432</span> — memoryDB (pgvector 1024-dim){' '}
              <Badge tone="sky">PG</Badge>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
