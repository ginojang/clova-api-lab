import type { ReactNode } from 'react';
import { useClovaStore, type EldaMode, type Mode } from '../store/useClovaStore';
import Sidebar from './Sidebar';

function Tab({ id, label }: { id: Mode; label: string }) {
  const { mode, set } = useClovaStore();
  const active = mode === id;
  return (
    <button
      onClick={() => set('mode', id)}
      className={`rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition-all duration-150 ${
        active
          ? 'border-emerald-400 bg-emerald-600 text-white shadow-lg shadow-emerald-900/50 ring-1 ring-emerald-400/60 -translate-y-0.5'
          : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:-translate-y-0.5 hover:border-slate-500 hover:bg-slate-700 hover:text-white hover:shadow-md hover:shadow-black/30'
      }`}
    >
      {label}
    </button>
  );
}

function EldaTab({ id, label }: { id: EldaMode; label: string }) {
  const { eldaMode, set } = useClovaStore();
  const active = eldaMode === id;
  return (
    <button
      onClick={() => set('eldaMode', id)}
      className={`rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition-all duration-150 ${
        active
          ? 'border-violet-400 bg-gradient-to-br from-violet-500 to-fuchsia-700 text-white shadow-lg shadow-violet-900/50 ring-1 ring-violet-400/60 -translate-y-0.5'
          : 'border-violet-900/60 bg-violet-950/40 text-violet-300 hover:-translate-y-0.5 hover:border-violet-500 hover:bg-violet-900/50 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function ClovaHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
      <span className="text-lg font-semibold tracking-tight text-emerald-300">Clova</span>
      <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
        거인 API + 분석
      </span>
      <nav className="ml-4 flex gap-2">
        <Tab id="bench" label="Bench" />
        <Tab id="llm" label="LLM-분석" />
        <Tab id="vision" label="Vision-분석" />
        <Tab id="fsm" label="FSM-분석" />
        <Tab id="chat" label="Chat" />
      </nav>
    </header>
  );
}

function EldaHeader() {
  return (
    <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
      <span className="text-lg font-semibold tracking-tight text-violet-300">ELDA</span>
      <span className="rounded bg-violet-950/60 px-2 py-0.5 text-xs text-violet-300/80">
        TEI 성능 테스트
      </span>
      <nav className="ml-4 flex gap-2">
        <EldaTab id="status" label="Status" />
        <EldaTab id="embed" label="Embed" />
        <EldaTab id="rerank" label="Rerank" />
        <EldaTab id="bench" label="Bench" />
      </nav>
    </header>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const workspace = useClovaStore((s) => s.workspace);
  return (
    <div className="flex h-full bg-slate-950 text-slate-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {workspace === 'clova' ? <ClovaHeader /> : <EldaHeader />}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
