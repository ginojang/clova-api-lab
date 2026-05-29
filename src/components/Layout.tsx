import type { ReactNode } from 'react';
import { useClovaStore } from '../store/useClovaStore';

function Tab({ id, label }: { id: 'chat' | 'bench'; label: string }) {
  const { mode, set } = useClovaStore();
  const active = mode === id;
  return (
    <button
      onClick={() => set('mode', id)}
      className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
        active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
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
        <nav className="ml-4 flex gap-1">
          <Tab id="bench" label="Bench" />
          <Tab id="chat" label="Chat" />
        </nav>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
