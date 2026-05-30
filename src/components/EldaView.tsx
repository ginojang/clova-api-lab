// ELDA 워크스페이스 — eldaAdapter 미구현. 인프라 좌표·아키텍처 요약 랜딩.

export default function EldaView() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="rounded-xl border border-violet-700/50 bg-gradient-to-br from-violet-950/60 to-slate-900/40 p-6 shadow-xl shadow-violet-900/30">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-violet-400">
            workspace
          </div>
          <h1 className="text-2xl font-bold text-white">ELDA — 자체 추론 파이프라인</h1>
          <p className="mt-2 text-sm text-violet-200/80">
            GanpanAI <span className="font-mono">MY-LLM Architecture v2.3</span>{' '}
            (Intenter → Reasoner → Decoder) 헤드리스 추론 서비스.
          </p>
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">철학</h2>
          <p className="text-sm leading-relaxed text-slate-300">
            <span className="text-violet-300">LLM은 추론하지 않는다 — 이해(번역)와 렌더만.</span>{' '}
            추론은 결정론·검증가능 엔진이 한다. 도메인별 소형(0.5B) 전문 번역기 + RLVR.
          </p>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">파이프라인</h2>
          <pre className="overflow-x-auto rounded bg-slate-950/70 p-3 text-xs leading-relaxed text-slate-300">
{`ai-main :5173
  └─ elda-orchestrator :3200   ← eldaAdapter 진입점
       ├─ core_intenter :9100  (intent 분류 — 16종)
       ├─ core_resoner  :9200  (Entity RAG — pgvector + rerank)
       ├─ core_decoder  :9300  (Display LLM 생성)
       └─ memory-stack  :9400  (메모리·corpus)`}
          </pre>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-200">인프라 (TEI-lab)</h2>
          <ul className="space-y-1 text-sm text-slate-300">
            <li>
              <span className="text-emerald-300">p38</span>{' '}
              <span className="font-mono text-xs">192.168.0.18:8000</span> — embed+rerank
              게이트웨이(BGE-M3 1024-dim, 2-GPU fan-out){' '}
              <span className="rounded bg-emerald-900/60 px-1.5 text-[10px] text-emerald-300">
                LIVE
              </span>
            </li>
            <li>
              <span className="text-amber-300">bf109</span>{' '}
              <span className="font-mono text-xs">192.168.0.10</span> — Intenter(Qwen2.5-0.5B FFT
              vLLM){' '}
              <span className="rounded bg-amber-900/60 px-1.5 text-[10px] text-amber-300">
                IDLE
              </span>
            </li>
            <li>
              <span className="text-sky-300">spitfire</span>{' '}
              <span className="font-mono text-xs">192.168.0.2:5432</span> — memoryDB (pgvector
              1024-dim)
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-300">상태 — 어댑터 미구현</h2>
          <p className="text-sm text-amber-200/80">
            <span className="font-mono">eldaAdapter</span> 백엔드 어댑터 미구현. 추가되면 Bench
            매트릭스에서 ELDA를 거인 API들과 동일 잣대로 비교할 수 있다(
            <span className="font-mono">X-Api-Key</span>(scope <span className="font-mono">inference</span>) +{' '}
            <span className="font-mono">key_id:conversation_id</span> 세션). 자세히는{' '}
            <span className="font-mono">CLAUDE.md</span>의 "ELDA/TEI 인프라 표면" 참조.
          </p>
        </section>
      </div>
    </div>
  );
}
