import type { ReactNode } from 'react';
import { useClovaStore, type Mode } from '../store/useClovaStore';

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

// 앱 셸: 헤더(타이틀 + 탭) + 본문. 본문은 모드별 View가 채운다.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <span className="text-lg font-semibold tracking-tight">clova-api-lab</span>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
          AI Provider Lab
        </span>
        <nav className="ml-4 flex gap-2">
          <Tab id="bench" label="Bench" />
          <Tab id="llm" label="LLM-분석" />
          <Tab id="vision" label="Vision-분석" />
          <Tab id="fsm" label="FSM-분석" />
          <Tab id="chat" label="Chat" />
        </nav>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
