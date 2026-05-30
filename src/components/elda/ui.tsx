import type { ReactNode } from 'react';

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${tone ?? 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

export function Badge({ children, tone = 'violet' }: { children: ReactNode; tone?: 'violet' | 'emerald' | 'amber' | 'sky' | 'rose' | 'slate' }) {
  const map = {
    violet: 'bg-violet-900/60 text-violet-300 border-violet-700/60',
    emerald: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60',
    amber: 'bg-amber-900/60 text-amber-300 border-amber-700/60',
    sky: 'bg-sky-900/60 text-sky-300 border-sky-700/60',
    rose: 'bg-rose-900/60 text-rose-300 border-rose-700/60',
    slate: 'bg-slate-800/80 text-slate-300 border-slate-700/60',
  } as const;
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${map[tone]}`}>{children}</span>;
}

export function NotWired() {
  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-xs text-amber-200/80">
      백엔드 프록시 미연결 — 실제 호출은 안 된다. UI/입출력 형태만 확인. 연결 시 <span className="font-mono">/api/tei/*</span> 라우트가 p38 게이트웨이로 포워드.
    </div>
  );
}
